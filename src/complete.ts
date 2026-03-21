/**
 * @module complete
 *
 * AI-powered completion engine for generated Morphkit iOS projects.
 * Iteratively resolves all MORPHKIT-TODO markers by calling the Claude API
 * with structured context from the generated project.
 */

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join, basename, dirname, relative } from 'path';
import { execFileSync, execSync } from 'child_process';

import { verifyProject, getDetailedTodos, type DetailedTodo } from './verify.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CompleteOptions {
    model?: string;
    maxIterations?: number;
    dryRun?: boolean;
    verbose?: boolean;
}

export interface CompleteResult {
    success: boolean;
    iterations: number;
    filesCompleted: string[];
    todosResolved: number;
    todosRemaining: number;
    buildStatus: 'pass' | 'fail' | 'skipped';
}

// ---------------------------------------------------------------------------
// Context Building
// ---------------------------------------------------------------------------

function findSwiftFiles(dir: string): string[] {
    const results: string[] = [];
    if (!existsSync(dir)) return results;
    try {
        for (const entry of readdirSync(dir)) {
            if (entry.startsWith('.') || entry === 'Build' || entry === '.build') continue;
            const full = join(dir, entry);
            try {
                const s = statSync(full);
                if (s.isDirectory()) results.push(...findSwiftFiles(full));
                else if (entry.endsWith('.swift')) results.push(full);
            } catch { /* skip */ }
        }
    } catch { /* skip */ }
    return results;
}

function buildScreenContext(projectPath: string, todo: DetailedTodo): string {
    const allFiles = findSwiftFiles(projectPath);

    // Read the view file
    const viewContent = readFileSync(todo.file, 'utf-8');

    // Find APIClient
    const apiClientFile = allFiles.find(f => f.endsWith('APIClient.swift'));
    const apiContent = apiClientFile ? readFileSync(apiClientFile, 'utf-8') : '';

    // Find model files
    const modelFiles = allFiles.filter(f => f.includes('/Models/'));
    const modelContents = modelFiles.map(f =>
        `// === ${basename(f)} ===\n${readFileSync(f, 'utf-8')}`
    ).join('\n\n');

    // Find reference implementation
    let refContent = '';
    for (const f of allFiles) {
        if (f === todo.file) continue;
        const content = readFileSync(f, 'utf-8');
        if (content.includes('REFERENCE IMPL')) {
            refContent = `// === Reference: ${basename(f)} ===\n${content}`;
            break;
        }
    }

    // Find CLAUDE.md — check project root, one level up, and inside app subdirectories
    const claudeCandidates = [
        join(projectPath, 'CLAUDE.md'),
        join(projectPath, '..', 'CLAUDE.md'),
        ...new Set(allFiles.map(f => join(dirname(f), '..', 'CLAUDE.md'))),
        ...new Set(allFiles.map(f => join(dirname(f), '..', '..', 'CLAUDE.md'))),
    ];
    const claudeMdFound = claudeCandidates.find(p => existsSync(p));
    const claudeContent = claudeMdFound ? readFileSync(claudeMdFound, 'utf-8') : '';

    const parts: string[] = [];
    if (claudeContent) {
        parts.push('# Project Architecture (from CLAUDE.md)\n');
        // Include first 200 lines for context (API contracts, patterns)
        parts.push(claudeContent.split('\n').slice(0, 200).join('\n'));
        parts.push('\n');
    }
    if (refContent) {
        parts.push('# Reference Implementation\nStudy this file as the canonical pattern:\n```swift\n');
        parts.push(refContent);
        parts.push('\n```\n');
    }
    if (modelContents) {
        parts.push('# Model Structs\n```swift\n');
        parts.push(modelContents);
        parts.push('\n```\n');
    }
    if (apiContent) {
        parts.push('# APIClient\n```swift\n');
        parts.push(apiContent);
        parts.push('\n```\n');
    }
    parts.push(`# File to Complete: ${todo.relativePath}\n`);
    parts.push('```swift\n');
    parts.push(viewContent);
    parts.push('\n```\n');

    return parts.join('');
}

// ---------------------------------------------------------------------------
// System Prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are an expert iOS/SwiftUI developer completing a Morphkit-generated iOS project.

Your task: resolve all MORPHKIT-TODO markers in the given Swift file by writing the actual implementation code.

Rules:
- Use @Observable (not ObservableObject) for state management
- Use .task { } (not .onAppear) for async data loading
- Use NavigationStack (not NavigationView) for navigation
- Use async/await with try/catch for all API calls
- Match the patterns from the reference implementation exactly
- Include proper error handling (set errorMessage on catch)
- Include loading state management (isLoading = true/false)
- Use the exact APIClient method names shown in the APIClient code
- Use the exact model struct types shown in the Models code
- Keep all existing code that is NOT a TODO — only replace TODO comment blocks with real code
- Do NOT add new features, imports, or views beyond what the TODOs require
- Return ONLY the complete Swift file content, no explanation or markdown

Output format: Return the entire Swift file with all TODOs resolved. Nothing else.`;

// ---------------------------------------------------------------------------
// Completion Engine
// ---------------------------------------------------------------------------

function extractSwiftCode(response: string): string {
    // If response is wrapped in markdown code block, extract it
    const codeBlockMatch = response.match(/```swift\n([\s\S]*?)```/);
    if (codeBlockMatch) return codeBlockMatch[1].trim();

    // If it starts with //, it's already raw Swift
    if (response.trimStart().startsWith('//') || response.trimStart().startsWith('import ')) {
        return response.trim();
    }

    return response.trim();
}

function validateSwiftSyntax(code: string, filePath: string): boolean {
    try {
        // Write to temp file for validation
        const tmpPath = filePath + '.morphkit-tmp';
        writeFileSync(tmpPath, code, 'utf-8');
        try {
            execFileSync('swiftc', ['-parse', tmpPath], { stdio: 'pipe', timeout: 15_000 });
            return true;
        } finally {
            try { unlinkSync(tmpPath); } catch { /* ignore */ }
        }
    } catch {
        return false;
    }
}

export async function completeProject(
    projectPath: string,
    options: CompleteOptions = {},
): Promise<CompleteResult> {
    const model = options.model ?? 'claude-sonnet-4-6';
    const maxIterations = options.maxIterations ?? 30;
    const dryRun = options.dryRun ?? false;
    const verbose = options.verbose ?? false;

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
        throw new Error('ANTHROPIC_API_KEY environment variable is required for morphkit complete');
    }

    const client = new Anthropic({ apiKey });
    const filesCompleted: string[] = [];
    let todosResolved = 0;
    let consecutiveNoProgress = 0;
    const MAX_NO_PROGRESS = 3;

    for (let iteration = 0; iteration < maxIterations; iteration++) {
        // Check current state
        const result = verifyProject(projectPath);
        const todos = getDetailedTodos(projectPath);

        if (todos.length === 0) {
            return {
                success: true,
                iterations: iteration,
                filesCompleted,
                todosResolved,
                todosRemaining: 0,
                buildStatus: result.buildStatus,
            };
        }

        // Group TODOs by file and pick the file with the most TODOs
        const todosByFile = new Map<string, DetailedTodo[]>();
        for (const todo of todos) {
            const existing = todosByFile.get(todo.file) ?? [];
            existing.push(todo);
            todosByFile.set(todo.file, existing);
        }

        // Pick file with most TODOs (batch completion is more efficient)
        let bestFile = '';
        let bestCount = 0;
        for (const [file, fileTodos] of todosByFile) {
            if (fileTodos.length > bestCount) {
                bestFile = file;
                bestCount = fileTodos.length;
            }
        }

        const fileTodos = todosByFile.get(bestFile)!;
        const firstTodo = fileTodos[0];
        const relPath = relative(projectPath, bestFile);

        if (verbose) {
            console.log(`[${iteration + 1}/${maxIterations}] Completing ${relPath} (${bestCount} TODOs)`);
        }

        // Build context
        const context = buildScreenContext(projectPath, firstTodo);

        // Call Claude API
        const response = await client.messages.create({
            model,
            max_tokens: 8192,
            system: SYSTEM_PROMPT,
            messages: [{
                role: 'user',
                content: `Complete this Swift file by resolving all MORPHKIT-TODO markers.\n\n${context}`,
            }],
        });

        const responseText = response.content
            .filter(block => block.type === 'text')
            .map(block => (block as { type: 'text'; text: string }).text)
            .join('');

        const completedCode = extractSwiftCode(responseText);

        if (!completedCode || completedCode.length < 50) {
            if (verbose) console.log(`  Skipping — response too short`);
            consecutiveNoProgress++;
            if (consecutiveNoProgress >= MAX_NO_PROGRESS) {
                if (verbose) console.log(`  Stopping — no progress for ${MAX_NO_PROGRESS} consecutive iterations`);
                break;
            }
            continue;
        }

        // Validate syntax before writing
        let syntaxValid = true;
        try {
            execSync('which swiftc', { stdio: 'pipe' });
            syntaxValid = validateSwiftSyntax(completedCode, bestFile);
        } catch {
            // swiftc not available, skip validation
        }

        if (!syntaxValid) {
            if (verbose) console.log(`  Skipping — syntax validation failed`);
            consecutiveNoProgress++;
            if (consecutiveNoProgress >= MAX_NO_PROGRESS) {
                if (verbose) console.log(`  Stopping — no progress for ${MAX_NO_PROGRESS} consecutive iterations`);
                break;
            }
            continue;
        }

        // Count TODOs in new code vs old
        const oldTodoCount = (readFileSync(bestFile, 'utf-8').match(/MORPHKIT-TODO/g) || []).length;
        const newTodoCount = (completedCode.match(/MORPHKIT-TODO/g) || []).length;

        if (newTodoCount >= oldTodoCount) {
            if (verbose) console.log(`  Skipping — no TODOs resolved (${oldTodoCount} → ${newTodoCount})`);
            consecutiveNoProgress++;
            if (consecutiveNoProgress >= MAX_NO_PROGRESS) {
                if (verbose) console.log(`  Stopping — no progress for ${MAX_NO_PROGRESS} consecutive iterations`);
                break;
            }
            continue;
        }

        // Write the completed file
        if (!dryRun) {
            writeFileSync(bestFile, completedCode, 'utf-8');
        }

        const resolved = oldTodoCount - newTodoCount;
        todosResolved += resolved;
        filesCompleted.push(relPath);
        consecutiveNoProgress = 0;

        if (verbose) {
            console.log(`  Resolved ${resolved} TODOs (${newTodoCount} remaining in file)`);
        }
    }

    // Final verification
    const finalResult = verifyProject(projectPath);
    const remainingTodos = getDetailedTodos(projectPath);

    return {
        success: remainingTodos.length === 0,
        iterations: maxIterations,
        filesCompleted,
        todosResolved,
        todosRemaining: remainingTodos.length,
        buildStatus: finalResult.buildStatus,
    };
}

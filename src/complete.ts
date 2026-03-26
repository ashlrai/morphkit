/**
 * @module complete
 *
 * AI-powered completion engine for generated Morphkit iOS projects.
 * Iteratively resolves all MORPHKIT-TODO markers by calling the Claude API
 * with structured context from the generated project.
 */

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join, basename, dirname, relative, resolve } from 'path';
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

/**
 * Find files related to the same feature as the TODO file.
 * Groups by: import references, naming convention, TODO category.
 */
function findRelatedFiles(projectPath: string, todo: DetailedTodo, allFiles: string[]): string[] {
    const related: string[] = [];
    const seen = new Set<string>([todo.file]);
    const todoContent = readFileSync(todo.file, 'utf-8');

    function addRelated(f: string): void {
        if (!seen.has(f)) {
            seen.add(f);
            related.push(f);
        }
    }

    // Find types/managers referenced in this file
    const typeRefs = new Set<string>();
    const refPatterns = [
        /(\w+Manager)\.shared/g,
        /(\w+Store)\(\)/g,
        /(\w+ViewModel)\(\)/g,
        /import\s+(\w+)/g,
    ];
    for (const pattern of refPatterns) {
        let match;
        while ((match = pattern.exec(todoContent)) !== null) {
            typeRefs.add(match[1]);
        }
    }

    // Find files that define these types
    for (const f of allFiles) {
        if (typeRefs.has(basename(f, '.swift'))) {
            addRelated(f);
        }
    }

    // Find files with same prefix (e.g., BillingView + BillingStore)
    const todoName = basename(todo.file, '.swift').replace(/View$|Screen$/, '');
    for (const f of allFiles) {
        const name = basename(f, '.swift');
        if (name.startsWith(todoName) && name !== todoName) {
            addRelated(f);
        }
    }

    // Find other files with TODOs in the same category
    if (todo.category === 'implement-auth') {
        for (const f of allFiles) {
            if (seen.has(f)) continue;
            try {
                const content = readFileSync(f, 'utf-8');
                if (content.includes('AuthManager') || content.includes('SupabaseManager')) {
                    addRelated(f);
                }
            } catch { /* skip */ }
        }
    }

    return related;
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

    // Find related files for multi-file feature context
    const relatedFiles = findRelatedFiles(projectPath, todo, allFiles);
    const relatedContents = relatedFiles.map(f => {
        try {
            return `// === ${basename(f)} ===\n${readFileSync(f, 'utf-8')}`;
        } catch { return ''; }
    }).filter(c => c.length > 0);

    // Find CLAUDE.md — check project root and one level up (bounded to project parent)
    const resolvedProject = resolve(projectPath);
    const projectParent = resolve(projectPath, '..');
    const claudeCandidates = [
        join(resolvedProject, 'CLAUDE.md'),
        join(projectParent, 'CLAUDE.md'),
        ...new Set(allFiles.map(f => join(dirname(dirname(f)), 'CLAUDE.md'))),
    ].filter(p => {
        const resolved = resolve(p);
        return resolved.startsWith(resolvedProject) || resolved.startsWith(projectParent);
    });
    const claudeMdFound = claudeCandidates.find(p => existsSync(p));
    const claudeContent = claudeMdFound ? readFileSync(claudeMdFound, 'utf-8') : '';

    const parts: string[] = [];
    if (claudeContent) {
        parts.push('# Project Architecture (from CLAUDE.md)\n');
        // Extract key sections: completion order, API contracts, patterns
        const claudeLines = claudeContent.split('\n');
        const keyLines: string[] = [];
        let inKeySection = false;
        for (const line of claudeLines) {
            if (line.startsWith('## ') || line.startsWith('### ')) {
                inKeySection = /completion|api|pattern|model|screen|network/i.test(line);
            }
            if (inKeySection || keyLines.length < 50) {
                keyLines.push(line);
            }
            if (keyLines.length >= 300) break;
        }
        parts.push(keyLines.join('\n'));
        parts.push('\n');
    }
    if (refContent) {
        parts.push('# Reference Implementation\nStudy this file as the canonical pattern:\n```swift\n');
        parts.push(refContent);
        parts.push('\n```\n');
    }
    if (relatedContents.length > 0) {
        parts.push('# Related Files (same feature)\n```swift\n');
        parts.push(relatedContents.join('\n\n'));
        parts.push('\n```\n');
    }
    if (modelContents) {
        parts.push('# Model Structs\n```swift\n');
        parts.push(modelContents);
        parts.push('\n```\n');
    }
    if (apiContent) {
        parts.push('# APIClient (full implementation)\n```swift\n');
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

const BASE_SYSTEM_PROMPT = `You are an expert iOS/SwiftUI developer completing a Morphkit-generated iOS project.

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

/**
 * Build a project-specific system prompt by extracting concrete patterns
 * from the reference implementation and APIClient.
 */
function buildSystemPrompt(projectPath: string, allFiles: string[]): string {
    const parts: string[] = [BASE_SYSTEM_PROMPT];

    // Extract loadData() pattern from reference implementation
    const refFile = allFiles.find(f => {
        try {
            const content = readFileSync(f, 'utf-8');
            return content.includes('REFERENCE IMPLEMENTATION') || content.includes('REFERENCE IMPL');
        } catch { return false; }
    });
    if (refFile) {
        try {
            const refContent = readFileSync(refFile, 'utf-8');
            const loadDataMatch = refContent.match(/private func loadData\(\)[\s\S]*?\n {4}\}/);
            if (loadDataMatch) {
                parts.push(`\n\nThis project uses this exact data loading pattern:\n\`\`\`swift\n${loadDataMatch[0]}\n\`\`\``);
            }
        } catch { /* skip */ }
    }

    // Extract full APIClient method signatures with URLs
    const apiClientFile = allFiles.find(f => f.endsWith('APIClient.swift'));
    if (apiClientFile) {
        try {
            const apiContent = readFileSync(apiClientFile, 'utf-8');
            const methodLines = apiContent.split('\n').filter(l =>
                l.trim().startsWith('func ') || l.trim().startsWith('// MARK')
            );
            if (methodLines.length > 0) {
                parts.push(`\n\nAvailable APIClient methods (use these exact names):\n\`\`\`swift\n${methodLines.join('\n')}\n\`\`\``);
            }
        } catch { /* skip */ }
    }

    // Extract SupabaseManager methods if present
    const supabaseFile = allFiles.find(f => f.endsWith('SupabaseManager.swift'));
    if (supabaseFile) {
        try {
            const supaContent = readFileSync(supabaseFile, 'utf-8');
            const methodLines = supaContent.split('\n').filter(l =>
                l.trim().startsWith('func ') || l.trim().startsWith('static func')
            );
            if (methodLines.length > 0) {
                parts.push(`\n\nAvailable SupabaseManager methods:\n\`\`\`swift\n${methodLines.join('\n')}\n\`\`\``);
            }
        } catch { /* skip */ }
    }

    return parts.join('');
}

// ---------------------------------------------------------------------------
// Completion Engine
// ---------------------------------------------------------------------------

function extractResponseText(response: Anthropic.Message): string {
    return response.content
        .filter(block => block.type === 'text')
        .map(block => (block as { type: 'text'; text: string }).text)
        .join('');
}

function extractSwiftCode(response: string): string {
    // If response is wrapped in markdown code block, extract it
    const codeBlockMatch = response.match(/```swift\n([\s\S]*?)```/);
    if (codeBlockMatch) return codeBlockMatch[1].trim();

    return response.trim();
}

function validateSwiftSyntax(code: string, filePath: string): { valid: boolean; error?: string } {
    try {
        // Write to temp file for validation
        const tmpPath = filePath + '.morphkit-tmp';
        writeFileSync(tmpPath, code, 'utf-8');
        try {
            execFileSync('swiftc', ['-parse', tmpPath], { stdio: 'pipe', timeout: 15_000 });
            return { valid: true };
        } catch (err: any) {
            const errorOutput = err.stderr?.toString() ?? err.stdout?.toString() ?? 'Unknown syntax error';
            return { valid: false, error: errorOutput };
        } finally {
            try { unlinkSync(tmpPath); } catch { /* ignore */ }
        }
    } catch {
        return { valid: true }; // Can't validate, assume ok
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
    if (!apiKey && !dryRun) {
        throw new Error('ANTHROPIC_API_KEY environment variable is required for morphkit complete');
    }

    const client = apiKey ? new Anthropic({ apiKey }) : null;
    const filesCompleted: string[] = [];
    let todosResolved = 0;
    let consecutiveNoProgress = 0;
    const MAX_NO_PROGRESS = 3;
    let actualIterations = 0;

    for (let iteration = 0; iteration < maxIterations; iteration++) {
        actualIterations = iteration + 1;
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

        // Group TODOs by file
        const todosByFile = new Map<string, DetailedTodo[]>();
        for (const todo of todos) {
            const existing = todosByFile.get(todo.file) ?? [];
            existing.push(todo);
            todosByFile.set(todo.file, existing);
        }

        // Dependency-aware file selection: infrastructure before views
        // TODOs are already sorted by priority from getDetailedTodos(),
        // so pick the file of the highest-priority TODO
        const bestFile = todos[0].file;
        const bestCount = todosByFile.get(bestFile)?.length ?? 1;

        const fileTodos = todosByFile.get(bestFile)!;
        const firstTodo = fileTodos[0];
        const relPath = relative(projectPath, bestFile);

        if (verbose) {
            console.log(`[${iteration + 1}/${maxIterations}] Completing ${relPath} (${bestCount} TODOs)`);
        }

        // Build context and project-specific system prompt
        const allSwiftFiles = findSwiftFiles(projectPath);
        const context = buildScreenContext(projectPath, firstTodo);
        const systemPrompt = buildSystemPrompt(projectPath, allSwiftFiles);

        // In dry-run without API key, report what would be done then exit
        if (!client) {
            // Report all unique files with TODOs
            for (const [file, fileTodos] of todosByFile) {
                const rel = relative(projectPath, file);
                if (verbose) {
                    console.log(`  Would complete ${rel} (${fileTodos.length} TODOs)`);
                }
                todosResolved += fileTodos.length;
                filesCompleted.push(rel);
            }
            break; // Don't loop — just report once
        }

        // Call Claude API
        const response = await client.messages.create({
            model,
            max_tokens: 8192,
            system: systemPrompt,
            messages: [{
                role: 'user',
                content: `Complete this Swift file by resolving all MORPHKIT-TODO markers.\n\n${context}`,
            }],
        });

        const completedCode = extractSwiftCode(extractResponseText(response));

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
        let finalCode = completedCode;
        let syntaxValid = true;
        try {
            execSync('which swiftc', { stdio: 'pipe' });
            const result = validateSwiftSyntax(completedCode, bestFile);
            syntaxValid = result.valid;

            // Retry once with error feedback if syntax validation fails
            if (!result.valid && result.error && client) {
                if (verbose) console.log(`  Syntax error, retrying with error feedback...`);
                const retryResponse = await client.messages.create({
                    model,
                    max_tokens: 8192,
                    system: systemPrompt,
                    messages: [{
                        role: 'user',
                        content: `Your previous completion had a syntax error:\n\n${result.error}\n\nFix the error and return the corrected complete file.\n\n${context}`,
                    }],
                });
                const retryCode = extractSwiftCode(extractResponseText(retryResponse));
                if (retryCode && retryCode.length >= 50) {
                    const retryResult = validateSwiftSyntax(retryCode, bestFile);
                    if (retryResult.valid) {
                        finalCode = retryCode;
                        syntaxValid = true;
                        if (verbose) console.log(`  Retry succeeded`);
                    }
                }
            }
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
        const newTodoCount = (finalCode.match(/MORPHKIT-TODO/g) || []).length;

        if (newTodoCount >= oldTodoCount) {
            if (verbose) console.log(`  Skipping — no TODOs resolved (${oldTodoCount} → ${newTodoCount})`);
            consecutiveNoProgress++;
            if (consecutiveNoProgress >= MAX_NO_PROGRESS) {
                if (verbose) console.log(`  Stopping — no progress for ${MAX_NO_PROGRESS} consecutive iterations`);
                break;
            }
            continue;
        }

        if (!dryRun) {
            // Update the static MORPHKIT-TODO-COUNT header to match actual remaining count
            const updatedCode = finalCode.replace(
                /\/\/ MORPHKIT-TODO-COUNT:\s*\d+/,
                `// MORPHKIT-TODO-COUNT: ${newTodoCount}`
            );
            writeFileSync(bestFile, updatedCode, 'utf-8');
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
        iterations: actualIterations,
        filesCompleted,
        todosResolved,
        todosRemaining: remainingTodos.length,
        buildStatus: finalResult.buildStatus,
    };
}

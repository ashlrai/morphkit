import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

export interface VerifyResult {
    buildStatus: 'pass' | 'fail' | 'skipped';
    buildErrors: number;
    todosByCategory: Record<string, number>;
    todosByFile: Record<string, number>;
    totalTodos: number;
    screenCompletion: { total: number; complete: number; percentage: number };
    apiCoverage: { total: number; wired: number; percentage: number };
    modelCompleteness: { total: number; complete: number; percentage: number };
    apiBaseUrlSet: boolean;
    authWired: boolean;
    overallPercentage: number;
    nextStep: string;
}

/**
 * Recursively find all .swift files under a directory.
 */
function findSwiftFiles(dir: string): string[] {
    const results: string[] = [];
    if (!existsSync(dir)) return results;

    let entries: string[];
    try {
        entries = readdirSync(dir);
    } catch {
        return results;
    }

    for (const entry of entries) {
        const fullPath = join(dir, entry);
        let stat;
        try {
            stat = statSync(fullPath);
        } catch {
            continue;
        }

        if (stat.isDirectory()) {
            // Skip hidden directories and build artifacts
            if (!entry.startsWith('.') && entry !== 'Build' && entry !== '.build') {
                results.push(...findSwiftFiles(fullPath));
            }
        } else if (entry.endsWith('.swift')) {
            results.push(fullPath);
        }
    }

    return results;
}

/**
 * Read a file safely, returning empty string on failure.
 */
function safeReadFile(filePath: string): string {
    try {
        return readFileSync(filePath, 'utf-8');
    } catch {
        return '';
    }
}

/**
 * Extract function bodies from Swift source text.
 * Returns an array of { name, body } for each `func` declaration found.
 */
function extractFuncBodies(source: string): Array<{ name: string; body: string }> {
    const funcs: Array<{ name: string; body: string }> = [];
    const lines = source.split('\n');

    for (let i = 0; i < lines.length; i++) {
        const funcMatch = lines[i].match(/func\s+(\w+)/);
        if (!funcMatch) continue;

        const name = funcMatch[1];
        // Find the opening brace
        let braceStart = -1;
        for (let j = i; j < lines.length; j++) {
            if (lines[j].includes('{')) {
                braceStart = j;
                break;
            }
        }
        if (braceStart === -1) continue;

        // Track brace depth to find the closing brace
        let depth = 0;
        const bodyLines: string[] = [];
        for (let j = braceStart; j < lines.length; j++) {
            // Strip line comments before counting braces to avoid mismatches
            const stripped = lines[j].replace(/\/\/.*$/, '');
            for (const ch of stripped) {
                if (ch === '{') depth++;
                if (ch === '}') depth--;
            }
            bodyLines.push(lines[j]);
            if (depth === 0) break;
        }

        funcs.push({ name, body: bodyLines.join('\n') });
    }

    return funcs;
}

/**
 * Verify a generated iOS project and produce a structured verification report.
 */
export function verifyProject(projectPath: string): VerifyResult {
    // --- 1. Swift Build Check ---
    let buildStatus: VerifyResult['buildStatus'] = 'skipped';
    let buildErrors = 0;

    try {
        // Check if swift is available
        execSync('which swift', { stdio: 'pipe' });

        // Check if Package.swift exists at projectPath or in a parent search
        const packageSwiftPath = existsSync(join(projectPath, 'Package.swift'))
            ? projectPath
            : null;

        if (packageSwiftPath) {
            try {
                execSync('swift build 2>&1', {
                    cwd: packageSwiftPath,
                    stdio: 'pipe',
                    timeout: 120_000,
                });
                buildStatus = 'pass';
                buildErrors = 0;
            } catch (err: any) {
                buildStatus = 'fail';
                const output = err.stdout?.toString() ?? err.stderr?.toString() ?? '';
                const errorMatches = output.match(/error:/g);
                buildErrors = errorMatches ? errorMatches.length : 1;
            }
        }
    } catch {
        // swift not available
        buildStatus = 'skipped';
    }

    // --- 2. TODO Census ---
    const allSwiftFiles = findSwiftFiles(projectPath);
    const todosByCategory: Record<string, number> = {};
    const todosByFile: Record<string, number> = {};
    let totalTodos = 0;

    // Track per-file MORPHKIT-TODO counts for screen completeness
    const morphkitTodoCountsByFile = new Map<string, number>();

    for (const filePath of allSwiftFiles) {
        const content = safeReadFile(filePath);
        const relPath = relative(projectPath, filePath);
        const lines = content.split('\n');
        let fileTodoCount = 0;

        for (const line of lines) {
            // Check for MORPHKIT-TODO: <category>
            const morphkitMatch = line.match(/MORPHKIT-TODO:\s*(\S+)/);
            if (morphkitMatch) {
                const category = morphkitMatch[1];
                todosByCategory[category] = (todosByCategory[category] ?? 0) + 1;
                fileTodoCount++;
                totalTodos++;
                continue;
            }

            // Legacy // TODO: comments are NOT counted — only MORPHKIT-TODO markers are actionable
        }

        if (fileTodoCount > 0) {
            todosByFile[relPath] = fileTodoCount;
        }

        morphkitTodoCountsByFile.set(filePath, fileTodoCount);
    }

    // --- 3. Screen Completeness ---
    // Find View files (files inside a Views/ directory)
    const viewFiles = allSwiftFiles.filter((f) => {
        const rel = relative(projectPath, f);
        return rel.includes('Views/') || rel.includes('views/');
    });

    const screensTotal = viewFiles.length;
    let screensComplete = 0;

    for (const viewFile of viewFiles) {
        const content = safeReadFile(viewFile);
        const hasMorphkitTodoCountLine = content.includes('MORPHKIT-TODO-COUNT:');
        const fileMorphkitTodos = morphkitTodoCountsByFile.get(viewFile) ?? 0;

        // Use actual remaining TODO count — the static MORPHKIT-TODO-COUNT header
        // may be stale after AI completion resolves TODOs
        if (fileMorphkitTodos === 0) {
            screensComplete++;
        }
    }

    const screenCompletion = {
        total: screensTotal,
        complete: screensComplete,
        percentage: screensTotal > 0 ? Math.round((screensComplete / screensTotal) * 100) : 100,
    };

    // --- 4. API Coverage ---
    // Find APIClient file in Networking/ directory
    const networkingFiles = allSwiftFiles.filter((f) => {
        const rel = relative(projectPath, f);
        return rel.includes('Networking/') || rel.includes('networking/');
    });

    const apiClientFile = networkingFiles.find((f) =>
        f.toLowerCase().includes('apiclient')
    );

    let apiTotal = 0;
    let apiWired = 0;

    if (apiClientFile) {
        const content = safeReadFile(apiClientFile);
        const funcs = extractFuncBodies(content);
        apiTotal = funcs.length;

        for (const fn of funcs) {
            const hasTodo = fn.body.includes('MORPHKIT-TODO');
            if (!hasTodo) {
                apiWired++;
            }
        }
    }

    const apiCoverage = {
        total: apiTotal,
        wired: apiWired,
        percentage: apiTotal > 0 ? Math.round((apiWired / apiTotal) * 100) : 100,
    };

    // --- 5. Model Completeness ---
    const modelFiles = allSwiftFiles.filter((f) => {
        const rel = relative(projectPath, f);
        return rel.includes('Models/') || rel.includes('models/');
    });

    let modelsTotal = 0;
    let modelsComplete = 0;

    for (const modelFile of modelFiles) {
        const content = safeReadFile(modelFile);
        // Strip line comments before brace counting to avoid mismatches
        const contentStripped = content.replace(/\/\/.*$/gm, '');
        // Find struct declarations
        const structRegex = /struct\s+\w+[^{]*\{/g;
        let structMatch;

        while ((structMatch = structRegex.exec(contentStripped)) !== null) {
            modelsTotal++;

            // Extract the struct body
            const startIdx = structMatch.index + structMatch[0].length;
            let depth = 1;
            let endIdx = startIdx;
            for (let i = startIdx; i < contentStripped.length && depth > 0; i++) {
                if (contentStripped[i] === '{') depth++;
                if (contentStripped[i] === '}') depth--;
                endIdx = i;
            }

            const structBody = contentStripped.slice(startIdx, endIdx);
            // Count let/var property declarations (simple heuristic)
            const propMatches = structBody.match(/(?:let|var)\s+\w+\s*[:=]/g);
            const propCount = propMatches ? propMatches.length : 0;

            if (propCount >= 2) {
                modelsComplete++;
            }
        }
    }

    const modelCompleteness = {
        total: modelsTotal,
        complete: modelsComplete,
        percentage: modelsTotal > 0 ? Math.round((modelsComplete / modelsTotal) * 100) : 100,
    };

    // --- 6. API Base URL ---
    let apiBaseUrlSet = true;
    const apiConfigCandidates = allSwiftFiles.filter((f) =>
        f.toLowerCase().includes('apiconfiguration')
    );

    if (apiConfigCandidates.length > 0) {
        const configContent = safeReadFile(apiConfigCandidates[0]);
        if (
            configContent.includes('your-api') ||
            configContent.includes('placeholder') ||
            configContent.includes('example.com')
        ) {
            apiBaseUrlSet = false;
        }
    }

    // --- 7. Auth Wiring ---
    let authWired = true;
    const authManagerCandidates = allSwiftFiles.filter((f) =>
        f.toLowerCase().includes('authmanager')
    );

    if (authManagerCandidates.length > 0) {
        const authContent = safeReadFile(authManagerCandidates[0]);
        const funcs = extractFuncBodies(authContent);
        const authFuncs = funcs.filter(
            (fn) => fn.name === 'login' || fn.name === 'register'
        );

        if (authFuncs.length > 0) {
            // Check if all auth functions are still stubs
            const allStubs = authFuncs.every((fn) => {
                const body = fn.body;
                return (
                    body.includes('MORPHKIT-TODO') ||
                    body.includes('fatalError') ||
                    body.includes('not implemented')
                );
            });
            if (allStubs) {
                authWired = false;
            }
        }
    }

    // --- 8. Overall Percentage ---
    const buildScore = buildStatus === 'pass' ? 100 : buildStatus === 'skipped' ? 50 : 0;
    const overallPercentage = Math.round(
        screenCompletion.percentage * 0.4 +
        apiCoverage.percentage * 0.3 +
        modelCompleteness.percentage * 0.15 +
        buildScore * 0.15
    );

    // --- 9. Next Step ---
    let nextStep = 'All screens complete';

    // Find the view file with the most TODOs
    let maxTodos = 0;
    let maxTodoFile = '';

    for (const viewFile of viewFiles) {
        const relPath = relative(projectPath, viewFile);
        const count = todosByFile[relPath] ?? 0;
        if (count > maxTodos) {
            maxTodos = count;
            maxTodoFile = relPath;
        }
    }

    if (maxTodos > 0) {
        // Extract just the filename without extension for readability
        const fileName = maxTodoFile.split('/').pop()?.replace('.swift', '') ?? maxTodoFile;
        nextStep = `Complete ${fileName} (${maxTodos} TODO${maxTodos === 1 ? '' : 's'})`;
    } else if (totalTodos > 0) {
        // No view TODOs but other TODOs exist
        const topFile = Object.entries(todosByFile).sort((a, b) => b[1] - a[1])[0];
        if (topFile) {
            const fileName = topFile[0].split('/').pop()?.replace('.swift', '') ?? topFile[0];
            nextStep = `Complete ${fileName} (${topFile[1]} TODO${topFile[1] === 1 ? '' : 's'})`;
        }
    }

    return {
        buildStatus,
        buildErrors,
        todosByCategory,
        todosByFile,
        totalTodos,
        screenCompletion,
        apiCoverage,
        modelCompleteness,
        apiBaseUrlSet,
        authWired,
        overallPercentage,
        nextStep,
    };
}

/**
 * Format a VerifyResult into a human-readable plain-text report.
 */
export function formatVerifyResult(result: VerifyResult): string {
    const lines: string[] = [];

    // Build Status
    const buildIcon = result.buildStatus === 'pass' ? 'PASS' : result.buildStatus === 'fail' ? 'FAIL' : 'SKIPPED';
    const buildErrorSuffix = result.buildStatus === 'fail'
        ? ` (${result.buildErrors} error${result.buildErrors === 1 ? '' : 's'})`
        : result.buildStatus === 'pass'
            ? ` (${result.buildErrors} errors)`
            : '';
    lines.push(`Build Status:        ${buildIcon}${buildErrorSuffix}`);

    // Screen Completion
    const sc = result.screenCompletion;
    lines.push(`Screen Completion:   ${sc.complete}/${sc.total} (${sc.percentage}%)`);

    // API Wiring
    const ac = result.apiCoverage;
    lines.push(`API Wiring:          ${ac.wired}/${ac.total} (${ac.percentage}%)`);

    // Model Completeness
    const mc = result.modelCompleteness;
    lines.push(`Model Completeness:  ${mc.complete}/${mc.total} (${mc.percentage}%)`);

    // Overall
    lines.push(`Overall:             ${result.overallPercentage}% complete`);

    // TODO Breakdown
    const categories = Object.entries(result.todosByCategory);
    if (categories.length > 0) {
        lines.push('');
        lines.push('TODO Breakdown:');
        // Sort by count descending
        categories.sort((a, b) => b[1] - a[1]);
        for (const [category, count] of categories) {
            const paddedCategory = `${category}:`.padEnd(20);
            lines.push(`  ${paddedCategory}${count}`);
        }
    }

    // Next step
    lines.push('');
    lines.push(`Next step:           ${result.nextStep}`);

    return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Detailed TODO extraction for AI completion loop
// ---------------------------------------------------------------------------

export interface DetailedTodo {
    /** Absolute file path */
    file: string;
    /** Relative file path from project root */
    relativePath: string;
    /** Line number (1-indexed) */
    line: number;
    /** MORPHKIT-TODO category (wire-api-fetch, wire-api-action, complete-model, implement-auth) */
    category: string;
    /** Screen name extracted from the TODO comment */
    screenName: string;
    /** The full TODO comment block (may be multi-line) */
    context: string;
    /** Implementation hint (e.g., "Pattern: try await APIClient.shared.fetchProducts()") */
    hint: string;
}

/**
 * Extract all MORPHKIT-TODO markers with full context for AI completion.
 * Returns structured data that can be used by `morphkit complete` or MCP tools.
 */
export function getDetailedTodos(projectPath: string): DetailedTodo[] {
    const todos: DetailedTodo[] = [];
    const allSwiftFiles = findSwiftFiles(projectPath);

    for (const filePath of allSwiftFiles) {
        const content = safeReadFile(filePath);
        if (!content) continue;
        const relPath = relative(projectPath, filePath);
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
            const todoMatch = lines[i].match(/\/\/\s*MORPHKIT-TODO:\s*(\S+)/);
            if (!todoMatch) continue;

            const category = todoMatch[1];

            // Collect the full TODO comment block (consecutive comment lines)
            const contextLines: string[] = [lines[i]];
            let j = i + 1;
            while (j < lines.length && lines[j].trimStart().startsWith('//')) {
                contextLines.push(lines[j]);
                j++;
            }
            const context = contextLines.map(l => l.trim()).join('\n');

            // Extract screen name from "Screen: <name>" pattern
            const screenMatch = context.match(/Screen:\s*(\S+)/);
            const screenName = screenMatch ? screenMatch[1] : relPath.replace(/^Views\//, '').replace(/\.swift$/, '');

            // Extract hint (Pattern: or APIClient method:)
            const patternMatch = context.match(/Pattern:\s*(.+)/);
            const methodMatch = context.match(/APIClient method:\s*(.+)/);
            const hint = patternMatch?.[1] ?? methodMatch?.[1] ?? '';

            todos.push({
                file: filePath,
                relativePath: relPath,
                line: i + 1,
                category,
                screenName,
                context,
                hint,
            });
        }
    }

    // Sort by dependency order: infrastructure first, then consumers
    // Auth/model must be resolved before views that depend on them
    const priorityOrder: Record<string, number> = {
        'implement-auth': 0,
        'complete-model': 1,
        'wire-api-action': 2,
        'wire-api-fetch': 3,
    };

    // Secondary sort: infrastructure files before view files
    const fileTypePriority = (path: string): number => {
        if (path.includes('Networking/') || path.includes('networking/')) return 0;
        if (path.includes('State/') || path.includes('state/')) return 1;
        if (path.includes('Models/') || path.includes('models/')) return 2;
        if (path.includes('Views/') || path.includes('views/')) return 3;
        return 4;
    };

    todos.sort((a, b) => {
        const catDiff = (priorityOrder[a.category] ?? 99) - (priorityOrder[b.category] ?? 99);
        if (catDiff !== 0) return catDiff;
        return fileTypePriority(a.relativePath) - fileTypePriority(b.relativePath);
    });

    return todos;
}

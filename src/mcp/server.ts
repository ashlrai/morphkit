#!/usr/bin/env node
/**
 * Morphkit MCP Server
 *
 * Exposes Morphkit's analysis and generation pipeline as MCP tools
 * that Claude Code, Codex, or other AI coding assistants can call directly.
 *
 * Tools:
 *   morphkit_analyze  — Analyze a web app and return the semantic model summary
 *   morphkit_generate — Generate an iOS project from a web app
 *   morphkit_plan     — Return a prioritized implementation plan for the generated project
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { resolve, join, basename, dirname } from 'path';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { analyzeRepo } from '../analyzer/index.js';
import { generateProject } from '../generator/index.js';
import { adaptForPlatform } from '../semantic/adapter.js';
import { buildSemanticModel } from '../semantic/builder.js';
import type { SemanticAppModel } from '../semantic/model.js';
import { verifyProject, formatVerifyResult, getDetailedTodos } from '../verify.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function summarizeModel(model: SemanticAppModel): string {
    const entities = model.entities ?? [];
    const screens = model.screens ?? [];
    const endpoints = model.apiEndpoints ?? [];
    const auth = model.auth;

    const lines: string[] = [];
    lines.push(`## ${model.appName}`);
    if (model.description) lines.push(model.description);
    lines.push('');

    lines.push(`### Entities (${entities.length})`);
    for (const e of entities) {
        const fieldCount = e.fields?.length ?? 0;
        const status = fieldCount <= 1 ? ' ⚠️ incomplete' : '';
        lines.push(`- **${e.name}** (${fieldCount} fields${status})`);
    }
    lines.push('');

    lines.push(`### Screens (${screens.length})`);
    for (const s of screens) {
        lines.push(`- **${s.name}** — ${s.layout} — ${s.purpose || s.description || 'no description'}`);
    }
    lines.push('');

    lines.push(`### API Endpoints (${endpoints.length})`);
    for (const ep of endpoints.slice(0, 20)) {
        const method = ep.method ?? 'GET';
        lines.push(`- \`${method} ${ep.url}\`${ep.auth ? ' (auth)' : ''}`);
    }
    if (endpoints.length > 20) {
        lines.push(`- ... and ${endpoints.length - 20} more`);
    }
    lines.push('');

    if (auth) {
        lines.push(`### Authentication`);
        lines.push(`- Type: ${auth.type}`);
        if (auth.provider) lines.push(`- Provider: ${auth.provider}`);
        lines.push('');
    }

    lines.push(`### Metadata`);
    lines.push(`- Framework: ${model.metadata?.sourceFramework ?? 'unknown'}`);
    lines.push(`- Files analyzed: ${model.metadata?.analyzedFiles?.length ?? 0}`);
    lines.push(`- Overall confidence: ${model.confidence}`);

    if (model.metadata?.warnings && model.metadata.warnings.length > 0) {
        lines.push('');
        lines.push(`### Warnings (${model.metadata.warnings.length})`);
        for (const w of model.metadata.warnings.slice(0, 10)) {
            lines.push(`- ${w}`);
        }
    }

    return lines.join('\n');
}

function generatePlan(model: SemanticAppModel): string {
    const entities = model.entities ?? [];
    const screens = model.screens ?? [];
    const endpoints = model.apiEndpoints ?? [];
    const auth = model.auth;

    const lines: string[] = [];
    lines.push(`# Implementation Plan for ${model.appName}`);
    lines.push('');
    lines.push('## Priority Order');
    lines.push('');

    let step = 1;

    // 1. API base URL
    lines.push(`### ${step}. Configure API Base URL`);
    lines.push('Update `Networking/APIConfiguration.swift` with your actual API endpoint.');
    lines.push('');
    step++;

    // 2. Auth
    if (auth) {
        lines.push(`### ${step}. Implement Authentication`);
        lines.push(`- Auth type: ${auth.type}${auth.provider ? ` (${auth.provider})` : ''}`);
        if (auth.flows && auth.flows.length > 0) {
            for (const flow of auth.flows) {
                lines.push(`- ${flow.name}: ${flow.description || flow.screens.join(' → ')}`);
            }
        }
        lines.push('- Store tokens via `KeychainHelper.save(key: "authToken", value: token)`');
        lines.push('');
        step++;
    }

    // 3. Incomplete models
    const incomplete = entities.filter(e => (e.fields?.length ?? 0) <= 1);
    if (incomplete.length > 0) {
        lines.push(`### ${step}. Complete Data Models (${incomplete.length} incomplete)`);
        for (const e of incomplete) {
            lines.push(`- \`${e.name}\` — needs fields added (currently ${e.fields?.length ?? 0} fields)`);
        }
        lines.push('');
        step++;
    }

    // 4. Screen implementation by priority
    const screensByPriority = [...screens].sort((a, b) => {
        const aApi = (a.dataRequirements ?? []).filter(r => r.fetchStrategy === 'api').length;
        const bApi = (b.dataRequirements ?? []).filter(r => r.fetchStrategy === 'api').length;
        return bApi - aApi;
    });

    lines.push(`### ${step}. Implement Screens (${screens.length} total)`);
    for (const s of screensByPriority) {
        const apiReqs = (s.dataRequirements ?? []).filter(r => r.fetchStrategy === 'api');
        const actions = (s.actions ?? []).length;
        const detail = apiReqs.length > 0
            ? ` — needs: ${apiReqs.map(r => r.source).join(', ')}`
            : '';
        lines.push(`- **${s.name}** (${s.layout})${detail} [${actions} actions]`);
    }
    lines.push('');
    step++;

    // 5. API wiring
    const unconnectedEndpoints = endpoints.filter(ep => {
        const url = ep.url.toLowerCase();
        return !url.includes('auth') && !url.includes('login');
    });
    if (unconnectedEndpoints.length > 0) {
        lines.push(`### ${step}. Wire API Endpoints (${unconnectedEndpoints.length} endpoints)`);
        lines.push('The `APIClient` has stub methods. Implement the actual HTTP calls:');
        for (const ep of unconnectedEndpoints.slice(0, 15)) {
            lines.push(`- \`${ep.method} ${ep.url}\`${ep.auth ? ' (requires auth)' : ''}`);
        }
        if (unconnectedEndpoints.length > 15) {
            lines.push(`- ... and ${unconnectedEndpoints.length - 15} more`);
        }
        lines.push('');
        step++;
    }

    // 6. Polish
    lines.push(`### ${step}. Polish & Ship`);
    lines.push('- Add loading states, empty states, and error recovery');
    lines.push('- Implement pull-to-refresh on list views');
    lines.push('- Add app icon to `Assets.xcassets/AppIcon.appiconset/`');
    lines.push('- Test on device and submit to App Store Connect');

    return lines.join('\n');
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer({
    name: 'morphkit',
    version: '0.2.0',
});

// --- Tool: morphkit_analyze ---

server.tool(
    'morphkit_analyze',
    'Analyze a TypeScript/React web app and return its semantic model. Use when a user wants to understand their web app structure before creating an iOS version. Detects entities, screens, API endpoints, auth patterns, backend services (Supabase, Stripe, SSE streaming), and Tailwind styling.',
    {
        path: z.string().describe('Path to the web app directory (Next.js, React, etc.)'),
        verbose: z.boolean().optional().default(false).describe('Include detailed analysis output'),
    },
    async ({ path: appPath, verbose }) => {
        const resolvedPath = resolve(appPath);
        if (!existsSync(resolvedPath)) {
            return { content: [{ type: 'text' as const, text: `Error: Directory not found: ${resolvedPath}` }] };
        }

        try {
            const analysisResult = await analyzeRepo(resolvedPath);
            const model = await buildSemanticModel(analysisResult);

            const summary = summarizeModel(model);
            const result = verbose
                ? `${summary}\n\n---\n\n## Full Model (JSON)\n\`\`\`json\n${JSON.stringify(model, null, 2)}\n\`\`\``
                : summary;

            return { content: [{ type: 'text' as const, text: result }] };
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            return { content: [{ type: 'text' as const, text: `Analysis failed: ${msg}` }] };
        }
    },
);

// --- Tool: morphkit_generate ---

server.tool(
    'morphkit_generate',
    'Generate a native SwiftUI iOS app from a TypeScript/React web app. Use when a user says they want an iOS version of their web app, a mobile companion app, or to convert React to Swift. Auto-detects Supabase (generates SupabaseManager), Stripe (generates PaymentManager), SSE streaming (generates SSEClient), and Markdown rendering (adds MarkdownUI). Creates a compilable Xcode project. After generating, use morphkit_complete_screen for each screen to rewrite the views to match the original React UI — the tool includes the original React source code for comparison.',
    {
        path: z.string().describe('Path to the web app directory'),
        output: z.string().describe('Output directory for the generated iOS project'),
        name: z.string().optional().describe('App name (defaults to directory name)'),
    },
    async ({ path: appPath, output, name }) => {
        const resolvedPath = resolve(appPath);
        const resolvedOutput = resolve(output);

        if (!existsSync(resolvedPath)) {
            return { content: [{ type: 'text' as const, text: `Error: Directory not found: ${resolvedPath}` }] };
        }

        try {
            // Run the full pipeline
            const analysisResult = await analyzeRepo(resolvedPath);
            const model = await buildSemanticModel(analysisResult);

            // Override app name if provided
            if (name) {
                (model as any).appName = name;
            }

            const adapted = adaptForPlatform(model, 'ios');
            const result = await generateProject(adapted, resolvedOutput);

            const lines: string[] = [];
            lines.push(`## Generated: ${result.appName}`);
            lines.push('');
            lines.push(`- **Output:** ${result.outputPath}`);
            lines.push(`- **Total files:** ${result.stats.totalFiles}`);
            lines.push(`- **High confidence:** ${result.stats.highConfidence}`);
            lines.push(`- **Medium confidence:** ${result.stats.mediumConfidence}`);
            lines.push(`- **Low confidence:** ${result.stats.lowConfidence}`);
            lines.push('');
            lines.push('### Next Steps');
            lines.push(`1. Open the project: \`open ${resolvedOutput}/Package.swift\``);
            lines.push(`2. Read the generated \`CLAUDE.md\` for the full implementation guide`);
            lines.push('3. Start with the reference implementation screens');
            lines.push('');

            if (result.stats.warnings.length > 0) {
                lines.push(`### Warnings (${result.stats.warnings.length})`);
                for (const w of result.stats.warnings.slice(0, 10)) {
                    lines.push(`- ${w}`);
                }
            }

            return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            return { content: [{ type: 'text' as const, text: `Generation failed: ${msg}` }] };
        }
    },
);

// --- Tool: morphkit_plan ---

server.tool(
    'morphkit_plan',
    'Generate a comprehensive iOS conversion plan for a web app. Scores each screen as essential/recommended/optional/skip for mobile, estimates complexity, detects backend integrations, and recommends which screens to build. Use before morphkit_generate to preview what will be created.',
    {
        path: z.string().describe('Path to the web app directory'),
    },
    async ({ path: appPath }) => {
        const resolvedPath = resolve(appPath);
        if (!existsSync(resolvedPath)) {
            return { content: [{ type: 'text' as const, text: `Error: Directory not found: ${resolvedPath}` }] };
        }

        try {
            const analysisResult = await analyzeRepo(resolvedPath);
            const model = await buildSemanticModel(analysisResult);
            const plan = generatePlan(model);

            return { content: [{ type: 'text' as const, text: plan }] };
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            return { content: [{ type: 'text' as const, text: `Planning failed: ${msg}` }] };
        }
    },
);

// --- Tool: morphkit_screen_context ---

server.tool(
    'morphkit_screen_context',
    'Returns everything needed to complete a screen in a generated iOS project: the View file, related Models, APIClient methods, reference implementation patterns, and API contract from CLAUDE.md. One call gives full context for implementing a screen.',
    {
        project_path: z.string().describe('Path to the generated iOS project directory'),
        screen_name: z.string().describe('Name of the screen (e.g. "Cart", "ProductDetail")'),
    },
    async ({ project_path, screen_name }) => {
        const projectDir = resolve(project_path);
        if (!existsSync(projectDir)) {
            return { content: [{ type: 'text' as const, text: `Error: Directory not found: ${projectDir}` }] };
        }

        try {
            const toPascalCase = (name: string) =>
                name.replace(/(?:^|[-_\s])(\w)/g, (_, c) => c.toUpperCase()).replace(/[-_\s]/g, '');

            const pascalName = toPascalCase(screen_name);
            const screenLower = screen_name.toLowerCase();
            const lines: string[] = [];

            // --- Find the View file ---
            const viewFileName = `${pascalName}View.swift`;
            let viewFilePath = '';
            let viewContent = '';

            // Try common paths: {project}/Views/{file}, {project}/{appName}/Views/{file}
            const candidatePaths = [
                join(projectDir, 'Views', viewFileName),
            ];
            // Also check subdirectories (the appName subfolder)
            try {
                const topEntries = readdirSync(projectDir);
                for (const entry of topEntries) {
                    const entryPath = join(projectDir, entry);
                    if (statSync(entryPath).isDirectory() && entry !== 'node_modules' && !entry.startsWith('.')) {
                        candidatePaths.push(join(entryPath, 'Views', viewFileName));
                    }
                }
            } catch { /* ignore */ }

            for (const candidate of candidatePaths) {
                if (existsSync(candidate)) {
                    viewFilePath = candidate;
                    viewContent = readFileSync(candidate, 'utf-8');
                    break;
                }
            }

            lines.push(`## Screen: ${pascalName}View`);
            lines.push('');

            if (viewContent) {
                lines.push(`### View File (${viewFilePath})`);
                lines.push('```swift');
                lines.push(viewContent);
                lines.push('```');
            } else {
                lines.push(`### View File`);
                lines.push(`_Not found: looked for ${viewFileName} in Views/ directories_`);
            }
            lines.push('');

            // --- Find related Model files ---
            lines.push('### Related Models');
            const modelDir = (() => {
                const direct = join(projectDir, 'Models');
                if (existsSync(direct)) return direct;
                try {
                    const topEntries = readdirSync(projectDir);
                    for (const entry of topEntries) {
                        const sub = join(projectDir, entry, 'Models');
                        if (existsSync(sub) && statSync(sub).isDirectory()) return sub;
                    }
                } catch { /* ignore */ }
                return null;
            })();

            if (modelDir && viewContent) {
                // Extract type references from the view file
                const typeRefs = new Set<string>();
                const statePattern = /:\s*([A-Z][A-Za-z0-9]+)(?=[?<\s,)\n]|$)/gm;
                let match;
                while ((match = statePattern.exec(viewContent)) !== null) {
                    const typeName = match[1];
                    // Skip common SwiftUI types
                    if (!['View', 'State', 'Binding', 'Published', 'Observable', 'String', 'Int', 'Double', 'Bool', 'Float', 'Date', 'UUID', 'Color', 'Image', 'Text', 'NavigationStack', 'VStack', 'HStack', 'ZStack', 'List', 'ForEach', 'Button', 'TextField', 'Alert', 'Sheet', 'NavigationLink', 'ScrollView', 'LazyVStack', 'LazyHStack', 'Some', 'AnyView', 'EmptyView', 'Spacer', 'Divider', 'Section', 'Group', 'GeometryReader', 'AsyncImage', 'ProgressView', 'Error'].includes(typeName)) {
                        typeRefs.add(typeName);
                    }
                }

                // Also look for array type references like [TypeName]
                const arrayPattern = /\[([A-Z][A-Za-z0-9]+)\]/g;
                while ((match = arrayPattern.exec(viewContent)) !== null) {
                    const typeName = match[1];
                    if (!['String', 'Int', 'Double', 'Bool', 'Float', 'Date', 'UUID', 'Any'].includes(typeName)) {
                        typeRefs.add(typeName);
                    }
                }

                let foundModels = false;
                try {
                    const modelFiles = readdirSync(modelDir).filter(f => f.endsWith('.swift'));
                    for (const mf of modelFiles) {
                        const modelName = mf.replace('.swift', '');
                        if (typeRefs.has(modelName)) {
                            const modelContent = readFileSync(join(modelDir, mf), 'utf-8');
                            lines.push(`#### ${mf}`);
                            lines.push('```swift');
                            lines.push(modelContent);
                            lines.push('```');
                            lines.push('');
                            foundModels = true;
                        }
                    }
                } catch { /* ignore */ }

                if (!foundModels) {
                    lines.push(`_No matching model files found for types: ${[...typeRefs].join(', ') || 'none detected'}_`);
                }
            } else if (!modelDir) {
                lines.push('_Models/ directory not found_');
            } else {
                lines.push('_Could not extract type references (view file not found)_');
            }
            lines.push('');

            // --- Find APIClient methods ---
            lines.push('### APIClient Methods');
            const apiClientPath = (() => {
                const direct = join(projectDir, 'Networking', 'APIClient.swift');
                if (existsSync(direct)) return direct;
                try {
                    const topEntries = readdirSync(projectDir);
                    for (const entry of topEntries) {
                        const sub = join(projectDir, entry, 'Networking', 'APIClient.swift');
                        if (existsSync(sub)) return sub;
                    }
                } catch { /* ignore */ }
                return null;
            })();

            if (apiClientPath) {
                const apiContent = readFileSync(apiClientPath, 'utf-8');
                // Extract methods that reference the screen's entity
                const apiLines = apiContent.split('\n');
                const relevantMethods: string[] = [];
                let inMethod = false;
                let braceDepth = 0;
                let currentMethod: string[] = [];

                for (const line of apiLines) {
                    if (line.includes('func ') && (
                        line.toLowerCase().includes(screenLower) ||
                        line.toLowerCase().includes(pascalName.toLowerCase())
                    )) {
                        inMethod = true;
                        braceDepth = 0;
                        currentMethod = [];
                    }

                    if (inMethod) {
                        currentMethod.push(line);
                        braceDepth += (line.match(/\{/g) || []).length;
                        braceDepth -= (line.match(/\}/g) || []).length;
                        if (braceDepth <= 0 && currentMethod.length > 1) {
                            relevantMethods.push(currentMethod.join('\n'));
                            inMethod = false;
                            currentMethod = [];
                        }
                    }
                }

                if (relevantMethods.length > 0) {
                    lines.push('```swift');
                    lines.push(relevantMethods.join('\n\n'));
                    lines.push('```');
                } else {
                    // Fall back to showing method signatures
                    const signatures = apiLines
                        .filter(l => l.trim().startsWith('func '))
                        .map(l => l.trim());
                    lines.push('_No methods directly referencing this screen entity. All methods:_');
                    lines.push('```swift');
                    lines.push(signatures.join('\n'));
                    lines.push('```');
                }
            } else {
                lines.push('_APIClient.swift not found_');
            }
            lines.push('');

            // --- Find reference implementation ---
            lines.push('### Reference Implementation');
            let foundRef = false;
            const searchDirs = [join(projectDir, 'Views')];
            try {
                const topEntries = readdirSync(projectDir);
                for (const entry of topEntries) {
                    const sub = join(projectDir, entry, 'Views');
                    if (existsSync(sub) && statSync(sub).isDirectory()) {
                        searchDirs.push(sub);
                    }
                }
            } catch { /* ignore */ }

            for (const dir of searchDirs) {
                if (!existsSync(dir)) continue;
                try {
                    const files = readdirSync(dir).filter(f => f.endsWith('.swift'));
                    for (const f of files) {
                        const filePath = join(dir, f);
                        const content = readFileSync(filePath, 'utf-8');
                        if (content.includes('REFERENCE IMPLEMENTATION')) {
                            lines.push(`#### ${f} (reference)`);
                            lines.push('```swift');
                            lines.push(content);
                            lines.push('```');
                            foundRef = true;
                            break;
                        }
                    }
                    if (foundRef) break;
                } catch { /* ignore */ }
            }
            if (!foundRef) {
                lines.push('_No reference implementation file found_');
            }
            lines.push('');

            // --- Find API Contract from CLAUDE.md ---
            lines.push('### API Contract');
            const claudeMdPath = (() => {
                const direct = join(projectDir, 'CLAUDE.md');
                if (existsSync(direct)) return direct;
                try {
                    const topEntries = readdirSync(projectDir);
                    for (const entry of topEntries) {
                        const sub = join(projectDir, entry, 'CLAUDE.md');
                        if (existsSync(sub)) return sub;
                    }
                } catch { /* ignore */ }
                return null;
            })();

            if (claudeMdPath) {
                const claudeContent = readFileSync(claudeMdPath, 'utf-8');
                // Extract sections relevant to this screen
                const sections = claudeContent.split(/^## /m);
                const relevantSections = sections.filter(s =>
                    s.toLowerCase().includes(screenLower) ||
                    s.toLowerCase().includes(pascalName.toLowerCase()) ||
                    s.toLowerCase().includes('api contract') ||
                    s.toLowerCase().includes('endpoint')
                );

                if (relevantSections.length > 0) {
                    for (const section of relevantSections) {
                        lines.push(`## ${section.trim()}`);
                        lines.push('');
                    }
                } else {
                    lines.push('_No API contract section found referencing this screen_');
                }
            } else {
                lines.push('_CLAUDE.md not found in project_');
            }

            return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            return { content: [{ type: 'text' as const, text: `Screen context failed: ${msg}` }] };
        }
    },
);

// --- Tool: morphkit_verify ---

server.tool(
    'morphkit_verify',
    'Verify a generated iOS project: checks for TODO placeholders, missing implementations, file structure issues, and completeness. Returns both a human-readable summary and raw JSON for programmatic parsing.',
    {
        project_path: z.string().describe('Path to the generated iOS project'),
    },
    async ({ project_path }) => {
        const projectDir = resolve(project_path);
        if (!existsSync(projectDir)) {
            return { content: [{ type: 'text' as const, text: `Error: Directory not found: ${projectDir}` }] };
        }

        try {
            const result = verifyProject(projectDir);
            const formatted = formatVerifyResult(result);
            const jsonResult = JSON.stringify(result, null, 2);

            const output = `${formatted}\n\n---\n\n## Raw Result (JSON)\n\`\`\`json\n${jsonResult}\n\`\`\``;
            return { content: [{ type: 'text' as const, text: output }] };
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            return { content: [{ type: 'text' as const, text: `Verification failed: ${msg}` }] };
        }
    },
);

// --- Tool: morphkit_next_task ---

server.tool(
    'morphkit_next_task',
    'Analyzes a generated iOS project and recommends the next screen to complete. Considers TODO count, dependency order from CLAUDE.md completion manifest, and implementation status.',
    {
        project_path: z.string().describe('Path to the generated iOS project'),
    },
    async ({ project_path }) => {
        const projectDir = resolve(project_path);
        if (!existsSync(projectDir)) {
            return { content: [{ type: 'text' as const, text: `Error: Directory not found: ${projectDir}` }] };
        }

        try {
            const result = verifyProject(projectDir);

            // Find the file with the most TODOs
            let maxTodos = 0;
            let maxFile = '';
            const fileTodoCounts: Array<{ file: string; count: number }> = [];

            for (const [file, count] of Object.entries(result.todosByFile)) {
                fileTodoCounts.push({ file, count });
                if (count > maxTodos) {
                    maxTodos = count;
                    maxFile = file;
                }
            }

            // Sort by TODO count descending
            fileTodoCounts.sort((a, b) => b.count - a.count);

            // Check for dependency order in CLAUDE.md
            let dependencyOrder: string[] = [];
            const claudeMdPath = (() => {
                const direct = join(projectDir, 'CLAUDE.md');
                if (existsSync(direct)) return direct;
                try {
                    const topEntries = readdirSync(projectDir);
                    for (const entry of topEntries) {
                        const sub = join(projectDir, entry, 'CLAUDE.md');
                        if (existsSync(sub)) return sub;
                    }
                } catch { /* ignore */ }
                return null;
            })();

            if (claudeMdPath) {
                const claudeContent = readFileSync(claudeMdPath, 'utf-8');
                // Look for completion manifest JSON block
                const manifestMatch = claudeContent.match(/```json\s*\n(\{[\s\S]*?"completionOrder"[\s\S]*?\})\s*\n```/);
                if (manifestMatch) {
                    try {
                        const manifest = JSON.parse(manifestMatch[1]);
                        if (Array.isArray(manifest.completionOrder)) {
                            dependencyOrder = manifest.completionOrder;
                        }
                    } catch { /* ignore parse errors */ }
                }
            }

            // Determine the recommended next screen
            const lines: string[] = [];
            lines.push('# Next Task Recommendation');
            lines.push('');

            if (fileTodoCounts.length === 0) {
                lines.push('All screens appear complete — no TODOs found.');
                return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
            }

            // If we have a dependency order, prefer the first incomplete item
            let recommendedFile = maxFile;
            let reason = `Has the most TODOs (${maxTodos})`;

            if (dependencyOrder.length > 0) {
                for (const screenName of dependencyOrder) {
                    const matching = fileTodoCounts.find(f =>
                        f.file.toLowerCase().includes(screenName.toLowerCase()) && f.count > 0
                    );
                    if (matching) {
                        recommendedFile = matching.file;
                        reason = `Next in dependency order from CLAUDE.md completion manifest (${matching.count} TODOs)`;
                        break;
                    }
                }
            }

            // Extract screen name from file path
            const screenFileName = basename(recommendedFile, '.swift');
            const screenName = screenFileName.replace(/View$/, '');

            lines.push(`## Recommended: ${screenName}`);
            lines.push(`**File:** ${recommendedFile}`);
            lines.push(`**Why:** ${reason}`);
            lines.push('');

            // Show TODO count for the recommended file
            const recommendedEntry = fileTodoCounts.find(f => f.file === recommendedFile);
            if (recommendedEntry && recommendedEntry.count > 0) {
                lines.push(`### TODOs in ${screenFileName}: ${recommendedEntry.count}`);
                // Show category breakdown if available
                const categoryBreakdown = Object.entries(result.todosByCategory)
                    .filter(([, c]) => c > 0)
                    .map(([cat, c]) => `  - ${cat}: ${c}`)
                    .join('\n');
                if (categoryBreakdown) {
                    lines.push(categoryBreakdown);
                }
                lines.push('');
            }

            // Show overview of all files with TODOs
            lines.push('### All Files with TODOs');
            for (const entry of fileTodoCounts.slice(0, 15)) {
                const marker = entry.file === recommendedFile ? ' **← next**' : '';
                lines.push(`- \`${basename(entry.file)}\` — ${entry.count} TODOs${marker}`);
            }
            if (fileTodoCounts.length > 15) {
                lines.push(`- ... and ${fileTodoCounts.length - 15} more files`);
            }
            lines.push('');

            lines.push('### Suggested Command');
            lines.push(`\`/complete-screen ${screenName}\``);

            return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            return { content: [{ type: 'text' as const, text: `Next task analysis failed: ${msg}` }] };
        }
    },
);

// ---------------------------------------------------------------------------
// Tool: morphkit_completion_status
// ---------------------------------------------------------------------------

server.tool(
    'morphkit_completion_status',
    'Returns machine-readable JSON with exact TODO locations, categories, line numbers, and completion percentages. Designed for automated completion loops.',
    {
        project_path: z.string().describe('Path to the generated iOS project'),
    },
    async ({ project_path }) => {
        const projectDir = resolve(project_path);
        if (!existsSync(projectDir)) {
            return { content: [{ type: 'text' as const, text: `Error: Directory not found: ${projectDir}` }] };
        }

        try {
            const result = verifyProject(projectDir);
            const todos = getDetailedTodos(projectDir);

            const status = {
                buildStatus: result.buildStatus,
                buildErrors: result.buildErrors,
                totalTodos: result.totalTodos,
                todosByCategory: result.todosByCategory,
                overallPercentage: result.overallPercentage,
                screenCompletion: result.screenCompletion,
                apiCoverage: result.apiCoverage,
                modelCompleteness: result.modelCompleteness,
                nextStep: result.nextStep,
                todos: todos.map(t => ({
                    file: t.relativePath,
                    line: t.line,
                    category: t.category,
                    screen: t.screenName,
                    hint: t.hint,
                })),
            };

            return { content: [{ type: 'text' as const, text: JSON.stringify(status, null, 2) }] };
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            return { content: [{ type: 'text' as const, text: `Completion status failed: ${msg}` }] };
        }
    },
);

// ---------------------------------------------------------------------------
// Tool: morphkit_complete_screen
// ---------------------------------------------------------------------------

server.tool(
    'morphkit_complete_screen',
    'Returns the full context needed to complete a single screen in a generated iOS project. Includes the view file content, relevant API client methods, model structs, and the reference implementation. Use this context to write the completed file.',
    {
        project_path: z.string().describe('Path to the generated iOS project'),
        screen_name: z.string().describe('Screen name (e.g., "Products", "ProductsDetail")'),
    },
    async ({ project_path, screen_name }) => {
        const projectDir = resolve(project_path);
        if (!existsSync(projectDir)) {
            return { content: [{ type: 'text' as const, text: `Error: Directory not found: ${projectDir}` }] };
        }

        try {
            // Find the view file
            const allSwiftFiles = findSwiftFilesInDir(projectDir);
            const viewFile = allSwiftFiles.find(f =>
                f.toLowerCase().includes(`${screen_name.toLowerCase()}view.swift`) ||
                f.toLowerCase().endsWith(`${screen_name.toLowerCase()}.swift`)
            );

            if (!viewFile) {
                return { content: [{ type: 'text' as const, text: `Error: Could not find view file for screen "${screen_name}"` }] };
            }

            const viewContent = readFileSync(viewFile, 'utf-8');

            // Find APIClient
            const apiClientFile = allSwiftFiles.find(f => f.endsWith('APIClient.swift'));
            const apiContent = apiClientFile ? readFileSync(apiClientFile, 'utf-8') : '';

            // Find model files referenced by the view (limit context size)
            const allModelFiles = allSwiftFiles.filter(f => f.includes('/Models/'));
            const modelContents: string[] = [];
            // Extract type names from view to filter relevant models
            const viewTypeRefs = new Set(
                (viewContent.match(/\b[A-Z][A-Za-z0-9]+\b/g) ?? [])
                    .filter(t => !['State', 'View', 'String', 'Int', 'Double', 'Bool', 'Date', 'UUID', 'Color', 'Image', 'Text', 'Button', 'VStack', 'HStack', 'List', 'NavigationStack', 'ScrollView', 'ForEach', 'Group', 'Section', 'Spacer', 'ProgressView', 'AsyncImage', 'NavigationLink', 'Picker', 'Menu', 'ToolbarItem', 'SwiftUI', 'Foundation', 'Observation', 'Observable'].includes(t))
            );
            for (const mf of allModelFiles) {
                const modelName = basename(mf, '.swift');
                // Include if the model name matches a type referenced in the view, or limit to 10 files max
                if (viewTypeRefs.has(modelName) || modelContents.length < 10) {
                    modelContents.push(`// === ${basename(mf)} ===\n${readFileSync(mf, 'utf-8')}`);
                }
            }

            // Find reference implementation (REFERENCE IMPL marker)
            const refFile = allSwiftFiles.find(f => {
                const content = readFileSync(f, 'utf-8');
                return content.includes('REFERENCE IMPLEMENTATION') || content.includes('REFERENCE IMPL');
            });
            const refContent = refFile ? `// === Reference: ${basename(refFile)} ===\n${readFileSync(refFile, 'utf-8')}` : '';

            // Find CLAUDE.md — bounded to project directory and its parent
            const resolvedProjectDir = resolve(projectDir);
            const projectParentDir = resolve(projectDir, '..');
            const claudeMdCandidates = [
                join(resolvedProjectDir, 'CLAUDE.md'),
                join(projectParentDir, 'CLAUDE.md'),
                ...new Set(allSwiftFiles.map(f => join(dirname(dirname(f)), 'CLAUDE.md'))),
            ].filter(p => {
                const rp = resolve(p);
                return rp.startsWith(resolvedProjectDir) || rp.startsWith(projectParentDir);
            });
            const claudeMd = claudeMdCandidates.find(p => existsSync(p));
            const claudeContent = claudeMd ? readFileSync(claudeMd, 'utf-8') : '';

            // Get TODOs for this screen
            const todos = getDetailedTodos(projectDir).filter(t =>
                t.relativePath.toLowerCase().includes(screen_name.toLowerCase())
            );

            const lines: string[] = [];
            lines.push(`# Context for completing: ${screen_name}`);
            lines.push('');
            lines.push(`## TODOs (${todos.length})`);
            for (const todo of todos) {
                lines.push(`- Line ${todo.line}: [${todo.category}] ${todo.hint || todo.context.split('\n')[0]}`);
            }
            lines.push('');
            lines.push('## View File');
            lines.push('```swift');
            lines.push(viewContent);
            lines.push('```');
            lines.push('');
            if (apiContent) {
                lines.push('## APIClient (full implementation)');
                lines.push('```swift');
                lines.push(apiContent);
                lines.push('```');
                lines.push('');
            }
            if (modelContents.length > 0) {
                lines.push('## Model Structs');
                lines.push('```swift');
                lines.push(modelContents.join('\n\n'));
                lines.push('```');
                lines.push('');
            }
            if (refContent) {
                lines.push('## Reference Implementation');
                lines.push('```swift');
                lines.push(refContent);
                lines.push('```');
                lines.push('');
            }

            // Include the ORIGINAL React source code so Claude Code can see
            // what the web component looks like and rewrite the Swift to match
            const sourceMatch = viewContent.match(/\/\/ Generated by Morphkit.*?from:\s*(.+)/);
            if (sourceMatch) {
                const reactSourcePath = sourceMatch[1].trim();
                // Try to find the file relative to common project roots
                const candidates = [
                    reactSourcePath,
                    join(projectDir, '..', '..', reactSourcePath),
                    join(projectDir, '..', reactSourcePath),
                ];
                for (const candidate of candidates) {
                    const resolved = resolve(candidate);
                    if (existsSync(resolved)) {
                        try {
                            const reactSource = readFileSync(resolved, 'utf-8');
                            lines.push('## Original React Source');
                            lines.push(`File: ${reactSourcePath}`);
                            lines.push('```tsx');
                            lines.push(reactSource);
                            lines.push('```');
                            lines.push('');
                            lines.push('**Instructions**: Rewrite the Swift view above to match the React component\'s visual structure and functionality. Keep the same SwiftUI patterns (@State, .task, NavigationStack) but make the UI match what the React component renders.');
                        } catch { /* skip if can't read */ }
                        break;
                    }
                }
            }

            return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            return { content: [{ type: 'text' as const, text: `Screen context failed: ${msg}` }] };
        }
    },
);

// ---------------------------------------------------------------------------
// Tool: morphkit_fix_build_error
// ---------------------------------------------------------------------------

server.tool(
    'morphkit_fix_build_error',
    'Parses Swift build errors and returns structured context for fixing them. Reads the offending files and suggests fix patterns.',
    {
        project_path: z.string().describe('Path to the generated iOS project'),
        error_output: z.string().describe('The stderr output from a failed swift build'),
    },
    async ({ project_path, error_output }) => {
        const projectDir = resolve(project_path);
        if (!existsSync(projectDir)) {
            return { content: [{ type: 'text' as const, text: `Error: Directory not found: ${projectDir}` }] };
        }

        try {
            // Parse Swift compiler errors
            const errorLines = error_output.split('\n').filter(l => l.includes('error:'));
            const parsedErrors: Array<{ file: string; line: number; message: string }> = [];

            for (const line of errorLines) {
                const match = line.match(/([^/\s]+\.swift):(\d+):\d+:\s*error:\s*(.+)$/);
                if (match) {
                    parsedErrors.push({
                        file: match[1],
                        line: parseInt(match[2], 10),
                        message: match[3],
                    });
                }
            }

            if (parsedErrors.length === 0) {
                return { content: [{ type: 'text' as const, text: 'No parseable Swift errors found in the output.' }] };
            }

            // Group by file
            const byFile = new Map<string, typeof parsedErrors>();
            for (const err of parsedErrors) {
                const existing = byFile.get(err.file) ?? [];
                existing.push(err);
                byFile.set(err.file, existing);
            }

            const lines: string[] = [];
            lines.push(`# Build Errors (${parsedErrors.length})`);
            lines.push('');

            for (const [fileName, errors] of byFile) {
                lines.push(`## ${fileName}`);

                // Try to find and read the file
                const allSwiftFiles = findSwiftFilesInDir(projectDir);
                const fullPath = allSwiftFiles.find(f => f.endsWith(fileName));
                if (fullPath) {
                    const content = readFileSync(fullPath, 'utf-8');
                    const fileLines = content.split('\n');

                    for (const err of errors) {
                        lines.push(`### Line ${err.line}: ${err.message}`);
                        // Show context: 3 lines before and after
                        const start = Math.max(0, err.line - 4);
                        const end = Math.min(fileLines.length, err.line + 3);
                        lines.push('```swift');
                        for (let i = start; i < end; i++) {
                            const marker = i === err.line - 1 ? '>>>' : '   ';
                            lines.push(`${marker} ${i + 1}: ${fileLines[i]}`);
                        }
                        lines.push('```');
                        lines.push('');
                    }
                } else {
                    for (const err of errors) {
                        lines.push(`- Line ${err.line}: ${err.message}`);
                    }
                }
                lines.push('');
            }

            return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            return { content: [{ type: 'text' as const, text: `Error parsing build output: ${msg}` }] };
        }
    },
);

// Helper for MCP tools - find all .swift files recursively
function findSwiftFilesInDir(dir: string): string[] {
    const results: string[] = [];
    if (!existsSync(dir)) return results;
    try {
        const entries = readdirSync(dir);
        for (const entry of entries) {
            if (entry.startsWith('.') || entry === 'Build' || entry === '.build') continue;
            const full = join(dir, entry);
            try {
                const s = statSync(full);
                if (s.isDirectory()) results.push(...findSwiftFilesInDir(full));
                else if (entry.endsWith('.swift')) results.push(full);
            } catch { /* skip */ }
        }
    } catch { /* skip */ }
    return results;
}

// ---------------------------------------------------------------------------
// Feature Context Tool — cross-file context for multi-file features
// ---------------------------------------------------------------------------

server.tool(
    'morphkit_feature_context',
    'Returns all files related to a feature (auth, billing, research, etc.) for cross-file understanding. Groups views, models, managers, and API methods that work together.',
    {
        project_path: z.string().describe('Path to the generated iOS project'),
        feature: z.string().describe('Feature name: auth, billing, research, settings, team, etc.'),
    },
    async ({ project_path, feature }) => {
        const projectDir = resolve(project_path);
        if (!existsSync(projectDir)) {
            return { content: [{ type: 'text' as const, text: `Error: Directory not found: ${projectDir}` }] };
        }

        try {
            const allSwiftFiles = findSwiftFilesInDir(projectDir);
            const featureLower = feature.toLowerCase();
            const lines: string[] = [];
            lines.push(`# Feature Context: ${feature}`);
            lines.push('');

            // Find files matching the feature name
            const matchingFiles = allSwiftFiles.filter(f => {
                const name = basename(f).toLowerCase();
                const content = readFileSync(f, 'utf-8');
                return name.includes(featureLower) ||
                    content.toLowerCase().includes(`// mark: - ${featureLower}`) ||
                    (featureLower === 'auth' && (name.includes('auth') || name.includes('login') || name.includes('register') || name.includes('supabase'))) ||
                    (featureLower === 'billing' && (name.includes('billing') || name.includes('payment') || name.includes('checkout') || name.includes('stripe'))) ||
                    (featureLower === 'research' && (name.includes('research') || name.includes('dashboard') || name.includes('sse')));
            });

            // Also find APIClient methods related to this feature
            const apiClientFile = allSwiftFiles.find(f => f.endsWith('APIClient.swift'));

            if (matchingFiles.length === 0) {
                return { content: [{ type: 'text' as const, text: `No files found for feature: ${feature}` }] };
            }

            // Group by directory
            const byDir = new Map<string, string[]>();
            for (const f of matchingFiles) {
                const rel = f.replace(projectDir + '/', '');
                const dir = rel.split('/').slice(0, -1).join('/') || 'root';
                const existing = byDir.get(dir) ?? [];
                existing.push(f);
                byDir.set(dir, existing);
            }

            for (const [dir, files] of byDir) {
                lines.push(`## ${dir}/`);
                for (const f of files) {
                    const content = readFileSync(f, 'utf-8');
                    lines.push(`### ${basename(f)}`);
                    lines.push('```swift');
                    lines.push(content);
                    lines.push('```');
                    lines.push('');
                }
            }

            // Include relevant APIClient methods
            if (apiClientFile) {
                const apiContent = readFileSync(apiClientFile, 'utf-8');
                lines.push('## APIClient (full)');
                lines.push('```swift');
                lines.push(apiContent);
                lines.push('```');
            }

            // Get TODOs for this feature
            const todos = getDetailedTodos(projectDir).filter(t =>
                matchingFiles.some(f => f === t.file)
            );
            if (todos.length > 0) {
                lines.push('');
                lines.push(`## Remaining TODOs (${todos.length})`);
                for (const todo of todos) {
                    lines.push(`- ${todo.relativePath}:${todo.line} [${todo.category}] ${todo.hint || todo.context.split('\n')[0]}`);
                }
            }

            return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            return { content: [{ type: 'text' as const, text: `Feature context failed: ${msg}` }] };
        }
    },
);

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

main().catch((error) => {
    console.error('Morphkit MCP server failed to start:', error);
    process.exit(1);
});

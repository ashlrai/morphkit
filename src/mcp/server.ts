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

import { existsSync } from 'fs';
import { resolve } from 'path';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { analyzeRepo } from '../analyzer/index.js';
import { generateProject } from '../generator/index.js';
import { adaptForPlatform } from '../semantic/adapter.js';
import { buildSemanticModel } from '../semantic/builder.js';
import type { SemanticAppModel } from '../semantic/model.js';

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
    version: '0.1.0',
});

// --- Tool: morphkit_analyze ---

server.tool(
    'morphkit_analyze',
    'Analyze a TypeScript/React web app and return its semantic model (entities, screens, API endpoints, auth patterns, navigation structure). Use this to understand what a web app does before generating an iOS version.',
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
    'Generate a complete SwiftUI iOS project from a TypeScript/React web app. Creates an Xcode-ready project with models, views, navigation, networking, and a CLAUDE.md with full API contract and implementation guide.',
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
    'Generate a prioritized implementation plan for a web app\'s iOS conversion. Analyzes the web app and returns a step-by-step guide for what to implement first, what API endpoints to wire, and what models need fields added.',
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

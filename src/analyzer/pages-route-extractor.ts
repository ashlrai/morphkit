/**
 * Pages Router Route Extractor — extracts routes from Next.js Pages Router
 * directory structure (pages/ directory with file-based routing).
 *
 * Handles:
 * - Static routes: pages/about.tsx → /about
 * - Index routes: pages/products/index.tsx → /products
 * - Dynamic routes: pages/products/[id].tsx → /products/:id
 * - Catch-all routes: pages/[...slug].tsx → /[...slug]
 * - Nested routes: pages/dashboard/settings.tsx → /dashboard/settings
 * - _app.tsx and _document.tsx are skipped (they're layout wrappers)
 */

import * as path from 'path';

import type { Project } from 'ts-morph';

import type { RepoScanResult, FileEntry } from './repo-scanner.js';
import type { ExtractedRoute, RouteSegment, NavigationKind } from './route-extractor.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseSegmentFromFilename(name: string): RouteSegment {
    // Catch-all: [...slug]
    if (name.startsWith('[...') && name.endsWith(']')) {
        const paramName = name.slice(4, -1);
        return { raw: name, name: paramName, kind: 'catch-all', paramName };
    }
    // Optional catch-all: [[...slug]]
    if (name.startsWith('[[...') && name.endsWith(']]')) {
        const paramName = name.slice(5, -2);
        return { raw: name, name: paramName, kind: 'optional-catch-all', paramName };
    }
    // Dynamic: [id]
    if (name.startsWith('[') && name.endsWith(']')) {
        const paramName = name.slice(1, -1);
        return { raw: name, name: paramName, kind: 'dynamic', paramName };
    }
    // Static
    return { raw: name, name, kind: 'static', paramName: undefined };
}

function suggestNavigation(urlPath: string, allPaths: string[]): NavigationKind {
    const depth = urlPath.split('/').filter(Boolean).length;
    if (depth === 0) return 'tab';
    if (depth === 1) {
        // Top-level routes are tab candidates
        const topLevelCount = allPaths.filter(p => p.split('/').filter(Boolean).length <= 1).length;
        return topLevelCount >= 2 && topLevelCount <= 6 ? 'tab' : 'stack';
    }
    if (urlPath.includes('[')) return 'stack';
    return 'stack';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract routes from a Next.js Pages Router directory structure.
 */
export function extractPagesRoutes(
    repoPath: string,
    scanResult: RepoScanResult,
    _project?: Project,
): ExtractedRoute[] {
    console.log(`[morphkit] Extracting Pages Router routes from ${repoPath}`);

    const allFiles = scanResult.allFiles;

    // Find the pages directory
    const pagesPrefixes = ['pages/', 'src/pages/'];
    let pagesPrefix = '';
    for (const prefix of pagesPrefixes) {
        if (allFiles.some(f => f.relativePath.startsWith(prefix))) {
            pagesPrefix = prefix;
            break;
        }
    }

    if (!pagesPrefix) {
        console.log('[morphkit] No pages/ directory found');
        return [];
    }

    // Find all page files (skip _app, _document, _error, api routes)
    const skipFiles = new Set(['_app', '_document', '_error', '404', '500']);
    const pageFiles: FileEntry[] = [];

    for (const file of allFiles) {
        const rel = file.relativePath;
        if (!rel.startsWith(pagesPrefix)) continue;
        if (!/\.(tsx?|jsx?)$/.test(rel)) continue;

        const afterPages = rel.slice(pagesPrefix.length);
        // Skip API routes
        if (afterPages.startsWith('api/')) continue;

        const baseName = path.basename(afterPages).replace(/\.(ts|tsx|js|jsx)$/, '');
        if (skipFiles.has(baseName)) continue;

        pageFiles.push(file);
    }

    if (pageFiles.length === 0) {
        console.log('[morphkit] No page files found in Pages Router');
        return [];
    }

    // Convert file paths to URL paths
    const routes: ExtractedRoute[] = [];
    const allUrlPaths: string[] = [];

    for (const file of pageFiles) {
        const rel = file.relativePath.slice(pagesPrefix.length);
        const withoutExt = rel.replace(/\.(ts|tsx|js|jsx)$/, '');

        // Build URL path
        let urlPath: string;
        if (withoutExt === 'index') {
            urlPath = '/';
        } else if (withoutExt.endsWith('/index')) {
            urlPath = '/' + withoutExt.slice(0, -6);
        } else {
            urlPath = '/' + withoutExt;
        }

        allUrlPaths.push(urlPath);
    }

    // Second pass: create ExtractedRoute objects
    for (const file of pageFiles) {
        const rel = file.relativePath.slice(pagesPrefix.length);
        const withoutExt = rel.replace(/\.(ts|tsx|js|jsx)$/, '');

        let urlPath: string;
        if (withoutExt === 'index') {
            urlPath = '/';
        } else if (withoutExt.endsWith('/index')) {
            urlPath = '/' + withoutExt.slice(0, -6);
        } else {
            urlPath = '/' + withoutExt;
        }

        // Parse segments
        const pathParts = urlPath.split('/').filter(Boolean);
        const segments: RouteSegment[] = pathParts.map(parseSegmentFromFilename);

        const isDynamic = segments.some(s => s.kind === 'dynamic' || s.kind === 'catch-all' || s.kind === 'optional-catch-all');

        // Find parent and children
        const parentPath = pathParts.length > 1
            ? '/' + pathParts.slice(0, -1).join('/')
            : urlPath === '/' ? undefined : '/';

        const childPaths = allUrlPaths.filter(p => {
            if (p === urlPath) return false;
            const parts = p.split('/').filter(Boolean);
            return parts.length === pathParts.length + 1 &&
                p.startsWith(urlPath === '/' ? '/' : urlPath + '/');
        });

        routes.push({
            urlPath,
            segments,
            files: {
                page: file.absolutePath,
                layout: undefined,  // Pages Router uses _app.tsx globally
                loading: undefined,
                error: undefined,
                notFound: undefined,
                template: undefined,
            },
            metadata: {
                title: undefined,
                description: undefined,
                rawText: undefined,
                isDynamic: false,
            },
            parentPath,
            childPaths,
            parallelSlots: [],
            suggestedNavigation: suggestNavigation(urlPath, allUrlPaths),
            hasLayout: false,
            isDynamic,
        });
    }

    console.log(`[morphkit] Extracted ${routes.length} Pages Router routes`);
    return routes;
}

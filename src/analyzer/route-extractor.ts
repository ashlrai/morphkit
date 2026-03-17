/**
 * Route Extractor — parses Next.js App Router directory structure into a
 * navigable route tree, identifying tab and stack navigation candidates.
 */

import * as path from 'path';
import { Project, SourceFile, Node } from 'ts-morph';
import type { RepoScanResult, FileEntry } from './repo-scanner.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RouteSegmentKind =
  | 'static'
  | 'dynamic'        // [slug]
  | 'catch-all'      // [...slug]
  | 'optional-catch-all' // [[...slug]]
  | 'group'          // (group)
  | 'parallel'       // @slot
  | 'intercepting';  // (.) / (..) / (...) / (..)(..)

export type NavigationKind = 'tab' | 'stack' | 'modal' | 'drawer' | 'unknown';

export interface RouteSegment {
  /** Raw directory name, e.g. "[slug]" or "(marketing)" */
  raw: string;
  /** Cleaned segment name, e.g. "slug" or "marketing" */
  name: string;
  /** Segment kind */
  kind: RouteSegmentKind;
  /** Dynamic parameter name (for dynamic/catch-all) */
  paramName: string | undefined;
}

export interface RouteMetadata {
  /** Title from metadata export */
  title: string | undefined;
  /** Description from metadata export */
  description: string | undefined;
  /** Raw metadata object text */
  rawText: string | undefined;
  /** Whether generateMetadata is used (dynamic) */
  isDynamic: boolean;
}

export interface ExtractedRoute {
  /** Full URL path, e.g. "/dashboard/settings" */
  urlPath: string;
  /** Segments making up this route */
  segments: RouteSegment[];
  /** Files associated with this route */
  files: {
    page: string | undefined;
    layout: string | undefined;
    loading: string | undefined;
    error: string | undefined;
    notFound: string | undefined;
    template: string | undefined;
  };
  /** Extracted metadata */
  metadata: RouteMetadata;
  /** Parent route URL path (undefined for root) */
  parentPath: string | undefined;
  /** Child route URL paths */
  childPaths: string[];
  /** Parallel route slots at this level */
  parallelSlots: string[];
  /** Suggested mobile navigation kind */
  suggestedNavigation: NavigationKind;
  /** Whether this route has a layout wrapper */
  hasLayout: boolean;
  /** Whether this route has dynamic segments */
  isDynamic: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseSegment(dirName: string): RouteSegment {
  // Group route: (name)
  if (/^\((?!\.)/.test(dirName) && dirName.endsWith(')')) {
    return {
      raw: dirName,
      name: dirName.slice(1, -1),
      kind: 'group',
      paramName: undefined,
    };
  }

  // Parallel route: @slot
  if (dirName.startsWith('@')) {
    return {
      raw: dirName,
      name: dirName.slice(1),
      kind: 'parallel',
      paramName: undefined,
    };
  }

  // Intercepting route: (.) or (..) or (...)
  if (/^\(\.\.*\)/.test(dirName)) {
    return {
      raw: dirName,
      name: dirName,
      kind: 'intercepting',
      paramName: undefined,
    };
  }

  // Optional catch-all: [[...slug]]
  if (dirName.startsWith('[[...') && dirName.endsWith(']]')) {
    const paramName = dirName.slice(5, -2);
    return {
      raw: dirName,
      name: paramName,
      kind: 'optional-catch-all',
      paramName,
    };
  }

  // Catch-all: [...slug]
  if (dirName.startsWith('[...') && dirName.endsWith(']')) {
    const paramName = dirName.slice(4, -1);
    return {
      raw: dirName,
      name: paramName,
      kind: 'catch-all',
      paramName,
    };
  }

  // Dynamic: [slug]
  if (dirName.startsWith('[') && dirName.endsWith(']')) {
    const paramName = dirName.slice(1, -1);
    return {
      raw: dirName,
      name: paramName,
      kind: 'dynamic',
      paramName,
    };
  }

  // Static
  return {
    raw: dirName,
    name: dirName,
    kind: 'static',
    paramName: undefined,
  };
}

/**
 * Build a URL path from segments, excluding groups and parallel slots.
 */
function buildUrlPath(segments: RouteSegment[]): string {
  const parts = segments
    .filter((s) => s.kind !== 'group' && s.kind !== 'parallel')
    .map((s) => {
      if (s.kind === 'dynamic') return `:${s.paramName}`;
      if (s.kind === 'catch-all') return `*${s.paramName}`;
      if (s.kind === 'optional-catch-all') return `*${s.paramName}?`;
      return s.name;
    });

  return '/' + parts.join('/');
}

/**
 * Try to extract metadata from a page or layout source file.
 */
function extractMetadata(project: Project, filePath: string | undefined): RouteMetadata {
  const empty: RouteMetadata = {
    title: undefined,
    description: undefined,
    rawText: undefined,
    isDynamic: false,
  };

  if (!filePath) return empty;

  try {
    const sourceFile = project.getSourceFile(filePath);
    if (!sourceFile) return empty;

    // Check for generateMetadata export (dynamic)
    const generateMetadata = sourceFile.getFunction('generateMetadata');
    if (generateMetadata) {
      return { ...empty, isDynamic: true, rawText: generateMetadata.getText().substring(0, 500) };
    }

    // Check for static metadata export
    const metadataVar = sourceFile.getVariableDeclaration('metadata');
    if (metadataVar) {
      const init = metadataVar.getInitializer();
      if (init) {
        const text = init.getText();
        // Try to extract title and description from object literal
        const titleMatch = text.match(/title\s*:\s*['"`]([^'"`]+)['"`]/);
        const descMatch = text.match(/description\s*:\s*['"`]([^'"`]+)['"`]/);
        return {
          title: titleMatch?.[1],
          description: descMatch?.[1],
          rawText: text.substring(0, 500),
          isDynamic: false,
        };
      }
    }

    return empty;
  } catch {
    return empty;
  }
}

/**
 * Determine suggested navigation kind for a route based on heuristics.
 */
function suggestNavigation(
  urlPath: string,
  segments: RouteSegment[],
  hasLayout: boolean,
  childPaths: string[],
  parallelSlots: string[],
): NavigationKind {
  // Root-level routes with layouts and multiple children suggest tabs
  if (urlPath === '/' && childPaths.length >= 2 && hasLayout) {
    return 'tab';
  }

  // Routes at depth 1 that are siblings suggest tabs
  const depth = urlPath.split('/').filter(Boolean).length;
  if (depth === 1 && hasLayout) {
    return 'tab';
  }

  // Parallel routes suggest tabs
  if (parallelSlots.length > 0) {
    return 'tab';
  }

  // Intercepting routes suggest modals
  if (segments.some((s) => s.kind === 'intercepting')) {
    return 'modal';
  }

  // Dynamic detail routes suggest stack push
  if (segments.some((s) => s.kind === 'dynamic') && depth >= 2) {
    return 'stack';
  }

  // Deep routes are generally stack navigation
  if (depth >= 2) {
    return 'stack';
  }

  return 'unknown';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract the route tree from a Next.js App Router codebase.
 */
export function extractRoutes(
  repoPath: string,
  scanResult: RepoScanResult,
  project?: Project,
): ExtractedRoute[] {
  console.log(`[morphkit] Extracting routes from ${repoPath}`);

  const resolvedRoot = path.resolve(repoPath);

  // Combine all route-relevant files
  const routeFiles = [
    ...scanResult.pages,
    ...scanResult.layouts,
    ...scanResult.boundaries,
  ];

  if (routeFiles.length === 0) {
    console.log(`[morphkit] No route files found`);
    return [];
  }

  // Determine app directory prefix
  const appDirPrefixes = ['app/', 'src/app/'];
  let appPrefix = '';
  for (const prefix of appDirPrefixes) {
    if (routeFiles.some((f) => f.relativePath.startsWith(prefix))) {
      appPrefix = prefix;
      break;
    }
  }

  if (!appPrefix) {
    console.log(`[morphkit] No app/ directory found — cannot extract App Router routes`);
    return [];
  }

  // Group files by their route directory
  const routeDirs = new Map<string, {
    page?: FileEntry;
    layout?: FileEntry;
    loading?: FileEntry;
    error?: FileEntry;
    notFound?: FileEntry;
    template?: FileEntry;
  }>();

  for (const file of routeFiles) {
    const rel = file.relativePath;
    if (!rel.startsWith(appPrefix)) continue;

    const afterApp = rel.slice(appPrefix.length);
    const dir = path.dirname(afterApp);
    const base = path.basename(rel).replace(/\.(ts|tsx|js|jsx)$/, '');

    if (!routeDirs.has(dir)) routeDirs.set(dir, {});
    const entry = routeDirs.get(dir)!;

    switch (base) {
      case 'page': entry.page = file; break;
      case 'layout': entry.layout = file; break;
      case 'loading': entry.loading = file; break;
      case 'error': entry.error = file; break;
      case 'not-found': entry.notFound = file; break;
      case 'template': entry.template = file; break;
    }
  }

  // Build route entries
  const routes: ExtractedRoute[] = [];
  const urlPathToRoute = new Map<string, ExtractedRoute>();

  for (const [dir, files] of routeDirs) {
    // Skip directories that have no page (they are pure layout wrappers)
    // but we still record them if they have a layout to link parent/child
    const segmentNames = dir === '.' ? [] : dir.split('/').filter(Boolean);
    const segments = segmentNames.map(parseSegment);
    const urlPath = segmentNames.length === 0 ? '/' : buildUrlPath(segments);

    const isDynamic = segments.some(
      (s) => s.kind === 'dynamic' || s.kind === 'catch-all' || s.kind === 'optional-catch-all',
    );

    const parallelSlots = segments
      .filter((s) => s.kind === 'parallel')
      .map((s) => s.name);

    // Only create a route entry if there is a page file or layout file
    if (!files.page && !files.layout) continue;

    // Extract metadata if we have a project
    let metadata: RouteMetadata = {
      title: undefined,
      description: undefined,
      rawText: undefined,
      isDynamic: false,
    };
    if (project) {
      metadata =
        extractMetadata(project, files.page?.absolutePath) ??
        extractMetadata(project, files.layout?.absolutePath);
    }

    const route: ExtractedRoute = {
      urlPath,
      segments,
      files: {
        page: files.page?.absolutePath,
        layout: files.layout?.absolutePath,
        loading: files.loading?.absolutePath,
        error: files.error?.absolutePath,
        notFound: files.notFound?.absolutePath,
        template: files.template?.absolutePath,
      },
      metadata,
      parentPath: undefined,
      childPaths: [],
      parallelSlots,
      suggestedNavigation: 'unknown',
      hasLayout: files.layout !== undefined,
      isDynamic,
    };

    routes.push(route);
    urlPathToRoute.set(urlPath, route);
  }

  // Link parent-child relationships
  for (const route of routes) {
    if (route.urlPath === '/') continue;

    // Find parent by progressively shortening the path
    const parts = route.urlPath.split('/').filter(Boolean);
    for (let i = parts.length - 1; i >= 0; i--) {
      const candidatePath = i === 0 ? '/' : '/' + parts.slice(0, i).join('/');
      const parent = urlPathToRoute.get(candidatePath);
      if (parent) {
        route.parentPath = candidatePath;
        parent.childPaths.push(route.urlPath);
        break;
      }
    }

    // If no parent found, link to root
    if (!route.parentPath && route.urlPath !== '/') {
      const root = urlPathToRoute.get('/');
      if (root) {
        route.parentPath = '/';
        root.childPaths.push(route.urlPath);
      }
    }
  }

  // Suggest navigation kinds
  for (const route of routes) {
    route.suggestedNavigation = suggestNavigation(
      route.urlPath,
      route.segments,
      route.hasLayout,
      route.childPaths,
      route.parallelSlots,
    );
  }

  console.log(`[morphkit] Extracted ${routes.length} routes`);
  return routes;
}

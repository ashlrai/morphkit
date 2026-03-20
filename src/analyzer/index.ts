/**
 * Analyzer — re-exports all analyzer modules and provides a convenience
 * `analyzeRepo()` function that orchestrates the full analysis pipeline.
 */

export { scanRepo, type RepoScanResult, type FileEntry, type FrameworkKind } from './repo-scanner.js';

export {
  createProject,
  parseFile,
  extractTypeDefinitions,
  extractFunctionComponents,
  extractHookUsage,
  type ImportInfo,
  type ExportInfo,
  type TypeDefinition,
  type TypeProperty,
  type ComponentDefinition,
  type PropDefinition,
  type HookUsage,
  type ParsedFile,
} from './ast-parser.js';

export {
  extractComponents,
  type ExtractedComponent,
  type ComponentCategory,
  type EventHandlerInfo,
  type ConditionalRender,
  type ChildComponent,
  type UiLibraryMapping,
} from './component-extractor.js';

export {
  extractRoutes,
  type ExtractedRoute,
  type RouteSegment,
  type RouteSegmentKind,
  type RouteMetadata,
  type NavigationKind,
} from './route-extractor.js';

export {
  extractReactRoutes,
} from './react-route-extractor.js';

export {
  extractStatePatterns,
  type ExtractedState,
  type StatePatternKind,
  type StateScope,
  type UseStateInfo,
  type UseReducerInfo,
  type ContextInfo,
  type ZustandStoreInfo,
  type ReduxSliceInfo,
  type ServerStateInfo,
} from './state-extractor.js';

export {
  extractApiEndpoints,
  type ExtractedApi,
  type ApiCallKind,
  type HttpMethod,
  type ApiProtocol,
  type FetchCallInfo,
  type AxiosCallInfo,
  type NextApiRouteInfo,
  type ServerActionInfo,
  type ReactQueryInfo,
  type SwrInfo,
} from './api-extractor.js';

// ---------------------------------------------------------------------------
// Types for the full analysis result
// ---------------------------------------------------------------------------

import type { RepoScanResult } from './repo-scanner.js';
import type { ParsedFile } from './ast-parser.js';
import type { ExtractedComponent } from './component-extractor.js';
import type { ExtractedRoute } from './route-extractor.js';
import type { ExtractedState } from './state-extractor.js';
import type { ExtractedApi } from './api-extractor.js';

export interface AnalysisResult {
  /** Repository scan metadata */
  scanResult: RepoScanResult;
  /** Parsed file-level information for all source files */
  parsedFiles: ParsedFile[];
  /** Extracted component details */
  components: ExtractedComponent[];
  /** Route tree */
  routes: ExtractedRoute[];
  /** Detected state management patterns */
  statePatterns: ExtractedState[];
  /** API endpoints and data-fetching patterns */
  apiEndpoints: ExtractedApi[];
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

import { scanRepo } from './repo-scanner.js';
import { createProject, parseFile } from './ast-parser.js';
import { extractComponents } from './component-extractor.js';
import { extractRoutes } from './route-extractor.js';
import { extractReactRoutes } from './react-route-extractor.js';
import { extractPagesRoutes } from './pages-route-extractor.js';
import { extractStatePatterns } from './state-extractor.js';
import { extractApiEndpoints } from './api-extractor.js';

/**
 * Run the complete Morphkit analysis pipeline on a repository.
 *
 * 1. Scans the repo to discover and categorize files
 * 2. Creates a ts-morph project and parses all TypeScript files
 * 3. Extracts components, routes, state patterns, and API endpoints
 *
 * @param repoPath — absolute or relative path to the repository root
 * @returns A full `AnalysisResult` with all extracted information
 */
export async function analyzeRepo(repoPath: string): Promise<AnalysisResult> {
  console.log(`[morphkit] Starting full analysis of ${repoPath}`);
  const startTime = Date.now();

  // Step 1: Scan repository
  const scan = await scanRepo(repoPath);

  // Handle empty scan gracefully — return an empty but valid result
  if (scan.allFiles.length === 0) {
    console.log('[morphkit] No source files found — returning empty analysis result');
    return {
      scanResult: scan,
      parsedFiles: [],
      components: [],
      routes: [],
      statePatterns: [],
      apiEndpoints: [],
    };
  }

  // Step 2: Create ts-morph project with all TS/TSX/JS/JSX files
  const sourceFilePaths = scan.allFiles
    .filter((f) => ['ts', 'tsx', 'js', 'jsx'].includes(f.extension))
    .map((f) => f.absolutePath);

  // If no TS/JS files exist (e.g. only CSS/JSON), short-circuit
  if (sourceFilePaths.length === 0) {
    console.log('[morphkit] No TypeScript/JavaScript source files found — returning empty analysis result');
    return {
      scanResult: scan,
      parsedFiles: [],
      components: [],
      routes: [],
      statePatterns: [],
      apiEndpoints: [],
    };
  }

  const project = createProject(scan.repoPath, sourceFilePaths);

  // Step 3: Parse all source files
  console.log(`[morphkit] Parsing ${sourceFilePaths.length} source files`);
  const parsedFiles: ParsedFile[] = [];
  for (const sourceFile of project.getSourceFiles()) {
    try {
      parsedFiles.push(parseFile(sourceFile));
    } catch (err) {
      console.log(`[morphkit] Warning: failed to parse ${sourceFile.getFilePath()}: ${(err as Error).message}`);
    }
  }

  // Step 4: Extract components
  const componentFilePaths = [
    ...scan.pages.map((f) => f.absolutePath),
    ...scan.layouts.map((f) => f.absolutePath),
    ...scan.components.map((f) => f.absolutePath),
  ];
  const components = extractComponents(project, componentFilePaths);

  // Step 5: Extract routes (framework-aware)
  let routes: ExtractedRoute[];
  if (scan.framework === 'react') {
    routes = extractReactRoutes(scan.repoPath, scan, project);
  } else if (scan.framework === 'nextjs-pages-router') {
    routes = extractPagesRoutes(scan.repoPath, scan, project);
  } else {
    routes = extractRoutes(scan.repoPath, scan, project);
  }

  // Step 6: Extract state patterns
  const statePatterns = extractStatePatterns(project, sourceFilePaths);

  // Step 7: Extract API endpoints
  const apiEndpoints = extractApiEndpoints(project, sourceFilePaths, {
    apiRouteFiles: scan.apiRoutes.map((f) => f.absolutePath),
    repoPath: scan.repoPath,
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`[morphkit] Analysis complete in ${elapsed}s`);
  console.log(
    `[morphkit] Summary: ${parsedFiles.length} files, ${components.length} components, ` +
      `${routes.length} routes, ${statePatterns.length} state patterns, ${apiEndpoints.length} API endpoints`,
  );

  return {
    scanResult: scan,
    parsedFiles,
    components,
    routes,
    statePatterns,
    apiEndpoints,
  };
}

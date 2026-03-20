/**
 * React Route Extractor — parses react-router-dom route definitions from
 * plain React (e.g. Vite) codebases into ExtractedRoute[].
 *
 * Supported patterns:
 *   1. createBrowserRouter([...]) / createHashRouter([...])
 *   2. <Route path="..." element={...} /> JSX
 *   3. Route config arrays (export const routes = [...])
 */

import * as path from 'path';

import {
  Project,
  SourceFile,
  Node,
  SyntaxKind,
  type ObjectLiteralExpression,
  type ArrayLiteralExpression,
  type JsxElement,
  type JsxSelfClosingElement,
  type CallExpression,
} from 'ts-morph';

import type { RepoScanResult } from './repo-scanner.js';
import type {
  ExtractedRoute,
  RouteSegment,
  RouteSegmentKind,
  NavigationKind,
  RouteMetadata,
} from './route-extractor.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EMPTY_METADATA: RouteMetadata = {
  title: undefined,
  description: undefined,
  rawText: undefined,
  isDynamic: false,
};

/**
 * Parse a react-router path segment like `:id` or `*` into a RouteSegment.
 */
function parseReactSegment(segment: string): RouteSegment {
  // Dynamic param: :id
  if (segment.startsWith(':')) {
    const paramName = segment.slice(1);
    return {
      raw: segment,
      name: paramName,
      kind: 'dynamic',
      paramName,
    };
  }

  // Catch-all/splat: *
  if (segment === '*') {
    return {
      raw: segment,
      name: '*',
      kind: 'catch-all',
      paramName: '*',
    };
  }

  // Static
  return {
    raw: segment,
    name: segment,
    kind: 'static',
    paramName: undefined,
  };
}

/**
 * Build segments from a react-router path string.
 */
function pathToSegments(routePath: string): RouteSegment[] {
  const cleaned = routePath.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!cleaned) return [];
  return cleaned.split('/').map(parseReactSegment);
}

/**
 * Normalize a react-router path to a full URL path.
 * Handles parent + child nesting: parent="products", child=":id" → "/products/:id"
 */
function normalizePath(parentPath: string, childPath: string): string {
  // Absolute child path
  if (childPath.startsWith('/')) return childPath;

  const base = parentPath.endsWith('/') ? parentPath : parentPath + '/';
  return base + childPath;
}

/**
 * Determine suggested navigation kind based on depth and route characteristics.
 */
function suggestNavigation(urlPath: string, segments: RouteSegment[], childCount: number): NavigationKind {
  const depth = urlPath.split('/').filter(Boolean).length;

  // Root with multiple children suggests tabs
  if (urlPath === '/' && childCount >= 2) {
    return 'tab';
  }

  // Top-level routes suggest tabs
  if (depth === 1 && childCount === 0) {
    return 'tab';
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
// Route config object parsing
// ---------------------------------------------------------------------------

interface RawRoute {
  path: string;
  filePath: string; // source file where this route was defined
  children: RawRoute[];
  isIndex: boolean;
}

/**
 * Extract path string from an object literal property.
 */
function getStringProp(obj: ObjectLiteralExpression, propName: string): string | undefined {
  const prop = obj.getProperty(propName);
  if (!prop) return undefined;

  if (Node.isPropertyAssignment(prop)) {
    const init = prop.getInitializer();
    if (init && Node.isStringLiteral(init)) {
      return init.getLiteralValue();
    }
  }
  return undefined;
}

/**
 * Check if an object literal has a truthy boolean property.
 */
function hasBooleanProp(obj: ObjectLiteralExpression, propName: string): boolean {
  const prop = obj.getProperty(propName);
  if (!prop) return false;

  if (Node.isPropertyAssignment(prop)) {
    const init = prop.getInitializer();
    if (init && Node.isTrueLiteral(init)) return true;
  }
  // Property shorthand `{ index }` counts as truthy
  if (Node.isShorthandPropertyAssignment(prop)) return true;
  return false;
}

/**
 * Parse a route config object literal: { path: '...', element: ..., children: [...] }
 */
function parseRouteObject(obj: ObjectLiteralExpression, sourceFilePath: string): RawRoute | undefined {
  const routePath = getStringProp(obj, 'path');
  const isIndex = hasBooleanProp(obj, 'index');

  // Must have either path or index
  if (routePath === undefined && !isIndex) return undefined;

  const children: RawRoute[] = [];

  // Parse children array
  const childrenProp = obj.getProperty('children');
  if (childrenProp && Node.isPropertyAssignment(childrenProp)) {
    const init = childrenProp.getInitializer();
    if (init && Node.isArrayLiteralExpression(init)) {
      for (const element of init.getElements()) {
        if (Node.isObjectLiteralExpression(element)) {
          const child = parseRouteObject(element, sourceFilePath);
          if (child) children.push(child);
        }
      }
    }
  }

  return {
    path: routePath ?? '/',
    filePath: sourceFilePath,
    children,
    isIndex,
  };
}

/**
 * Parse an array literal of route config objects.
 */
function parseRouteArray(arr: ArrayLiteralExpression, sourceFilePath: string): RawRoute[] {
  const routes: RawRoute[] = [];
  for (const element of arr.getElements()) {
    if (Node.isObjectLiteralExpression(element)) {
      const route = parseRouteObject(element, sourceFilePath);
      if (route) routes.push(route);
    }
  }
  return routes;
}

// ---------------------------------------------------------------------------
// JSX <Route> parsing
// ---------------------------------------------------------------------------

/**
 * Extract path from a JSX <Route> element's props.
 */
function getJsxStringProp(element: JsxElement | JsxSelfClosingElement, propName: string): string | undefined {
  const openingElement = Node.isJsxElement(element)
    ? element.getOpeningElement()
    : element;

  for (const attr of openingElement.getAttributes()) {
    if (Node.isJsxAttribute(attr) && attr.getNameNode().getText() === propName) {
      const init = attr.getInitializer();
      if (init && Node.isStringLiteral(init)) {
        return init.getLiteralValue();
      }
    }
  }
  return undefined;
}

/**
 * Check if a JSX element has a boolean attribute (e.g. `index` with no value).
 */
function hasJsxBooleanProp(element: JsxElement | JsxSelfClosingElement, propName: string): boolean {
  const openingElement = Node.isJsxElement(element)
    ? element.getOpeningElement()
    : element;

  for (const attr of openingElement.getAttributes()) {
    if (Node.isJsxAttribute(attr) && attr.getNameNode().getText() === propName) {
      const init = attr.getInitializer();
      // Boolean attribute: <Route index /> has no initializer
      if (!init) return true;
      return false;
    }
  }
  return false;
}

/**
 * Check if a JSX element is a <Route> element.
 */
function isRouteJsxElement(element: JsxElement | JsxSelfClosingElement): boolean {
  const tagName = Node.isJsxElement(element)
    ? element.getOpeningElement().getTagNameNode().getText()
    : element.getTagNameNode().getText();
  return tagName === 'Route';
}

/**
 * Recursively extract RawRoutes from JSX <Route> elements.
 */
function parseRouteJsx(element: JsxElement | JsxSelfClosingElement, sourceFilePath: string): RawRoute | undefined {
  if (!isRouteJsxElement(element)) return undefined;

  const routePath = getJsxStringProp(element, 'path');
  const isIndex = hasJsxBooleanProp(element, 'index');

  if (routePath === undefined && !isIndex) return undefined;

  const children: RawRoute[] = [];

  // Parse child <Route> elements from JSX children
  if (Node.isJsxElement(element)) {
    for (const child of element.getJsxChildren()) {
      if (Node.isJsxElement(child) || Node.isJsxSelfClosingElement(child)) {
        const childRoute = parseRouteJsx(child, sourceFilePath);
        if (childRoute) children.push(childRoute);
      }
    }
  }

  return {
    path: routePath ?? '/',
    filePath: sourceFilePath,
    children,
    isIndex,
  };
}

// ---------------------------------------------------------------------------
// Flatten raw routes into ExtractedRoute[]
// ---------------------------------------------------------------------------

function flattenRoutes(
  rawRoutes: RawRoute[],
  parentUrlPath: string,
  parentRoute: ExtractedRoute | undefined,
  result: ExtractedRoute[],
  urlPathMap: Map<string, ExtractedRoute>,
): void {
  for (const raw of rawRoutes) {
    const fullPath = raw.isIndex && raw.path === '/'
      ? parentUrlPath
      : normalizePath(parentUrlPath, raw.path);

    // Avoid duplicate paths — first definition wins
    if (urlPathMap.has(fullPath)) {
      // Still process children with the existing route as parent
      const existing = urlPathMap.get(fullPath)!;
      flattenRoutes(raw.children, fullPath, existing, result, urlPathMap);
      continue;
    }

    const segments = pathToSegments(fullPath);
    const isDynamic = segments.some(
      (s) => s.kind === 'dynamic' || s.kind === 'catch-all',
    );

    const route: ExtractedRoute = {
      urlPath: fullPath || '/',
      segments,
      files: {
        page: raw.filePath,
        layout: undefined,
        loading: undefined,
        error: undefined,
        notFound: undefined,
        template: undefined,
      },
      metadata: { ...EMPTY_METADATA },
      parentPath: parentRoute?.urlPath,
      childPaths: [],
      parallelSlots: [],
      suggestedNavigation: 'unknown', // computed after tree is built
      hasLayout: false,
      isDynamic,
    };

    result.push(route);
    urlPathMap.set(fullPath || '/', route);

    if (parentRoute) {
      parentRoute.childPaths.push(route.urlPath);
    }

    // Recurse into children
    flattenRoutes(raw.children, fullPath, route, result, urlPathMap);
  }
}

// ---------------------------------------------------------------------------
// Source file scanning
// ---------------------------------------------------------------------------

/**
 * Find all source files that import from react-router-dom or react-router.
 */
function findRouterFiles(project: Project): SourceFile[] {
  const routerFiles: SourceFile[] = [];

  for (const sourceFile of project.getSourceFiles()) {
    const imports = sourceFile.getImportDeclarations();
    const hasRouterImport = imports.some((imp) => {
      const moduleSpecifier = imp.getModuleSpecifierValue();
      return moduleSpecifier === 'react-router-dom' || moduleSpecifier === 'react-router';
    });
    if (hasRouterImport) {
      routerFiles.push(sourceFile);
    }
  }

  return routerFiles;
}

/**
 * Extract routes from createBrowserRouter / createHashRouter calls.
 */
function extractFromRouterCreation(sourceFile: SourceFile): RawRoute[] {
  const routes: RawRoute[] = [];
  const filePath = sourceFile.getFilePath();

  sourceFile.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) return;

    const expr = node.getExpression();
    const text = expr.getText();

    if (text === 'createBrowserRouter' || text === 'createHashRouter') {
      const args = node.getArguments();
      if (args.length > 0 && Node.isArrayLiteralExpression(args[0])) {
        routes.push(...parseRouteArray(args[0] as ArrayLiteralExpression, filePath));
      }
    }
  });

  return routes;
}

/**
 * Extract routes from JSX <Routes><Route .../></Routes> patterns.
 */
function extractFromJsxRoutes(sourceFile: SourceFile): RawRoute[] {
  const routes: RawRoute[] = [];
  const filePath = sourceFile.getFilePath();

  sourceFile.forEachDescendant((node) => {
    // Look for <Routes> wrapper elements
    if (Node.isJsxElement(node)) {
      const tagName = node.getOpeningElement().getTagNameNode().getText();
      if (tagName === 'Routes') {
        for (const child of node.getJsxChildren()) {
          if (Node.isJsxElement(child) || Node.isJsxSelfClosingElement(child)) {
            const route = parseRouteJsx(child, filePath);
            if (route) routes.push(route);
          }
        }
      }
    }

    // Also look for standalone <Route> elements outside <Routes>
    // (less common, but supported)
    if (Node.isJsxSelfClosingElement(node) || Node.isJsxElement(node)) {
      const parent = node.getParent();
      // Only capture top-level Route elements (not those inside <Routes> which we already processed)
      if (parent && Node.isJsxElement(parent)) {
        const parentTag = parent.getOpeningElement().getTagNameNode().getText();
        if (parentTag === 'Routes') return; // already handled above
      }

      if (isRouteJsxElement(node)) {
        // Check parent is not another Route (we handle nesting via recursion)
        if (parent && (Node.isJsxElement(parent) || Node.isJsxSelfClosingElement(parent))) {
          if (isRouteJsxElement(parent)) return;
        }
        const route = parseRouteJsx(node, filePath);
        if (route) routes.push(route);
      }
    }
  });

  return routes;
}

/**
 * Extract routes from exported route config arrays.
 * Matches: export const routes = [{ path: '...', ... }]
 */
function extractFromRouteConfigArrays(sourceFile: SourceFile): RawRoute[] {
  const routes: RawRoute[] = [];
  const filePath = sourceFile.getFilePath();

  for (const varDecl of sourceFile.getVariableDeclarations()) {
    const init = varDecl.getInitializer();
    if (!init || !Node.isArrayLiteralExpression(init)) continue;

    // Check if the array elements look like route configs (have `path` property)
    const elements = init.getElements();
    if (elements.length === 0) continue;

    const firstElement = elements[0];
    if (!Node.isObjectLiteralExpression(firstElement)) continue;

    // Check if it has a `path` property — strong indicator it is a route config
    const hasPath = firstElement.getProperty('path') !== undefined;
    const hasElement = firstElement.getProperty('element') !== undefined;
    const hasComponent = firstElement.getProperty('component') !== undefined;

    if (hasPath && (hasElement || hasComponent)) {
      routes.push(...parseRouteArray(init, filePath));
    }
  }

  return routes;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract routes from a React app using react-router-dom.
 *
 * Scans all source files that import from react-router-dom/react-router and
 * extracts route definitions from:
 *   - createBrowserRouter / createHashRouter calls
 *   - JSX <Route> elements
 *   - Exported route config arrays
 */
export function extractReactRoutes(
  repoPath: string,
  scanResult: RepoScanResult,
  project: Project,
): ExtractedRoute[] {
  console.log(`[morphkit] Extracting React Router routes from ${repoPath}`);

  const routerFiles = findRouterFiles(project);

  if (routerFiles.length === 0) {
    console.log(`[morphkit] No files importing react-router-dom/react-router found`);
    return [];
  }

  console.log(`[morphkit] Found ${routerFiles.length} files with react-router imports`);

  // Collect raw routes from all patterns
  const allRawRoutes: RawRoute[] = [];

  for (const sourceFile of routerFiles) {
    // Pattern 1: createBrowserRouter / createHashRouter
    allRawRoutes.push(...extractFromRouterCreation(sourceFile));

    // Pattern 2: JSX <Routes><Route /></Routes>
    allRawRoutes.push(...extractFromJsxRoutes(sourceFile));

    // Pattern 3: Route config arrays
    allRawRoutes.push(...extractFromRouteConfigArrays(sourceFile));
  }

  if (allRawRoutes.length === 0) {
    console.log(`[morphkit] No route definitions found in router files`);
    return [];
  }

  // Flatten into ExtractedRoute[]
  const routes: ExtractedRoute[] = [];
  const urlPathMap = new Map<string, ExtractedRoute>();

  flattenRoutes(allRawRoutes, '', undefined, routes, urlPathMap);

  // Fix root route — ensure "/" exists if we have any routes but none start with "/"
  if (routes.length > 0 && !urlPathMap.has('/')) {
    // If there is a route with path "", treat it as root
    const emptyRoute = routes.find((r) => r.urlPath === '');
    if (emptyRoute) {
      emptyRoute.urlPath = '/';
      urlPathMap.set('/', emptyRoute);
    }
  }

  // Link orphan routes to root
  const root = urlPathMap.get('/');
  for (const route of routes) {
    if (route.parentPath === undefined && route.urlPath !== '/' && root) {
      route.parentPath = '/';
      if (!root.childPaths.includes(route.urlPath)) {
        root.childPaths.push(route.urlPath);
      }
    }
  }

  // Compute suggested navigation after the tree is fully built
  for (const route of routes) {
    route.suggestedNavigation = suggestNavigation(
      route.urlPath,
      route.segments,
      route.childPaths.length,
    );
  }

  console.log(`[morphkit] Extracted ${routes.length} React Router routes`);
  return routes;
}

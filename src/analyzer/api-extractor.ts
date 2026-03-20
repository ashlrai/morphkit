/**
 * API Extractor — finds and classifies API calls, Next.js API routes,
 * server actions, and server-state hooks (React Query / SWR).
 */

import * as path from 'path';

import {
  Project,
  SourceFile,
  Node,
  SyntaxKind,
  type CallExpression,
} from 'ts-morph';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ApiCallKind =
  | 'fetch'
  | 'axios'
  | 'next-api-route'
  | 'react-query'
  | 'swr'
  | 'server-action'
  | 'graphql'
  | 'other';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS' | 'UNKNOWN';

export type ApiProtocol = 'rest' | 'graphql' | 'other';

export interface FetchCallInfo {
  /** URL or URL expression */
  url: string;
  /** HTTP method (from options or inferred) */
  method: HttpMethod;
  /** Headers object text */
  headers: string | undefined;
  /** Body expression text */
  body: string | undefined;
  /** How the response is handled (.json(), .text(), etc.) */
  responseHandling: string | undefined;
}

export interface AxiosCallInfo {
  url: string;
  method: HttpMethod;
  headers: string | undefined;
  body: string | undefined;
  /** Axios method used: get, post, put, etc. */
  axiosMethod: string;
}

export interface NextApiRouteInfo {
  /** Relative path of the route file */
  routePath: string;
  /** URL path derived from file location */
  urlPath: string;
  /** HTTP methods handled (GET, POST, etc.) */
  methods: HttpMethod[];
  /** Request type (if typed) */
  requestType: string | undefined;
  /** Response type (if typed) */
  responseType: string | undefined;
}

export interface ServerActionInfo {
  /** Function name */
  name: string;
  /** Parameters with types */
  parameters: { name: string; type: string }[];
  /** Return type */
  returnType: string;
  /** Whether it has 'use server' directive */
  hasDirective: boolean;
}

export interface ReactQueryInfo {
  hookName: string;
  queryKey: string;
  fetchFn: string;
}

export interface SwrInfo {
  key: string;
  fetcher: string;
}

export interface ExtractedApi {
  kind: ApiCallKind;
  protocol: ApiProtocol;
  filePath: string;
  /** Component or function name where the call is made */
  ownerName: string;
  line: number;
  /** Inferred request type (from TypeScript types) */
  requestType: string | undefined;
  /** Inferred response type (from TypeScript types) */
  responseType: string | undefined;
  /** Specific info based on kind */
  fetch: FetchCallInfo | undefined;
  axios: AxiosCallInfo | undefined;
  nextApiRoute: NextApiRouteInfo | undefined;
  serverAction: ServerActionInfo | undefined;
  reactQuery: ReactQueryInfo | undefined;
  swr: SwrInfo | undefined;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findOwnerName(node: Node): string {
  let current: Node | undefined = node.getParent();
  while (current) {
    if (Node.isFunctionDeclaration(current)) {
      const name = current.getName();
      if (name) return name;
    }
    if (Node.isVariableDeclaration(current)) {
      return current.getName();
    }
    if (Node.isMethodDeclaration(current)) {
      return current.getName();
    }
    current = current.getParent();
  }
  return 'module';
}

function parseHttpMethod(text: string): HttpMethod {
  const upper = text.toUpperCase().replace(/['"]/g, '');
  const valid: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
  return valid.includes(upper as HttpMethod) ? (upper as HttpMethod) : 'UNKNOWN';
}

// Patterns that represent base URL variables (should be stripped from paths)
const BASE_URL_PATTERNS = [
  /^\$\{API_BASE\}/,
  /^\$\{API_URL\}/,
  /^\$\{BASE_URL\}/,
  /^\$\{baseUrl\}/,
  /^\$\{apiUrl\}/,
  /^\$\{apiBase\}/,
  /^\$\{API_BASE_URL\}/,
  /^\$\{NEXT_PUBLIC_API_URL\}/,
  /^\$\{process\.env\.\w+\}/,
  /^\$\{config\.\w+\}/,
  /^\$\{import\.meta\.env\.\w+\}/,
  /^\$\{:[\w.]+\}/,  // already-parameterized base URLs
];

/**
 * Clean a raw URL string extracted from source code into a normalized REST path.
 *
 * - Strips JS template literal backticks
 * - Replaces `${variableName}` with `:variableName`
 * - Strips common base URL variable prefixes
 * - Strips query strings containing JS expressions
 * - Returns null if the URL is garbage (method call, bare variable, etc.)
 */
function cleanApiUrl(rawUrl: string): string | null {
  let url = rawUrl.trim();

  // Strip surrounding quotes (single, double, backtick)
  if ((url.startsWith("'") && url.endsWith("'")) ||
      (url.startsWith('"') && url.endsWith('"')) ||
      (url.startsWith('`') && url.endsWith('`'))) {
    url = url.slice(1, -1);
  }

  // Filter out garbage: method calls like url.toString(), getUrl(), etc.
  if (/^\w+\.\w+\(/.test(url) || /^\w+\(/.test(url)) {
    return null;
  }

  // Filter out bare variable references (no path separator)
  if (/^[a-zA-Z_$][\w$]*$/.test(url)) {
    return null;
  }

  // Replace ${expression} with :paramName
  // For simple identifiers: ${id} -> :id
  // For property access: ${product.id} -> :productId
  // For complex expressions like ${encodeURIComponent(query)}: extract inner var
  url = url.replace(/\$\{([^}]+)\}/g, (_match, expr: string) => {
    const trimmed = expr.trim();

    // Function calls like encodeURIComponent(query) -> extract "query"
    const fnCallMatch = trimmed.match(/^\w+\((\w+)\)$/);
    if (fnCallMatch) return `:${fnCallMatch[1]}`;

    // Property access like product.id -> productId
    if (/^\w+\.\w+$/.test(trimmed)) {
      const parts = trimmed.split('.');
      return `:${parts[parts.length - 1]}`;
    }

    // Simple identifier: id -> :id
    if (/^\w+$/.test(trimmed)) return `:${trimmed}`;

    // Complex expression — use generic param
    return ':param';
  });

  // Strip common base URL prefixes (now in :varName form after replacement above)
  for (const pattern of BASE_URL_PATTERNS) {
    url = url.replace(pattern, '');
  }
  // Also strip already-parameterized base URLs like :API_BASE, :baseUrl at start
  url = url.replace(/^:(API_BASE|API_URL|BASE_URL|baseUrl|apiUrl|apiBase|API_BASE_URL|NEXT_PUBLIC_API_URL)/, '');
  // Strip :param at the very start if it looks like a base URL (followed by /)
  if (/^:[\w]+\//.test(url) && !url.startsWith('/')) {
    // Looks like :someBaseVar/rest/of/path — strip the base var
    url = url.replace(/^:[\w]+/, '');
  }

  // Strip query strings (especially ones with JS expressions)
  // Match ? followed by content. If the query has : params (JS expressions), strip the whole query.
  const queryIndex = url.indexOf('?');
  if (queryIndex !== -1) {
    const queryPart = url.substring(queryIndex);
    // If query contains parameterized expressions, strip the whole query string
    if (queryPart.includes(':') || queryPart.includes('$')) {
      url = url.substring(0, queryIndex);
    }
    // Otherwise keep simple static query strings
  }

  // Ensure it starts with /
  if (url && !url.startsWith('/') && !url.startsWith('http')) {
    url = '/' + url;
  }

  // Collapse double slashes (but not in http://)
  url = url.replace(/([^:])\/\//g, '$1/');

  // Strip trailing slashes
  url = url.replace(/\/+$/, '') || '/';

  // If after all cleaning we just have empty or whitespace, it's garbage
  if (!url || url === '/' && rawUrl.length > 5) {
    return null;
  }

  return url;
}

/**
 * Try to extract a meaningful URL string from an AST node.
 *
 * For string/template literals, extracts and cleans the URL.
 * For identifier references (e.g., `url` variable), attempts to trace back
 * to the variable definition to find the URL value.
 */
function extractUrlFromNode(node: Node, sourceFile: SourceFile): string | null {
  const text = node.getText();

  // String literal: 'url' or "url"
  if (Node.isStringLiteral(node)) {
    return cleanApiUrl(text);
  }

  // Template literal: `${API_BASE}/products/${id}`
  if (Node.isTemplateExpression(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    return cleanApiUrl(text);
  }

  // Identifier reference: try to trace to definition
  if (Node.isIdentifier(node)) {
    const varName = node.getText();
    return traceVariableUrl(varName, node, sourceFile);
  }

  // Method call like url.toString() — try to trace the object
  if (Node.isCallExpression(node)) {
    const callExpr = node.getExpression();
    if (Node.isPropertyAccessExpression(callExpr)) {
      const objName = callExpr.getExpression().getText();
      const methodName = callExpr.getName();
      if (methodName === 'toString' || methodName === 'href') {
        return traceVariableUrl(objName, node, sourceFile);
      }
    }
    // Other call expressions (e.g., getUrl()) — can't resolve
    return null;
  }

  // Property access like config.url — can't reliably resolve
  if (Node.isPropertyAccessExpression(node)) {
    return null;
  }

  // Fallback: try to clean whatever text we got
  return cleanApiUrl(text);
}

/**
 * Trace back a variable name to its definition and try to extract a URL.
 * Handles patterns like:
 *   const url = new URL(`${API_BASE}/products`);
 *   const url = `${API_BASE}/products/${id}`;
 */
function traceVariableUrl(varName: string, contextNode: Node, sourceFile: SourceFile): string | null {
  try {
    // Search for variable declarations with this name in the same file
    for (const varDecl of sourceFile.getVariableDeclarations()) {
      if (varDecl.getName() !== varName) continue;

      const init = varDecl.getInitializer();
      if (!init) continue;

      // new URL(`${API_BASE}/products`)
      if (Node.isNewExpression(init)) {
        const expr = init.getExpression();
        if (expr.getText() === 'URL' && init.getArguments().length > 0) {
          const urlArg = init.getArguments()[0]!;
          return cleanApiUrl(urlArg.getText());
        }
      }

      // Template literal or string literal assigned to variable
      if (Node.isTemplateExpression(init) || Node.isNoSubstitutionTemplateLiteral(init) || Node.isStringLiteral(init)) {
        return cleanApiUrl(init.getText());
      }
    }
  } catch {
    // Tracing failed — not critical
  }
  return null;
}

function detectProtocol(url: string, body: string | undefined): ApiProtocol {
  if (url.includes('graphql') || url.includes('/gql')) return 'graphql';
  if (body && (body.includes('query') || body.includes('mutation')) && body.includes('variables')) return 'graphql';
  return 'rest';
}

function inferResponseType(node: Node): string | undefined {
  try {
    // Look for chained .json<Type>() or type assertions
    const parent = node.getParent();
    if (!parent) return undefined;

    // const data: Type = await fetch(...).then(r => r.json())
    // or: const data = await fetch(...) as Response<Type>
    const grandparent = parent.getParent();
    if (grandparent && Node.isVariableDeclaration(grandparent)) {
      const typeNode = grandparent.getTypeNode();
      if (typeNode) return typeNode.getText();
    }

    return undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// fetch() calls
// ---------------------------------------------------------------------------

function extractFetchCalls(sourceFile: SourceFile, filePath: string): ExtractedApi[] {
  const results: ExtractedApi[] = [];

  try {
    sourceFile.forEachDescendant((node) => {
      if (!Node.isCallExpression(node)) return;
      const exprText = node.getExpression().getText();
      if (exprText !== 'fetch') return;

      const args = node.getArguments();
      if (args.length === 0) return;

      const url = extractUrlFromNode(args[0]!, sourceFile);

      // Skip calls where we can't extract a meaningful URL
      if (!url) return;

      let method: HttpMethod = 'GET';
      let headers: string | undefined;
      let body: string | undefined;
      let responseHandling: string | undefined;

      // Parse options object (second argument)
      if (args.length > 1) {
        const opts = args[1]!;
        if (Node.isObjectLiteralExpression(opts)) {
          for (const prop of opts.getProperties()) {
            if (!Node.isPropertyAssignment(prop)) continue;
            const name = prop.getName();
            const value = prop.getInitializer()?.getText() ?? '';
            if (name === 'method') method = parseHttpMethod(value);
            if (name === 'headers') headers = value.substring(0, 300);
            if (name === 'body') body = value.substring(0, 500);
          }
        }
      }

      // Check for .then(r => r.json()) or .json() chain
      try {
        const parentNode = node.getParent();
        if (parentNode && Node.isPropertyAccessExpression(parentNode)) {
          responseHandling = parentNode.getName();
        }
        // Also check await patterns
        const callParent = parentNode?.getParent();
        if (callParent && Node.isAwaitExpression(callParent)) {
          const awaitParent = callParent.getParent();
          if (awaitParent && Node.isPropertyAccessExpression(awaitParent)) {
            responseHandling = awaitParent.getName();
          }
        }
      } catch {
        // ignore
      }

      const protocol = detectProtocol(url, body);
      const responseType = inferResponseType(node);

      results.push({
        kind: protocol === 'graphql' ? 'graphql' : 'fetch',
        protocol,
        filePath,
        ownerName: findOwnerName(node),
        line: node.getStartLineNumber(),
        requestType: body ? 'inferred-from-body' : undefined,
        responseType,
        fetch: { url, method, headers, body, responseHandling },
        axios: undefined,
        nextApiRoute: undefined,
        serverAction: undefined,
        reactQuery: undefined,
        swr: undefined,
      });
    });
  } catch (err) {
    console.log(`[morphkit] Warning: fetch extraction error in ${filePath}: ${(err as Error).message}`);
  }

  return results;
}

// ---------------------------------------------------------------------------
// axios calls
// ---------------------------------------------------------------------------

function extractAxiosCalls(sourceFile: SourceFile, filePath: string): ExtractedApi[] {
  const results: ExtractedApi[] = [];

  try {
    // Check if axios is imported
    const hasAxios = sourceFile
      .getImportDeclarations()
      .some((imp) => imp.getModuleSpecifierValue() === 'axios');
    if (!hasAxios) return results;

    sourceFile.forEachDescendant((node) => {
      if (!Node.isCallExpression(node)) return;

      const exprText = node.getExpression().getText();
      // Match axios.get(), axios.post(), axios(), etc.
      const axiosMethodMatch = exprText.match(/^axios(?:\.(\w+))?$/);
      if (!axiosMethodMatch) return;

      const axiosMethod = axiosMethodMatch[1] ?? 'request';
      const args = node.getArguments();
      if (args.length === 0) return;

      let url: string | null = '';
      let method: HttpMethod = 'GET';
      let headers: string | undefined;
      let body: string | undefined;

      if (axiosMethod === 'request' || !axiosMethodMatch[1]) {
        // axios({ url, method, ... }) or axios(url, config)
        const firstArg = args[0]!;
        if (Node.isObjectLiteralExpression(firstArg)) {
          for (const prop of firstArg.getProperties()) {
            if (!Node.isPropertyAssignment(prop)) continue;
            const name = prop.getName();
            const value = prop.getInitializer()?.getText() ?? '';
            if (name === 'url') {
              const initNode = prop.getInitializer();
              url = initNode ? extractUrlFromNode(initNode, sourceFile) : cleanApiUrl(value);
            }
            if (name === 'method') method = parseHttpMethod(value);
            if (name === 'headers') headers = value.substring(0, 300);
            if (name === 'data') body = value.substring(0, 500);
          }
        } else {
          url = extractUrlFromNode(firstArg, sourceFile);
        }
      } else {
        // axios.get(url, config?) or axios.post(url, data, config?)
        url = extractUrlFromNode(args[0]!, sourceFile);
        method = parseHttpMethod(axiosMethod);

        if (['post', 'put', 'patch'].includes(axiosMethod) && args.length > 1) {
          body = args[1]!.getText().substring(0, 500);
          if (args.length > 2) {
            const config = args[2]!;
            if (Node.isObjectLiteralExpression(config)) {
              for (const prop of config.getProperties()) {
                if (Node.isPropertyAssignment(prop) && prop.getName() === 'headers') {
                  headers = prop.getInitializer()?.getText().substring(0, 300);
                }
              }
            }
          }
        } else if (args.length > 1) {
          const config = args[1]!;
          if (Node.isObjectLiteralExpression(config)) {
            for (const prop of config.getProperties()) {
              if (Node.isPropertyAssignment(prop) && prop.getName() === 'headers') {
                headers = prop.getInitializer()?.getText().substring(0, 300);
              }
            }
          }
        }
      }

      // Skip calls where we can't extract a meaningful URL
      if (!url) return;

      const protocol = detectProtocol(url, body);

      results.push({
        kind: protocol === 'graphql' ? 'graphql' : 'axios',
        protocol,
        filePath,
        ownerName: findOwnerName(node),
        line: node.getStartLineNumber(),
        requestType: body ? 'inferred-from-body' : undefined,
        responseType: inferResponseType(node),
        fetch: undefined,
        axios: { url, method, headers, body, axiosMethod },
        nextApiRoute: undefined,
        serverAction: undefined,
        reactQuery: undefined,
        swr: undefined,
      });
    });
  } catch (err) {
    console.log(`[morphkit] Warning: axios extraction error in ${filePath}: ${(err as Error).message}`);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Next.js API routes (app/api/*/route.ts)
// ---------------------------------------------------------------------------

function extractNextApiRoutes(
  project: Project,
  apiFiles: string[],
  repoPath: string,
): ExtractedApi[] {
  const results: ExtractedApi[] = [];

  for (const filePath of apiFiles) {
    let sourceFile: SourceFile | undefined;
    try {
      sourceFile = project.getSourceFile(filePath);
    } catch {
      continue;
    }
    if (!sourceFile) continue;

    try {
      const relativePath = path.relative(repoPath, filePath);

      // Derive URL path from file path: app/api/users/route.ts -> /api/users
      const appPrefixMatch = relativePath.match(/^(?:src\/)?app\/(.*?)\/route\.(ts|tsx|js|jsx)$/);
      const urlPath = appPrefixMatch ? '/' + appPrefixMatch[1] : '/' + relativePath;

      // Find exported HTTP method handlers
      const methods: HttpMethod[] = [];
      const methodNames: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

      let requestType: string | undefined;
      let responseType: string | undefined;

      for (const methodName of methodNames) {
        // Check function exports
        const fn = sourceFile.getFunction(methodName);
        if (fn && fn.isExported()) {
          methods.push(methodName);

          // Extract request/response types from parameters
          const params = fn.getParameters();
          if (params.length > 0) {
            try {
              requestType = params[0]!.getType().getText(params[0]!);
            } catch {
              // ignore
            }
          }
          try {
            responseType = fn.getReturnType().getText(fn);
          } catch {
            // ignore
          }
          continue;
        }

        // Check variable exports
        const varDecl = sourceFile.getVariableDeclaration(methodName);
        if (varDecl) {
          const statement = varDecl.getParent()?.getParent();
          if (statement && Node.isVariableStatement(statement) && statement.isExported()) {
            methods.push(methodName);
          }
        }
      }

      if (methods.length === 0) continue;

      results.push({
        kind: 'next-api-route',
        protocol: 'rest',
        filePath,
        ownerName: path.basename(path.dirname(filePath)),
        line: 1,
        requestType,
        responseType,
        fetch: undefined,
        axios: undefined,
        nextApiRoute: {
          routePath: relativePath,
          urlPath,
          methods,
          requestType,
          responseType,
        },
        serverAction: undefined,
        reactQuery: undefined,
        swr: undefined,
      });
    } catch (err) {
      console.log(`[morphkit] Warning: API route extraction error in ${filePath}: ${(err as Error).message}`);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Server Actions
// ---------------------------------------------------------------------------

function extractServerActions(sourceFile: SourceFile, filePath: string): ExtractedApi[] {
  const results: ExtractedApi[] = [];

  try {
    const fileText = sourceFile.getFullText();

    // Check for 'use server' directive at file level
    const isServerFile = /^['"]use server['"]/.test(fileText.trim());

    // Find functions with 'use server' directive or in a 'use server' file
    for (const fn of sourceFile.getFunctions()) {
      const fnText = fn.getText();
      const hasDirective = fnText.includes("'use server'") || fnText.includes('"use server"');

      if (!isServerFile && !hasDirective) continue;
      if (!fn.isExported()) continue;

      const name = fn.getName() ?? 'anonymous';
      const parameters = fn.getParameters().map((p) => ({
        name: p.getName(),
        type: (() => {
          try {
            return p.getType().getText(p);
          } catch {
            return 'unknown';
          }
        })(),
      }));

      let returnType = 'void';
      try {
        returnType = fn.getReturnType().getText(fn);
      } catch {
        // ignore
      }

      results.push({
        kind: 'server-action',
        protocol: 'rest',
        filePath,
        ownerName: name,
        line: fn.getStartLineNumber(),
        requestType: parameters.length > 0 ? parameters.map((p) => `${p.name}: ${p.type}`).join(', ') : undefined,
        responseType: returnType,
        fetch: undefined,
        axios: undefined,
        nextApiRoute: undefined,
        serverAction: {
          name,
          parameters,
          returnType,
          hasDirective: hasDirective || isServerFile,
        },
        reactQuery: undefined,
        swr: undefined,
      });
    }

    // Also check arrow function exports in 'use server' files
    if (isServerFile) {
      for (const varStatement of sourceFile.getVariableStatements()) {
        if (!varStatement.isExported()) continue;
        for (const decl of varStatement.getDeclarations()) {
          const init = decl.getInitializer();
          if (!init) continue;
          if (!Node.isArrowFunction(init) && !Node.isFunctionExpression(init)) continue;

          const name = decl.getName();
          const fnNode = init;
          const parameters = fnNode.getParameters().map((p) => ({
            name: p.getName(),
            type: (() => {
              try {
                return p.getType().getText(p);
              } catch {
                return 'unknown';
              }
            })(),
          }));

          let returnType = 'void';
          try {
            returnType = fnNode.getReturnType().getText(fnNode);
          } catch {
            // ignore
          }

          results.push({
            kind: 'server-action',
            protocol: 'rest',
            filePath,
            ownerName: name,
            line: varStatement.getStartLineNumber(),
            requestType: parameters.length > 0 ? parameters.map((p) => `${p.name}: ${p.type}`).join(', ') : undefined,
            responseType: returnType,
            fetch: undefined,
            axios: undefined,
            nextApiRoute: undefined,
            serverAction: {
              name,
              parameters,
              returnType,
              hasDirective: true,
            },
            reactQuery: undefined,
            swr: undefined,
          });
        }
      }
    }
  } catch (err) {
    console.log(`[morphkit] Warning: server action extraction error in ${filePath}: ${(err as Error).message}`);
  }

  return results;
}

// ---------------------------------------------------------------------------
// React Query / SWR hooks
// ---------------------------------------------------------------------------

function extractQueryHooks(sourceFile: SourceFile, filePath: string): ExtractedApi[] {
  const results: ExtractedApi[] = [];

  try {
    sourceFile.forEachDescendant((node) => {
      if (!Node.isCallExpression(node)) return;

      const exprText = node.getExpression().getText();
      const args = node.getArguments();

      // React Query
      if (['useQuery', 'useMutation', 'useInfiniteQuery', 'useSuspenseQuery'].includes(exprText)) {
        let queryKey = '';
        let fetchFn = '';

        if (args.length > 0) {
          const firstArg = args[0]!;
          if (Node.isObjectLiteralExpression(firstArg)) {
            for (const prop of firstArg.getProperties()) {
              if (!Node.isPropertyAssignment(prop)) continue;
              if (prop.getName() === 'queryKey') queryKey = prop.getInitializer()?.getText() ?? '';
              if (prop.getName() === 'queryFn' || prop.getName() === 'mutationFn') {
                fetchFn = prop.getInitializer()?.getText().substring(0, 300) ?? '';
              }
            }
          } else {
            queryKey = firstArg.getText();
            if (args.length > 1) fetchFn = args[1]!.getText().substring(0, 300);
          }
        }

        results.push({
          kind: 'react-query',
          protocol: 'rest',
          filePath,
          ownerName: findOwnerName(node),
          line: node.getStartLineNumber(),
          requestType: undefined,
          responseType: undefined,
          fetch: undefined,
          axios: undefined,
          nextApiRoute: undefined,
          serverAction: undefined,
          reactQuery: { hookName: exprText, queryKey, fetchFn },
          swr: undefined,
        });
      }

      // SWR
      if (['useSWR', 'useSWRInfinite', 'useSWRMutation'].includes(exprText)) {
        const key = args.length > 0 ? args[0]!.getText() : '';
        const fetcher = args.length > 1 ? args[1]!.getText().substring(0, 300) : '';

        results.push({
          kind: 'swr',
          protocol: 'rest',
          filePath,
          ownerName: findOwnerName(node),
          line: node.getStartLineNumber(),
          requestType: undefined,
          responseType: undefined,
          fetch: undefined,
          axios: undefined,
          nextApiRoute: undefined,
          serverAction: undefined,
          reactQuery: undefined,
          swr: { key, fetcher },
        });
      }
    });
  } catch (err) {
    console.log(`[morphkit] Warning: query hook extraction error in ${filePath}: ${(err as Error).message}`);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract all API endpoints and data-fetching patterns from the project files.
 *
 * Scans for: fetch() calls, axios calls, Next.js API routes, server actions,
 * React Query hooks, and SWR hooks.
 */
export function extractApiEndpoints(
  project: Project,
  files: string[],
  options?: {
    /** API route file paths (app/api/.../route.ts) */
    apiRouteFiles?: string[];
    /** Root path of the repo (for computing URL paths) */
    repoPath?: string;
  },
): ExtractedApi[] {
  console.log(`[morphkit] Extracting API endpoints from ${files.length} files`);

  const results: ExtractedApi[] = [];
  const repoPath = options?.repoPath ?? '';

  // Extract Next.js API routes
  if (options?.apiRouteFiles && options.apiRouteFiles.length > 0) {
    results.push(...extractNextApiRoutes(project, options.apiRouteFiles, repoPath));
  }

  // Process each source file
  for (const filePath of files) {
    let sourceFile: SourceFile | undefined;
    try {
      sourceFile = project.getSourceFile(filePath);
    } catch {
      continue;
    }
    if (!sourceFile) continue;

    try {
      results.push(...extractFetchCalls(sourceFile, filePath));
      results.push(...extractAxiosCalls(sourceFile, filePath));
      results.push(...extractServerActions(sourceFile, filePath));
      results.push(...extractQueryHooks(sourceFile, filePath));
    } catch (err) {
      console.log(`[morphkit] Warning: API extraction error in ${filePath}: ${(err as Error).message}`);
    }
  }

  console.log(`[morphkit] Found ${results.length} API endpoints/calls`);
  return results;
}

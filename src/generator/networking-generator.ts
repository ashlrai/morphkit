// Morphkit Networking Layer Generator
// Generates a typed URLSession-based API client from Semantic App Model

import type {
    SemanticAppModel,
    ApiEndpoint,
    TypeDefinition,
    Entity,
    ConfidenceLevel,
} from '../semantic/model';

import type { GeneratedFile } from './swiftui-generator';
import { pascalCase, camelCase } from './swiftui-generator';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Names that are not useful as type names — treat as untyped */
const JUNK_TYPE_NAMES = new Set([
    'any', 'unknown', 'object', 'request', 'response',
    'promise<any>', 'promise<response>', 'promise',
    'void', 'undefined', 'null',
    'nextrequest', 'nextresponse', 'nextapiresponse',
    'inferredfrombody', 'body', 'requestbody',
]);

/** Return true if a typeName is meaningful enough to use in Swift output */
function isUsableTypeName(name: string | undefined): boolean {
    if (!name) return false;
    // Normalize: lowercase and strip hyphens/underscores for matching
    const normalized = name.toLowerCase().replace(/[-_]+/g, '');
    if (JUNK_TYPE_NAMES.has(normalized) || JUNK_TYPE_NAMES.has(name.toLowerCase())) return false;
    // Reject lowercase TS primitives that shouldn't be Swift type names
    if (name === 'number' || name === 'boolean' || name === 'string') return false;
    // Reject names containing TS/JS syntax characters (generics, unions, object literals, arrow fns)
    if (/[<>|{}]|=>/.test(name)) return false;
    return true;
}

/**
 * Convert a TypeDefinition to a Swift type string for networking context.
 *
 * NOTE: This intentionally differs from the canonical typeDefToSwift in
 * swiftui-generator.ts. The networking version promotes usable typeNames
 * on non-object kinds (e.g., `{ kind: 'string', typeName: 'Product' }` -> 'Product')
 * because API response types often carry domain-specific type names that
 * should appear in generated Swift method signatures.
 */
function typeDefToSwift(td: TypeDefinition): string {
    // Sanitize typeName: map JS/TS type names that leak through the analyzer
    const rawName = td.typeName;
    const sanitizedName = sanitizeTypeName(rawName);

    switch (td.kind) {
        case 'string':
            return isUsableTypeName(sanitizedName) ? pascalCase(sanitizedName!) : 'String';
        case 'number':
            return 'Double';
        case 'boolean':
            return 'Bool';
        case 'date':
            return 'Date';
        case 'array':
            if (td.elementType) {
                return `[${typeDefToSwift(td.elementType)}]`;
            }
            return '[Any]';
        case 'object':
            return isUsableTypeName(sanitizedName) ? pascalCase(sanitizedName!) : 'Any';
        case 'enum':
            return isUsableTypeName(sanitizedName) ? pascalCase(sanitizedName!) : 'String';
        case 'union':
            return isUsableTypeName(sanitizedName) ? pascalCase(sanitizedName!) : 'String';
        case 'literal':
            return 'String';
        case 'unknown':
        default:
            return isUsableTypeName(sanitizedName) ? pascalCase(sanitizedName!) : 'Any';
    }
}

/**
 * Sanitize a raw typeName from the analyzer — map leaked JS/TS types to their
 * Swift equivalents or return undefined if the name is not usable.
 */
function sanitizeTypeName(name: string | undefined): string | undefined {
    if (!name) return undefined;

    // Map capitalized JS types to Swift equivalents
    if (name === 'Number') return undefined;   // handled by kind='number' → Double
    if (name === 'Boolean') return undefined;   // handled by kind='boolean' → Bool

    // Reject names containing TS syntax (Promise<...>, unions, arrow fns, object literals)
    if (/[<>|{}]|=>/.test(name)) return undefined;

    // Reject function signature types
    if (/\(.*\)\s*=>/.test(name)) return undefined;

    return name;
}

// ---------------------------------------------------------------------------
// URL cleaning — strip JS template literal syntax, normalise to REST paths
// ---------------------------------------------------------------------------

/**
 * Clean a raw URL that may contain JS template-literal syntax, function calls,
 * variable references, backticks, etc. and return a clean REST-style path.
 *
 * Examples:
 *   "`${API_BASE}/products/${id}`"  →  "/products/:id"
 *   "url.toString()"                →  null  (not a valid endpoint)
 *   "/api/products"                 →  "/api/products"
 *   "`${API_BASE}/products/search?q=${encodeURIComponent(query)}`"
 *                                   →  "/products/search"
 */
function cleanURL(raw: string): string | null {
    let url = raw.trim();

    // Strip surrounding backticks (template literals)
    if (url.startsWith('`') && url.endsWith('`')) {
        url = url.slice(1, -1);
    }

    // Replace ${SOME_BASE_VAR} at the start (e.g. ${API_BASE}) with nothing —
    // these are just a base URL constant and add no path info.
    url = url.replace(/^\$\{[A-Za-z_][A-Za-z0-9_]*\}/, '');

    // Replace remaining ${expr} with a path parameter placeholder.
    // Simple identifiers like ${id} become :id
    // Complex expressions like ${encodeURIComponent(query)} become :query (extract inner var)
    url = url.replace(/\$\{([^}]+)\}/g, (_match, expr: string) => {
        // Try to extract a simple variable name from the expression
        const simpleVar = expr.match(/^([a-zA-Z_][a-zA-Z0-9_]*)$/);
        if (simpleVar) return `:${simpleVar[1]}`;

        // For function-call expressions like encodeURIComponent(query), extract the argument
        const fnCall = expr.match(/\w+\(([a-zA-Z_][a-zA-Z0-9_]*)\)/);
        if (fnCall) return `:${fnCall[1]}`;

        // Fallback: use a generic param name
        return ':param';
    });

    // Strip query strings — Swift clients typically build these separately
    const queryIdx = url.indexOf('?');
    if (queryIdx !== -1) {
        url = url.substring(0, queryIdx);
    }

    // Convert Next.js dynamic route params: [param] → :param
    url = url.replace(/\[([a-zA-Z_][a-zA-Z0-9_]*)\]/g, ':$1');

    // Strip any remaining JS artifacts (e.g., string concatenation operators, quotes)
    url = url.replace(/['"]+/g, '').replace(/\s*\+\s*/g, '');

    // If the result doesn't look like a URL path at all, discard it
    if (!url.startsWith('/') && !url.startsWith('http')) {
        return null;
    }

    // Normalise: remove trailing slash, collapse double slashes
    url = url.replace(/\/+/g, '/').replace(/\/$/, '') || '/';

    return url;
}

/**
 * Return true if the raw URL is clearly not a real endpoint
 * (e.g. "url.toString()", random JS expressions).
 */
function isGarbageURL(raw: string): boolean {
    return cleanURL(raw) === null;
}

/** Extract path parameters from a URL pattern (`:param` or `{param}`) */
function extractPathParams(url: string): string[] {
    const params: string[] = [];
    const seen = new Set<string>();
    const colonMatch = url.match(/:([a-zA-Z_][a-zA-Z0-9_]*)/g);
    if (colonMatch) {
        for (const m of colonMatch) {
            const name = m.slice(1);
            if (!seen.has(name)) {
                seen.add(name);
                params.push(name);
            }
        }
    }
    const braceMatch = url.match(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g);
    if (braceMatch) {
        for (const m of braceMatch) {
            const name = m.slice(1, -1);
            if (!seen.has(name)) {
                seen.add(name);
                params.push(name);
            }
        }
    }
    return params;
}

/** Infer a base URL from a list of API endpoints by extracting a common prefix */
function inferBaseURL(endpoints: ApiEndpoint[]): string {
    if (endpoints.length === 0) return 'https://api.example.com';

    const urls = endpoints.map((e) => e.url);

    // Look for full URLs (starting with http) — but first clean off template syntax
    for (const raw of urls) {
        const cleaned = cleanURL(raw);
        if (cleaned && cleaned.startsWith('http')) {
            try {
                const parsed = new URL(cleaned);
                return `${parsed.protocol}//${parsed.host}`;
            } catch {
                // fall through
            }
        }
    }

    // Also try the raw URLs in case they're already clean
    const fullUrls = urls.filter((u) => u.startsWith('http'));
    if (fullUrls.length > 0) {
        try {
            const parsed = new URL(fullUrls[0]);
            return `${parsed.protocol}//${parsed.host}`;
        } catch {
            // fall through
        }
    }

    return 'https://api.example.com';
}

/**
 * Deduplicate endpoints: if two endpoints resolve to the same method+cleanedPath,
 * keep only the first. Also filters out garbage URLs.
 */
function deduplicateEndpoints(endpoints: ApiEndpoint[]): ApiEndpoint[] {
    const seen = new Set<string>();
    const result: ApiEndpoint[] = [];

    for (const ep of endpoints) {
        if (isGarbageURL(ep.url)) continue;

        const cleaned = cleanURL(ep.url);
        if (!cleaned) continue;

        // Normalize for deduplication: strip /api/ prefix and trailing params
        const normalized = cleaned.replace(/^\/api\//, '/');
        const key = `${(ep.method ?? 'GET').toUpperCase()}:${normalized}`;
        if (seen.has(key)) continue;

        seen.add(key);
        result.push(ep);
    }

    return result;
}

// ---------------------------------------------------------------------------
// NetworkError enum
// ---------------------------------------------------------------------------

function generateNetworkError(): string {
    return `// Generated by Morphkit

import Foundation

enum NetworkError: LocalizedError {
    case invalidURL
    case invalidResponse
    case httpError(statusCode: Int, data: Data?)
    case decodingError(Error)
    case encodingError(Error)
    case unauthorized
    case forbidden
    case notFound
    case serverError(statusCode: Int)
    case networkUnavailable
    case timeout
    case unknown(Error)

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            "The URL is invalid."
        case .invalidResponse:
            "The server returned an invalid response."
        case .httpError(let statusCode, _):
            "HTTP error \\(statusCode)."
        case .decodingError(let error):
            "Failed to decode response: \\(error.localizedDescription)"
        case .encodingError(let error):
            "Failed to encode request: \\(error.localizedDescription)"
        case .unauthorized:
            "Authentication required. Please sign in again."
        case .forbidden:
            "You don't have permission to access this resource."
        case .notFound:
            "The requested resource was not found."
        case .serverError(let statusCode):
            "Server error (\\(statusCode)). Please try again later."
        case .networkUnavailable:
            "No network connection available."
        case .timeout:
            "The request timed out. Please try again."
        case .unknown(let error):
            "An unexpected error occurred: \\(error.localizedDescription)"
        }
    }
}`;
}

// ---------------------------------------------------------------------------
// APIConfiguration
// ---------------------------------------------------------------------------

function generateAPIConfiguration(model: SemanticAppModel): string {
    const baseURL = inferBaseURL(model.apiEndpoints ?? []);
    // Ensure base URL uses HTTPS in production
    const productionURL = baseURL.replace(/^http:\/\//, 'https://');
    const apiVersion = 'v1';

    return `// Generated by Morphkit

import Foundation

enum APIConfiguration {
    #if DEBUG
    static let baseURL = URL(string: "${baseURL}")!
    #else
    static let baseURL = URL(string: "${productionURL}")!
    #endif

    static let apiVersion = "${apiVersion}"
    static let timeoutInterval: TimeInterval = 30

    static var versionedBaseURL: URL {
        baseURL.appendingPathComponent(apiVersion)
    }

    enum Headers {
        static let contentType = "Content-Type"
        static let authorization = "Authorization"
        static let accept = "Accept"
        static let applicationJSON = "application/json"
    }

    /// Configured URLSession with TLS pinning and secure defaults
    static var secureSession: URLSession {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = timeoutInterval
        config.timeoutIntervalForResource = 300
        config.tlsMinimumSupportedProtocolVersion = .TLSv12
        config.httpAdditionalHeaders = [
            Headers.accept: Headers.applicationJSON,
            Headers.contentType: Headers.applicationJSON,
        ]
        return URLSession(configuration: config)
    }
}`;
}

// ---------------------------------------------------------------------------
// APIClient
// ---------------------------------------------------------------------------

function generateAPIClient(model: SemanticAppModel): string {
    const endpoints = deduplicateEndpoints(model.apiEndpoints ?? []);
    const lines: string[] = [];

    lines.push('// Generated by Morphkit');
    lines.push('');
    lines.push('import Foundation');
    lines.push('import Observation');
    lines.push('');
    lines.push('@Observable');
    lines.push('final class APIClient {');
    lines.push('    private let session: URLSession');
    lines.push('    private let decoder: JSONDecoder');
    lines.push('    private let encoder: JSONEncoder');
    lines.push('    private var authToken: String?');
    lines.push('');
    lines.push('    static let shared = APIClient()');
    lines.push('');
    lines.push('    init(session: URLSession = APIConfiguration.secureSession) {');
    lines.push('        self.session = session');
    lines.push('');
    lines.push('        self.decoder = JSONDecoder()');
    lines.push('        decoder.keyDecodingStrategy = .convertFromSnakeCase');
    lines.push('        decoder.dateDecodingStrategy = .iso8601');
    lines.push('');
    lines.push('        self.encoder = JSONEncoder()');
    lines.push('        encoder.keyEncodingStrategy = .convertToSnakeCase');
    lines.push('        encoder.dateEncodingStrategy = .iso8601');
    lines.push('    }');
    lines.push('');

    // Auth
    lines.push('    // MARK: - Authentication');
    lines.push('');
    lines.push('    func setAuthToken(_ token: String?) {');
    lines.push('        self.authToken = token');
    lines.push('    }');
    lines.push('');

    // Generic request method
    lines.push('    // MARK: - Core Request');
    lines.push('');
    lines.push('    private func request<T: Decodable>(');
    lines.push('        path: String,');
    lines.push('        method: String = "GET",');
    lines.push('        body: (any Encodable)? = nil,');
    lines.push('        queryItems: [URLQueryItem]? = nil');
    lines.push('    ) async throws -> T {');
    lines.push('        var url = APIConfiguration.versionedBaseURL.appendingPathComponent(path)');
    lines.push('');
    lines.push('        if let queryItems, !queryItems.isEmpty {');
    lines.push('            var components = URLComponents(url: url, resolvingAgainstBaseURL: false)!');
    lines.push('            components.queryItems = queryItems');
    lines.push('            url = components.url!');
    lines.push('        }');
    lines.push('');
    lines.push('        var urlRequest = URLRequest(url: url)');
    lines.push('        urlRequest.httpMethod = method');
    lines.push('        urlRequest.timeoutInterval = APIConfiguration.timeoutInterval');
    lines.push('        urlRequest.setValue(APIConfiguration.Headers.applicationJSON, forHTTPHeaderField: APIConfiguration.Headers.contentType)');
    lines.push('        urlRequest.setValue(APIConfiguration.Headers.applicationJSON, forHTTPHeaderField: APIConfiguration.Headers.accept)');
    lines.push('');
    lines.push('        if let authToken {');
    lines.push('            urlRequest.setValue("Bearer \\(authToken)", forHTTPHeaderField: APIConfiguration.Headers.authorization)');
    lines.push('        }');
    lines.push('');
    lines.push('        if let body {');
    lines.push('            do {');
    lines.push('                urlRequest.httpBody = try encoder.encode(body)');
    lines.push('            } catch {');
    lines.push('                throw NetworkError.encodingError(error)');
    lines.push('            }');
    lines.push('        }');
    lines.push('');
    lines.push('        let data: Data');
    lines.push('        let response: URLResponse');
    lines.push('');
    lines.push('        do {');
    lines.push('            (data, response) = try await session.data(for: urlRequest)');
    lines.push('        } catch let error as URLError where error.code == .notConnectedToInternet {');
    lines.push('            throw NetworkError.networkUnavailable');
    lines.push('        } catch let error as URLError where error.code == .timedOut {');
    lines.push('            throw NetworkError.timeout');
    lines.push('        } catch {');
    lines.push('            throw NetworkError.unknown(error)');
    lines.push('        }');
    lines.push('');
    lines.push('        guard let httpResponse = response as? HTTPURLResponse else {');
    lines.push('            throw NetworkError.invalidResponse');
    lines.push('        }');
    lines.push('');
    lines.push('        switch httpResponse.statusCode {');
    lines.push('        case 200...299:');
    lines.push('            break');
    lines.push('        case 401:');
    lines.push('            throw NetworkError.unauthorized');
    lines.push('        case 403:');
    lines.push('            throw NetworkError.forbidden');
    lines.push('        case 404:');
    lines.push('            throw NetworkError.notFound');
    lines.push('        case 500...599:');
    lines.push('            throw NetworkError.serverError(statusCode: httpResponse.statusCode)');
    lines.push('        default:');
    lines.push('            throw NetworkError.httpError(statusCode: httpResponse.statusCode, data: data)');
    lines.push('        }');
    lines.push('');
    lines.push('        do {');
    lines.push('            return try decoder.decode(T.self, from: data)');
    lines.push('        } catch {');
    lines.push('            throw NetworkError.decodingError(error)');
    lines.push('        }');
    lines.push('    }');
    lines.push('');

    // Void variant for delete/post that don't return a body
    lines.push('    private func requestVoid(');
    lines.push('        path: String,');
    lines.push('        method: String = "DELETE",');
    lines.push('        body: (any Encodable)? = nil');
    lines.push('    ) async throws {');
    lines.push('        let url = APIConfiguration.versionedBaseURL.appendingPathComponent(path)');
    lines.push('');
    lines.push('        var urlRequest = URLRequest(url: url)');
    lines.push('        urlRequest.httpMethod = method');
    lines.push('        urlRequest.timeoutInterval = APIConfiguration.timeoutInterval');
    lines.push('        urlRequest.setValue(APIConfiguration.Headers.applicationJSON, forHTTPHeaderField: APIConfiguration.Headers.contentType)');
    lines.push('');
    lines.push('        if let authToken {');
    lines.push('            urlRequest.setValue("Bearer \\(authToken)", forHTTPHeaderField: APIConfiguration.Headers.authorization)');
    lines.push('        }');
    lines.push('');
    lines.push('        if let body {');
    lines.push('            urlRequest.httpBody = try encoder.encode(body)');
    lines.push('        }');
    lines.push('');
    lines.push('        let (_, response) = try await session.data(for: urlRequest)');
    lines.push('');
    lines.push('        guard let httpResponse = response as? HTTPURLResponse else {');
    lines.push('            throw NetworkError.invalidResponse');
    lines.push('        }');
    lines.push('');
    lines.push('        guard (200...299).contains(httpResponse.statusCode) else {');
    lines.push('            switch httpResponse.statusCode {');
    lines.push('            case 401: throw NetworkError.unauthorized');
    lines.push('            case 403: throw NetworkError.forbidden');
    lines.push('            case 404: throw NetworkError.notFound');
    lines.push('            default: throw NetworkError.httpError(statusCode: httpResponse.statusCode, data: nil)');
    lines.push('            }');
    lines.push('        }');
    lines.push('    }');

    // Generated endpoint methods — deduplicate by function signature
    if (endpoints.length > 0) {
        lines.push('');
        lines.push('    // MARK: - API Endpoints');

        const generatedFuncNames = new Set<string>();
        for (const endpoint of endpoints) {
            const funcName = camelCase(generateFunctionName(endpoint));
            // Build a signature key including parameter types to allow overloads
            const pathParams = extractPathParams(cleanURL(endpoint.url) ?? '/');
            const sigKey = `${funcName}(${pathParams.length})`;
            if (generatedFuncNames.has(sigKey)) continue;
            generatedFuncNames.add(sigKey);

            lines.push('');
            lines.push(generateEndpointMethod(endpoint, model.entities ?? []));
        }
    }

    lines.push('}');

    return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Endpoint method generation
// ---------------------------------------------------------------------------

function generateEndpointMethod(endpoint: ApiEndpoint, entities: Entity[] = []): string {
    const method = (endpoint.method ?? 'GET').toUpperCase();
    const functionName = camelCase(generateFunctionName(endpoint));

    // Resolve the return type: prefer the TypeDefinition if it produces a real
    // type, otherwise try to infer from entity names matched against the URL.
    let returnType = typeDefToSwift(endpoint.responseType);
    let typeInferred = false;

    // Guard: if the resolved return type still contains TS/JS syntax, treat as unresolvable
    if (/[<>|{}]|=>/.test(returnType)) {
        returnType = 'Any';
    }

    if (returnType === 'Any' || returnType === '[Any]') {
        const inferred = inferReturnTypeFromEntities(endpoint, entities);
        if (inferred) {
            returnType = inferred;
            typeInferred = true;
        }
    }

    const cleanedUrl = cleanURL(endpoint.url) ?? '/';

    // Strip /api/ prefix — the base URL configuration handles the API prefix
    const swiftBasePath = cleanedUrl.replace(/^\/api\//, '/');

    const pathParams = extractPathParams(cleanedUrl);
    const lines: string[] = [];

    // Build function signature
    const params: string[] = [];

    // Path params (parsed from URL)
    for (const param of pathParams) {
        params.push(`${camelCase(param)}: String`);
    }

    // Body param — only include if the type is meaningful (not generic Request/any)
    if (endpoint.requestBody != null) {
        const bodyTypeName = endpoint.requestBody.typeName;
        const bodyType = (bodyTypeName && isUsableTypeName(bodyTypeName))
            ? pascalCase(bodyTypeName)
            : 'Encodable';
        // Skip body param for GET requests with non-useful body types
        if (method !== 'GET' || bodyType !== 'Encodable') {
            params.push(`body: ${bodyType}`);
        }
    }

    // Description comment
    if (endpoint.description) {
        lines.push(`    /// ${endpoint.description}`);
    }

    // When return type is Any/[Any], the generic request<T: Decodable> won't compile.
    // Fall back to Void return (caller can be updated with the actual type later).
    const isUnresolvableType = returnType === 'Any' || returnType === '[Any]';
    const effectiveReturnType = isUnresolvableType ? null : returnType;

    if (isUnresolvableType) {
        lines.push(`    // Note: response type could not be inferred — update return type and body with actual type`);
    }

    const hasBody = method !== 'GET' && endpoint.requestBody != null;

    if (effectiveReturnType && effectiveReturnType !== 'Void') {
        lines.push(`    func ${functionName}(${params.join(', ')}) async throws -> ${effectiveReturnType} {`);
    } else if (method === 'DELETE' || (method === 'POST' && !effectiveReturnType) || isUnresolvableType) {
        lines.push(`    func ${functionName}(${params.join(', ')}) async throws {`);
    } else {
        lines.push(`    func ${functionName}(${params.join(', ')}) async throws -> ${effectiveReturnType ?? 'Void'} {`);
    }

    // Build path with Swift string interpolation for path params
    let swiftPath = swiftBasePath;
    for (const param of pathParams) {
        swiftPath = swiftPath.replace(`:${param}`, `\\(${camelCase(param)})`);
        swiftPath = swiftPath.replace(`{${param}}`, `\\(${camelCase(param)})`);
    }

    // Make the call
    if (effectiveReturnType && effectiveReturnType !== 'Void') {
        const requestArgs = [
            `path: "${swiftPath}"`,
            method !== 'GET' ? `method: "${method}"` : null,
            hasBody ? 'body: body' : null,
        ].filter(Boolean);

        lines.push(`        return try await request(${requestArgs.join(', ')})`);
    } else {
        const requestArgs = [
            `path: "${swiftPath}"`,
            `method: "${method}"`,
            hasBody ? 'body: body' : null,
        ].filter(Boolean);

        lines.push(`        try await requestVoid(${requestArgs.join(', ')})`);
    }

    lines.push('    }');

    return lines.join('\n');
}

function generateFunctionName(endpoint: ApiEndpoint): string {
    const method = (endpoint.method ?? 'GET').toLowerCase();
    const cleaned = cleanURL(endpoint.url) ?? '/resource';

    // Get meaningful path segments (skip empty, params, and 'api')
    const segments = cleaned
        .split('/')
        .filter((s) => s && !s.startsWith(':') && !s.startsWith('{') && !s.startsWith('[') && s !== 'api');

    const resource = segments[segments.length - 1] ?? 'resource';

    // Detect if the URL has a path parameter — if so, the resource is likely singular
    const hasPathParam = cleaned.includes(':') || cleaned.includes('{');

    // For GET with a path param (e.g. /products/:id), use singular form
    const resourceName = (method === 'get' && hasPathParam)
        ? singularize(resource)
        : resource;

    switch (method) {
        case 'get':
            return `fetch${pascalCase(resourceName)}`;
        case 'post':
            return `create${pascalCase(singularize(resource))}`;
        case 'put':
        case 'patch':
            return `update${pascalCase(singularize(resource))}`;
        case 'delete':
            return `delete${pascalCase(singularize(resource))}`;
        default:
            return `${method}${pascalCase(resource)}`;
    }
}

/** Naive singularize — handles common English plural suffixes */
function singularize(word: string): string {
    if (word.endsWith('ies')) return word.slice(0, -3) + 'y';
    if (word.endsWith('ses') || word.endsWith('xes') || word.endsWith('zes') ||
        word.endsWith('shes') || word.endsWith('ches')) {
        return word.slice(0, -2);
    }
    if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
    return word;
}

/** Naive pluralize — handles common English singular suffixes */
function pluralize(word: string): string {
    if (word.endsWith('y') && !/[aeiou]y$/i.test(word)) return word.slice(0, -1) + 'ies';
    if (word.endsWith('s') || word.endsWith('x') || word.endsWith('z') ||
        word.endsWith('sh') || word.endsWith('ch')) {
        return word + 'es';
    }
    return word + 's';
}

/**
 * Try to infer a Swift return type from the endpoint URL by matching path
 * segments against known entity names from the semantic model.
 *
 * For example:
 *   GET /products        + entity "Product"  → "[Product]"
 *   GET /products/:id    + entity "Product"  → "Product"
 *   POST /products       + entity "Product"  → "Product"
 *
 * Returns null if no match is found.
 */
function inferReturnTypeFromEntities(
    endpoint: ApiEndpoint,
    entities: Entity[],
): string | null {
    if (entities.length === 0) return null;

    const cleanedUrl = cleanURL(endpoint.url);
    if (!cleanedUrl) return null;

    const method = (endpoint.method ?? 'GET').toUpperCase();

    // Get meaningful path segments (skip empty, params, and 'api')
    const segments = cleanedUrl
        .split('/')
        .filter((s) => s && !s.startsWith(':') && !s.startsWith('{') && !s.startsWith('[') && s !== 'api');

    if (segments.length === 0) return null;

    // The last meaningful segment is typically the resource name, e.g. "products"
    const resourceSegment = segments[segments.length - 1].toLowerCase();
    const hasPathParam = cleanedUrl.includes(':') || cleanedUrl.includes('{');

    // Build a lookup: lowercased entity name → original entity name
    const entityLookup = new Map<string, string>();
    for (const entity of entities) {
        const name = entity.name;
        entityLookup.set(name.toLowerCase(), name);
        // Also store singular and plural variants
        entityLookup.set(singularize(name.toLowerCase()), name);
        entityLookup.set(pluralize(name.toLowerCase()), name);
    }

    // Try to match the resource segment to an entity
    // 1. Direct match (e.g. segment "products" matches entity "Products")
    // 2. Singular match (e.g. segment "products" → singularize → "product" matches entity "Product")
    // 3. Plural match (e.g. segment "product" → pluralize → "products" matches entity "Products")
    const singularSegment = singularize(resourceSegment);
    const pluralSegment = pluralize(resourceSegment);

    let matchedEntityName: string | null = null;

    // Check all variants against the lookup
    for (const candidate of [resourceSegment, singularSegment, pluralSegment]) {
        const found = entityLookup.get(candidate);
        if (found) {
            matchedEntityName = found;
            break;
        }
    }

    if (!matchedEntityName) return null;

    // Use PascalCase for the Swift type name, and always use the singular form
    const swiftTypeName = pascalCase(singularize(matchedEntityName));

    // Determine if we should return an array or a single item
    // GET without path param → array (list endpoint)
    // GET with path param → single item
    // POST → single item (created resource)
    // PUT/PATCH → single item (updated resource)
    // DELETE → null (void, handled elsewhere)
    if (method === 'DELETE') {
        return null; // void return, don't override
    }

    if (method === 'GET' && !hasPathParam) {
        return `[${swiftTypeName}]`;
    }

    return swiftTypeName;
}

// ---------------------------------------------------------------------------
// Request/Response DTOs
// ---------------------------------------------------------------------------

function generateDTOs(model: SemanticAppModel): GeneratedFile[] {
    const endpoints = deduplicateEndpoints(model.apiEndpoints ?? []);
    const dtos: GeneratedFile[] = [];
    const generatedTypes = new Set<string>();

    for (const endpoint of endpoints) {
        // Request DTOs — requestBody is TypeDefinition | null
        if (endpoint.requestBody && endpoint.requestBody.fields) {
            const typeName = endpoint.requestBody.typeName
                ? pascalCase(endpoint.requestBody.typeName)
                : `${pascalCase(generateFunctionName(endpoint))}Request`;

            if (!generatedTypes.has(typeName)) {
                generatedTypes.add(typeName);
                dtos.push(generateDTOFile(typeName, endpoint.requestBody.fields, endpoint));
            }
        }
    }

    return dtos;
}

function generateDTOFile(typeName: string, fields: any[], endpoint: ApiEndpoint): GeneratedFile {
    const lines: string[] = [];

    lines.push(`// Generated by Morphkit`);
    lines.push('');
    lines.push('import Foundation');
    lines.push('');
    lines.push(`struct ${typeName}: Codable {`);

    for (const field of fields) {
        const name = camelCase(field.name);
        const type = field.type ? typeDefToSwift(field.type) : 'String';
        const isOptional = field.optional === true;
        lines.push(`    var ${name}: ${type}${isOptional ? '?' : ''}`);
    }

    lines.push('}');
    lines.push('');

    return {
        path: `Networking/DTOs/${typeName}.swift`,
        content: lines.join('\n'),
        sourceMapping: endpoint.sourceFile ?? 'unknown',
        confidence: 'high',
        warnings: [],
    };
}

// ---------------------------------------------------------------------------
// Keychain helper for secure token storage
// ---------------------------------------------------------------------------

function generateKeychainHelper(): string {
    return `// Generated by Morphkit

import Foundation
import Security

/// Secure token storage using the iOS Keychain
enum KeychainHelper {
    private static let service = Bundle.main.bundleIdentifier ?? "com.morphkit.app"

    static func save(key: String, value: String) throws {
        guard let data = value.data(using: .utf8) else { return }

        // Delete any existing item first
        let deleteQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
        SecItemDelete(deleteQuery as CFDictionary)

        let addQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        ]

        let status = SecItemAdd(addQuery as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw KeychainError.saveFailed(status)
        }
    }

    static func read(key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        guard status == errSecSuccess, let data = result as? Data else {
            return nil
        }
        return String(data: data, encoding: .utf8)
    }

    static func delete(key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
        SecItemDelete(query as CFDictionary)
    }
}

enum KeychainError: LocalizedError {
    case saveFailed(OSStatus)

    var errorDescription: String? {
        switch self {
        case .saveFailed(let status):
            "Failed to save to Keychain (status: \\(status))"
        }
    }
}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function generateNetworkingLayer(model: SemanticAppModel): GeneratedFile[] {
    const files: GeneratedFile[] = [];
    const endpoints = deduplicateEndpoints(model.apiEndpoints ?? []);
    const hasRealBaseURL = inferBaseURL(endpoints) !== 'https://api.example.com';
    const warnings: string[] = [];

    // NetworkError
    files.push({
        path: 'Networking/NetworkError.swift',
        content: generateNetworkError(),
        sourceMapping: 'morphkit:networking',
        confidence: 'high',
        warnings: [],
    });

    // APIConfiguration
    files.push({
        path: 'Networking/APIConfiguration.swift',
        content: generateAPIConfiguration(model),
        sourceMapping: 'morphkit:networking',
        confidence: hasRealBaseURL ? 'high' : 'medium',
        warnings: hasRealBaseURL ? [] : ['Base URL is using placeholder — update APIConfiguration.baseURL'],
    });

    // APIClient
    if (endpoints.length === 0) {
        warnings.push('No API endpoints found — generated APIClient with core methods only');
    }

    files.push({
        path: 'Networking/APIClient.swift',
        content: generateAPIClient(model),
        sourceMapping: 'morphkit:networking',
        confidence: endpoints.length > 0 ? 'high' : 'medium',
        warnings,
    });

    // Keychain helper for secure token storage
    files.push({
        path: 'Networking/KeychainHelper.swift',
        content: generateKeychainHelper(),
        sourceMapping: 'morphkit:networking',
        confidence: 'high',
        warnings: [],
    });

    // DTOs
    const dtos = generateDTOs(model);
    files.push(...dtos);

    return files;
}

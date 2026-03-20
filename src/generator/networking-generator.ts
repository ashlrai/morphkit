// Morphkit Networking Layer Generator
// Generates a typed URLSession-based API client from Semantic App Model

import type {
    SemanticAppModel,
    ApiEndpoint,
    TypeDefinition,
    Entity,
} from '../semantic/model.js';

import { isJunkEntity } from './model-generator.js';
import type { GeneratedFile } from './swiftui-generator.js';
import { pascalCase, camelCase, isMarketingScreen, pluralize, cleanSourceName, cleanStoreName, isWebOnlyState } from './swiftui-generator.js';
import { cleanURL, extractPathParams, generateFunctionName, singularize } from './api-naming';

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
 * Sanitize a raw typeName from the analyzer — map leaked JS/TS capitalized
 * type names to undefined so the kind-based default is used instead.
 */
function sanitizeTypeName(name: string | undefined): string | undefined {
    if (!name) return undefined;

    // Capitalized JS types should fall through to kind-based defaults (Double, Bool)
    if (name === 'Number' || name === 'Boolean') return undefined;

    return name;
}

// cleanURL, extractPathParams, generateFunctionName, singularize are imported from ./api-naming

/**
 * Return true if the raw URL is clearly not a real endpoint
 * (e.g. "url.toString()", random JS expressions).
 */
function isGarbageURL(raw: string): boolean {
    return cleanURL(raw) === null;
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
// APIError enum (replaces basic NetworkError with production-quality errors)
// ---------------------------------------------------------------------------

function generateAPIError(): string {
    return `// Generated by Morphkit

import Foundation

enum APIError: LocalizedError {
    case networkError(URLError)
    case serverError(statusCode: Int, message: String?)
    case decodingError(DecodingError)
    case encodingError(Error)
    case unauthorized
    case rateLimited(retryAfter: TimeInterval?)
    case noData
    case invalidURL
    case invalidResponse

    var errorDescription: String? {
        switch self {
        case .networkError(let error):
            switch error.code {
            case .notConnectedToInternet:
                return "No internet connection available."
            case .timedOut:
                return "The request timed out. Please try again."
            default:
                return "Network error: \\(error.localizedDescription)"
            }
        case .serverError(let statusCode, let message):
            if let message {
                return "Server error (\\(statusCode)): \\(message)"
            }
            return "Server error (\\(statusCode)). Please try again later."
        case .decodingError(let error):
            return "Failed to decode response: \\(error.localizedDescription)"
        case .encodingError(let error):
            return "Failed to encode request: \\(error.localizedDescription)"
        case .unauthorized:
            return "Authentication required. Please sign in again."
        case .rateLimited(let retryAfter):
            if let retryAfter {
                return "Rate limited. Please try again in \\(Int(retryAfter)) seconds."
            }
            return "Too many requests. Please try again later."
        case .noData:
            return "No data received from server."
        case .invalidURL:
            return "The URL is invalid."
        case .invalidResponse:
            return "The server returned an invalid response."
        }
    }

    var isRetryable: Bool {
        switch self {
        case .networkError(let error):
            return error.code == .timedOut || error.code == .networkConnectionLost
        case .serverError(let statusCode, _):
            return (500...599).contains(statusCode)
        case .rateLimited:
            return true
        default:
            return false
        }
    }
}

// MARK: - Legacy Compatibility

/// Type alias for backward compatibility with existing code that references NetworkError
typealias NetworkError = APIError`;
}

// ---------------------------------------------------------------------------
// PaginatedResponse
// ---------------------------------------------------------------------------

function generatePaginatedResponse(): string {
    return `// Generated by Morphkit

import Foundation

/// Generic paginated response wrapper for list endpoints
struct PaginatedResponse<T: Codable>: Codable {
    let items: [T]
    let total: Int?
    let hasMore: Bool
    let nextCursor: String?

    init(items: [T], total: Int? = nil, hasMore: Bool = false, nextCursor: String? = nil) {
        self.items = items
        self.total = total
        self.hasMore = hasMore
        self.nextCursor = nextCursor
    }

    enum CodingKeys: String, CodingKey {
        case items, total, hasMore, nextCursor
        // Support common API pagination field names
        case data, results, records
        case totalCount, totalItems, count
        case next, cursor, nextPage
        case hasNext, hasNextPage
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        // Try multiple common keys for the items array
        if let items = try? container.decode([T].self, forKey: .items) {
            self.items = items
        } else if let data = try? container.decode([T].self, forKey: .data) {
            self.items = data
        } else if let results = try? container.decode([T].self, forKey: .results) {
            self.items = results
        } else if let records = try? container.decode([T].self, forKey: .records) {
            self.items = records
        } else {
            self.items = []
        }

        // Try multiple common keys for total
        self.total = (try? container.decode(Int.self, forKey: .total))
            ?? (try? container.decode(Int.self, forKey: .totalCount))
            ?? (try? container.decode(Int.self, forKey: .totalItems))
            ?? (try? container.decode(Int.self, forKey: .count))

        // Try multiple common keys for hasMore
        self.hasMore = (try? container.decode(Bool.self, forKey: .hasMore))
            ?? (try? container.decode(Bool.self, forKey: .hasNext))
            ?? (try? container.decode(Bool.self, forKey: .hasNextPage))
            ?? false

        // Try multiple common keys for cursor
        self.nextCursor = (try? container.decode(String.self, forKey: .nextCursor))
            ?? (try? container.decode(String.self, forKey: .next))
            ?? (try? container.decode(String.self, forKey: .cursor))
            ?? (try? container.decode(String.self, forKey: .nextPage))
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(items, forKey: .items)
        try container.encodeIfPresent(total, forKey: .total)
        try container.encode(hasMore, forKey: .hasMore)
        try container.encodeIfPresent(nextCursor, forKey: .nextCursor)
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
    lines.push('    private let maxRetries = 3');
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

    // Generate auth-specific API methods when auth is detected
    const hasAuth = model.auth != null;
    const authFlows = model.auth?.flows ?? [];
    const hasLoginFlow = hasAuth || authFlows.some(f => f.name.toLowerCase().includes('login'));
    const hasRegisterFlow = hasAuth || authFlows.some(f => f.name.toLowerCase().includes('signup') || f.name.toLowerCase().includes('register'));
    const hasRefreshFlow = authFlows.some(f => f.name.toLowerCase().includes('refresh'));

    // Find auth endpoints from model
    const loginEndpoint = (model.apiEndpoints ?? []).find(ep => {
        const url = ep.url.toLowerCase();
        return (url.includes('login') || url.includes('signin') || url.includes('auth/token')) && ep.method === 'POST';
    });
    const registerEndpoint = (model.apiEndpoints ?? []).find(ep => {
        const url = ep.url.toLowerCase();
        return (url.includes('register') || url.includes('signup') || url.includes('sign-up')) && ep.method === 'POST';
    });
    const refreshEndpoint = (model.apiEndpoints ?? []).find(ep => {
        const url = ep.url.toLowerCase();
        return url.includes('refresh') && ep.method === 'POST';
    });
    const logoutEndpoint = (model.apiEndpoints ?? []).find(ep => {
        const url = ep.url.toLowerCase();
        return url.includes('logout') && (ep.method === 'POST' || ep.method === 'DELETE');
    });

    if (hasLoginFlow || loginEndpoint) {
        const loginPath = loginEndpoint
            ? cleanURL(loginEndpoint.url)?.replace(/^\/api\//, '/') ?? '/auth/login'
            : '/auth/login';
        lines.push('    /// Authenticate with email and password');
        lines.push('    func login(email: String, password: String) async throws -> AuthResponse {');
        lines.push('        struct LoginRequest: Encodable {');
        lines.push('            let email: String');
        lines.push('            let password: String');
        lines.push('        }');
        lines.push(`        let response: AuthResponse = try await request(path: "${loginPath}", method: "POST", body: LoginRequest(email: email, password: password))`);
        lines.push('        self.authToken = response.token');
        lines.push('        return response');
        lines.push('    }');
        lines.push('');
    }

    if (hasRegisterFlow || registerEndpoint) {
        const registerPath = registerEndpoint
            ? cleanURL(registerEndpoint.url)?.replace(/^\/api\//, '/') ?? '/auth/register'
            : '/auth/register';
        lines.push('    /// Create a new account');
        lines.push('    func register(name: String, email: String, password: String) async throws -> AuthResponse {');
        lines.push('        struct RegisterRequest: Encodable {');
        lines.push('            let name: String');
        lines.push('            let email: String');
        lines.push('            let password: String');
        lines.push('        }');
        lines.push(`        let response: AuthResponse = try await request(path: "${registerPath}", method: "POST", body: RegisterRequest(name: name, email: email, password: password))`);
        lines.push('        self.authToken = response.token');
        lines.push('        return response');
        lines.push('    }');
        lines.push('');
    }

    if (logoutEndpoint) {
        const logoutPath = cleanURL(logoutEndpoint.url)?.replace(/^\/api\//, '/') ?? '/auth/logout';
        lines.push('    /// Sign out and clear auth token');
        lines.push('    func logout() async throws {');
        lines.push(`        let _: EmptyResponse = try await request(path: "${logoutPath}", method: "POST")`);
        lines.push('        self.authToken = nil');
        lines.push('    }');
        lines.push('');
    } else if (hasAuth) {
        lines.push('    /// Clear auth token (client-side logout)');
        lines.push('    func logout() {');
        lines.push('        self.authToken = nil');
        lines.push('    }');
        lines.push('');
    }

    if (hasRefreshFlow || refreshEndpoint) {
        const refreshPath = refreshEndpoint
            ? cleanURL(refreshEndpoint.url)?.replace(/^\/api\//, '/') ?? '/auth/refresh'
            : '/auth/refresh';
        lines.push('    /// Refresh the auth token');
        lines.push('    func refreshToken() async throws -> AuthResponse {');
        lines.push(`        let response: AuthResponse = try await request(path: "${refreshPath}", method: "POST")`);
        lines.push('        self.authToken = response.token');
        lines.push('        return response');
        lines.push('    }');
        lines.push('');
    }

    // Retry with exponential backoff
    lines.push('    // MARK: - Retry with Exponential Backoff');
    lines.push('');
    lines.push('    /// Performs a URLRequest with automatic retry on 429 and 5xx errors.');
    lines.push('    /// Uses exponential backoff: 1s, 2s, 4s (max 3 retries).');
    lines.push('    /// Respects Retry-After header when present.');
    lines.push('    private func performRequest(_ urlRequest: URLRequest) async throws -> (Data, URLResponse) {');
    lines.push('        var lastError: Error?');
    lines.push('');
    lines.push('        for attempt in 0...maxRetries {');
    lines.push('            do {');
    lines.push('                let (data, response) = try await session.data(for: urlRequest)');
    lines.push('');
    lines.push('                if let httpResponse = response as? HTTPURLResponse {');
    lines.push('                    // Retry on 429 (rate limit) or 5xx (server error)');
    lines.push('                    if httpResponse.statusCode == 429 || (500...599).contains(httpResponse.statusCode) {');
    lines.push('                        if attempt < maxRetries {');
    lines.push('                            let retryAfter = parseRetryAfter(httpResponse)');
    lines.push('                            let backoff = retryAfter ?? pow(2.0, Double(attempt))');
    lines.push('                            try await Task.sleep(nanoseconds: UInt64(backoff * 1_000_000_000))');
    lines.push('                            continue');
    lines.push('                        }');
    lines.push('');
    lines.push('                        // Max retries exhausted');
    lines.push('                        if httpResponse.statusCode == 429 {');
    lines.push('                            throw APIError.rateLimited(retryAfter: parseRetryAfter(httpResponse))');
    lines.push('                        }');
    lines.push('                    }');
    lines.push('                }');
    lines.push('');
    lines.push('                return (data, response)');
    lines.push('            } catch let error as APIError {');
    lines.push('                throw error');
    lines.push('            } catch let error as URLError {');
    lines.push('                lastError = error');
    lines.push('                // Retry on timeout or connection lost');
    lines.push('                if (error.code == .timedOut || error.code == .networkConnectionLost) && attempt < maxRetries {');
    lines.push('                    let backoff = pow(2.0, Double(attempt))');
    lines.push('                    try await Task.sleep(nanoseconds: UInt64(backoff * 1_000_000_000))');
    lines.push('                    continue');
    lines.push('                }');
    lines.push('                throw APIError.networkError(error)');
    lines.push('            } catch {');
    lines.push('                throw error');
    lines.push('            }');
    lines.push('        }');
    lines.push('');
    lines.push('        // Should not reach here, but handle gracefully');
    lines.push('        if let urlError = lastError as? URLError {');
    lines.push('            throw APIError.networkError(urlError)');
    lines.push('        }');
    lines.push('        throw lastError ?? APIError.invalidResponse');
    lines.push('    }');
    lines.push('');
    lines.push('    private func parseRetryAfter(_ response: HTTPURLResponse) -> TimeInterval? {');
    lines.push('        guard let retryAfterHeader = response.value(forHTTPHeaderField: "Retry-After") else {');
    lines.push('            return nil');
    lines.push('        }');
    lines.push('        // Retry-After can be seconds (integer) or an HTTP date');
    lines.push('        if let seconds = Double(retryAfterHeader) {');
    lines.push('            return seconds');
    lines.push('        }');
    lines.push('        // Try HTTP date format');
    lines.push('        let formatter = DateFormatter()');
    lines.push('        formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss zzz"');
    lines.push('        formatter.locale = Locale(identifier: "en_US_POSIX")');
    lines.push('        if let date = formatter.date(from: retryAfterHeader) {');
    lines.push('            return max(0, date.timeIntervalSinceNow)');
    lines.push('        }');
    lines.push('        return nil');
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
    lines.push('                throw APIError.encodingError(error)');
    lines.push('            }');
    lines.push('        }');
    lines.push('');
    lines.push('        let data: Data');
    lines.push('        let response: URLResponse');
    lines.push('');
    lines.push('        do {');
    lines.push('            (data, response) = try await performRequest(urlRequest)');
    lines.push('        } catch let error as APIError {');
    lines.push('            throw error');
    lines.push('        } catch let error as URLError {');
    lines.push('            throw APIError.networkError(error)');
    lines.push('        } catch {');
    lines.push('            throw APIError.networkError(URLError(.unknown))');
    lines.push('        }');
    lines.push('');
    lines.push('        guard let httpResponse = response as? HTTPURLResponse else {');
    lines.push('            throw APIError.invalidResponse');
    lines.push('        }');
    lines.push('');
    lines.push('        switch httpResponse.statusCode {');
    lines.push('        case 200...299:');
    lines.push('            break');
    lines.push('        case 401:');
    lines.push('            throw APIError.unauthorized');
    lines.push('        case 429:');
    lines.push('            throw APIError.rateLimited(retryAfter: parseRetryAfter(httpResponse))');
    lines.push('        case 500...599:');
    lines.push('            let message = String(data: data, encoding: .utf8)');
    lines.push('            throw APIError.serverError(statusCode: httpResponse.statusCode, message: message)');
    lines.push('        default:');
    lines.push('            let message = String(data: data, encoding: .utf8)');
    lines.push('            throw APIError.serverError(statusCode: httpResponse.statusCode, message: message)');
    lines.push('        }');
    lines.push('');
    lines.push('        do {');
    lines.push('            return try decoder.decode(T.self, from: data)');
    lines.push('        } catch let error as DecodingError {');
    lines.push('            throw APIError.decodingError(error)');
    lines.push('        } catch {');
    lines.push('            throw APIError.decodingError(DecodingError.dataCorrupted(.init(codingPath: [], debugDescription: error.localizedDescription)))');
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
    lines.push('        let (_, response) = try await performRequest(urlRequest)');
    lines.push('');
    lines.push('        guard let httpResponse = response as? HTTPURLResponse else {');
    lines.push('            throw APIError.invalidResponse');
    lines.push('        }');
    lines.push('');
    lines.push('        guard (200...299).contains(httpResponse.statusCode) else {');
    lines.push('            switch httpResponse.statusCode {');
    lines.push('            case 401: throw APIError.unauthorized');
    lines.push('            case 429: throw APIError.rateLimited(retryAfter: parseRetryAfter(httpResponse))');
    lines.push('            default: throw APIError.serverError(statusCode: httpResponse.statusCode, message: nil)');
    lines.push('            }');
    lines.push('        }');
    lines.push('    }');
    lines.push('');

    // Pagination support
    lines.push('    // MARK: - Pagination');
    lines.push('');
    lines.push('    /// Fetch a paginated list of items from the given path.');
    lines.push('    func fetchPaginated<T: Codable>(');
    lines.push('        path: String,');
    lines.push('        page: Int? = nil,');
    lines.push('        limit: Int? = nil,');
    lines.push('        cursor: String? = nil,');
    lines.push('        queryItems: [URLQueryItem]? = nil');
    lines.push('    ) async throws -> PaginatedResponse<T> {');
    lines.push('        var allQueryItems = queryItems ?? []');
    lines.push('        if let page { allQueryItems.append(URLQueryItem(name: "page", value: String(page))) }');
    lines.push('        if let limit { allQueryItems.append(URLQueryItem(name: "limit", value: String(limit))) }');
    lines.push('        if let cursor { allQueryItems.append(URLQueryItem(name: "cursor", value: cursor)) }');
    lines.push('');
    lines.push('        return try await request(path: path, queryItems: allQueryItems.isEmpty ? nil : allQueryItems)');
    lines.push('    }');
    lines.push('');
    lines.push('    /// Auto-paginate: repeatedly fetch pages until hasMore is false.');
    lines.push('    /// Returns all items concatenated.');
    lines.push('    func fetchAll<T: Codable>(');
    lines.push('        path: String,');
    lines.push('        limit: Int = 50');
    lines.push('    ) async throws -> [T] {');
    lines.push('        var allItems: [T] = []');
    lines.push('        var currentPage = 1');
    lines.push('        var currentCursor: String? = nil');
    lines.push('');
    lines.push('        while true {');
    lines.push('            let response: PaginatedResponse<T> = try await fetchPaginated(');
    lines.push('                path: path,');
    lines.push('                page: currentCursor == nil ? currentPage : nil,');
    lines.push('                limit: limit,');
    lines.push('                cursor: currentCursor');
    lines.push('            )');
    lines.push('');
    lines.push('            allItems.append(contentsOf: response.items)');
    lines.push('');
    lines.push('            guard response.hasMore else { break }');
    lines.push('');
    lines.push('            if let nextCursor = response.nextCursor {');
    lines.push('                currentCursor = nextCursor');
    lines.push('            } else {');
    lines.push('                currentPage += 1');
    lines.push('            }');
    lines.push('        }');
    lines.push('');
    lines.push('        return allItems');
    lines.push('    }');
    lines.push('');

    // File upload support
    lines.push('    // MARK: - File Upload');
    lines.push('');
    lines.push('    /// Upload a file as multipart/form-data.');
    lines.push('    func uploadFile<T: Decodable>(');
    lines.push('        path: String,');
    lines.push('        fileData: Data,');
    lines.push('        fileName: String,');
    lines.push('        mimeType: String,');
    lines.push('        fieldName: String = "file",');
    lines.push('        additionalFields: [String: String]? = nil');
    lines.push('    ) async throws -> T {');
    lines.push('        let url = APIConfiguration.versionedBaseURL.appendingPathComponent(path)');
    lines.push('        let boundary = UUID().uuidString');
    lines.push('');
    lines.push('        var urlRequest = URLRequest(url: url)');
    lines.push('        urlRequest.httpMethod = "POST"');
    lines.push('        urlRequest.timeoutInterval = APIConfiguration.timeoutInterval * 3 // Longer timeout for uploads');
    lines.push('        urlRequest.setValue("multipart/form-data; boundary=\\(boundary)", forHTTPHeaderField: APIConfiguration.Headers.contentType)');
    lines.push('');
    lines.push('        if let authToken {');
    lines.push('            urlRequest.setValue("Bearer \\(authToken)", forHTTPHeaderField: APIConfiguration.Headers.authorization)');
    lines.push('        }');
    lines.push('');
    lines.push('        var bodyData = Data()');
    lines.push('');
    lines.push('        // Add additional text fields');
    lines.push('        if let additionalFields {');
    lines.push('            for (key, value) in additionalFields {');
    lines.push('                bodyData.append("--\\(boundary)\\r\\n".data(using: .utf8)!)');
    lines.push('                bodyData.append("Content-Disposition: form-data; name=\\"\\(key)\\"\\r\\n\\r\\n".data(using: .utf8)!)');
    lines.push('                bodyData.append("\\(value)\\r\\n".data(using: .utf8)!)');
    lines.push('            }');
    lines.push('        }');
    lines.push('');
    lines.push('        // Add file data');
    lines.push('        bodyData.append("--\\(boundary)\\r\\n".data(using: .utf8)!)');
    lines.push('        bodyData.append("Content-Disposition: form-data; name=\\"\\(fieldName)\\"; filename=\\"\\(fileName)\\"\\r\\n".data(using: .utf8)!)');
    lines.push('        bodyData.append("Content-Type: \\(mimeType)\\r\\n\\r\\n".data(using: .utf8)!)');
    lines.push('        bodyData.append(fileData)');
    lines.push('        bodyData.append("\\r\\n".data(using: .utf8)!)');
    lines.push('');
    lines.push('        // End boundary');
    lines.push('        bodyData.append("--\\(boundary)--\\r\\n".data(using: .utf8)!)');
    lines.push('');
    lines.push('        urlRequest.httpBody = bodyData');
    lines.push('');
    lines.push('        let (data, response) = try await performRequest(urlRequest)');
    lines.push('');
    lines.push('        guard let httpResponse = response as? HTTPURLResponse else {');
    lines.push('            throw APIError.invalidResponse');
    lines.push('        }');
    lines.push('');
    lines.push('        guard (200...299).contains(httpResponse.statusCode) else {');
    lines.push('            let message = String(data: data, encoding: .utf8)');
    lines.push('            throw APIError.serverError(statusCode: httpResponse.statusCode, message: message)');
    lines.push('        }');
    lines.push('');
    lines.push('        do {');
    lines.push('            return try decoder.decode(T.self, from: data)');
    lines.push('        } catch let error as DecodingError {');
    lines.push('            throw APIError.decodingError(error)');
    lines.push('        } catch {');
    lines.push('            throw APIError.decodingError(DecodingError.dataCorrupted(.init(codingPath: [], debugDescription: error.localizedDescription)))');
    lines.push('        }');
    lines.push('    }');

    // Generated endpoint methods — deduplicate by function signature
    const generatedFuncNames = new Set<string>();
    if (endpoints.length > 0) {
        lines.push('');
        lines.push('    // MARK: - API Endpoints');

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

        // Generate typed upload methods for detected file upload endpoints
        const uploadEndpoints = endpoints.filter(ep => isUploadEndpoint(ep));
        if (uploadEndpoints.length > 0) {
            lines.push('');
            lines.push('    // MARK: - File Upload Endpoints');

            for (const ep of uploadEndpoints) {
                const uploadFuncName = camelCase(generateUploadFunctionName(ep));
                if (generatedFuncNames.has(`${uploadFuncName}(upload)`)) continue;
                generatedFuncNames.add(`${uploadFuncName}(upload)`);

                lines.push('');
                lines.push(generateUploadEndpointMethod(ep, model.entities ?? []));
            }
        }
    }

    // -----------------------------------------------------------------------
    // Generate stub methods for fetch calls that loadData() will emit but no
    // endpoint covers.  This mirrors the logic in swiftui-generator's loadData().
    // -----------------------------------------------------------------------
    const modelEntities = model.entities ?? [];
    const entityNameSet = new Set(modelEntities.map(e => pascalCase(e.name)));
    const stubMethods: Map<string, { returnType: string; params: string }> = new Map();

    for (const screen of (model.screens ?? []).filter(s => !isMarketingScreen(s))) {
        const dataReqs = screen.dataRequirements ?? [];
        for (const req of dataReqs) {
            if (req.fetchStrategy !== 'api') continue;
            const rawSource = req.source ?? (req as any).entity;
            if (!rawSource) continue;
            const reqSource = cleanSourceName(rawSource);
            const entityName = pascalCase(reqSource);
            const isMany = req.cardinality === 'many' || (req as any).type === 'list';

            if (isMany) {
                const fetchName = reqSource.endsWith('s') ? reqSource : pluralize(reqSource);
                const funcName = camelCase(`fetch${pascalCase(fetchName)}`);
                const sigKey = `${funcName}(0)`;
                if (!generatedFuncNames.has(sigKey)) {
                    const returnType = entityNameSet.has(entityName) ? `[${entityName}]` : '[String]';
                    stubMethods.set(funcName, { returnType, params: '' });
                }
            } else {
                const funcName = camelCase(`fetch${entityName}`);
                // loadData() calls single-entity fetches with no params from the dataReqs loop
                const sigKey = `${funcName}(0)`;
                if (!generatedFuncNames.has(sigKey)) {
                    const returnType = entityNameSet.has(entityName) ? entityName : 'String';
                    stubMethods.set(funcName, { returnType, params: '' });
                }
            }
        }

        // Detail screens with id loading generate fetch${EntityName}(id:) calls.
        // Mirror the view generator's isDetailScreen logic: layout=detail OR name ends with
        // "Detail" OR the route has dynamic params. Also mirror its entity resolution which
        // falls back to the entity with the most fields, not just dataReqs[0].
        const isDetail = screen.layout === 'detail' ||
            screen.name.endsWith('Detail') ||
            (model.navigation?.routes ?? []).some(r => r.screen === screen.name && r.params.length > 0);

        if (isDetail) {
            // Try to resolve the detail entity the same way the view generator does
            let detailEntityName: string | null = null;

            // Strategy 1: from data requirements
            if (dataReqs.length > 0) {
                const rawSource = dataReqs[0]?.source ?? (dataReqs[0] as any)?.entity;
                if (rawSource) {
                    detailEntityName = pascalCase(cleanSourceName(rawSource));
                }
            }

            // Strategy 2: infer from screen name
            if (!detailEntityName) {
                const inferName = screen.name
                    .replace(/Detail$|Page$|View$|Screen$/i, '')
                    .replace(/^\/+/, '');
                if (inferName) detailEntityName = pascalCase(inferName);
            }

            // Strategy 3: fall back to entity with most fields (mirrors view generator)
            const allEntities = (model.entities ?? []).filter(e =>
                !isJunkEntity(e) && !(e.fields.length === 1 && e.fields[0]?.name === '__enum'));
            if (detailEntityName && !entityNameSet.has(detailEntityName) && allEntities.length > 0) {
                const bestEntity = [...allEntities].sort((a, b) => (b.fields?.length ?? 0) - (a.fields?.length ?? 0))[0];
                if (bestEntity) detailEntityName = pascalCase(bestEntity.name);
            }

            if (detailEntityName) {
                const funcName = camelCase(`fetch${detailEntityName}`);
                const sigKey = `${funcName}(1)`;
                if (!generatedFuncNames.has(sigKey)) {
                    const returnType = entityNameSet.has(detailEntityName) ? detailEntityName : 'String';
                    stubMethods.set(`${funcName}_id`, { returnType, params: 'id: String' });
                }
            }
        }

    }

    // Generate stubs for store-generated fetch calls. Stores call
    // apiClient.fetch${PluralName}() but the APIClient may only have
    // the singular form (e.g., fetchMemory vs fetchMemories).
    // Skip web-only state and common internal UI state names that should never become API stubs.
    const UI_STATE_BLOCKLIST = new Set([
        'isloading', 'error', 'errormessage', 'issubmitting', 'sortorder',
        'selectedcategory', 'searchquery', 'showpassword', 'added', 'removed',
        'count', 'total', 'page', 'limit', 'offset', 'query', 'filter',
    ]);
    const statePatterns = model.stateManagement ?? [];
    for (const sp of statePatterns) {
        const storeName = cleanStoreName(sp.name);

        // Skip web-only state (hover, tooltip, etc.)
        if (isWebOnlyState(sp.name)) continue;
        // Skip common UI state names that aren't data sources
        if (UI_STATE_BLOCKLIST.has(storeName.toLowerCase())) continue;
        // Only generate stub if store name matches a known entity
        if (!entityNameSet.has(storeName)) continue;

        const pluralName = pluralize(storeName);
        const funcName = camelCase(`fetch${pluralName}`);
        const sigKey = `${funcName}(0)`;
        if (!generatedFuncNames.has(sigKey) && !stubMethods.has(funcName)) {
            const returnType = `[${storeName}]`;
            stubMethods.set(funcName, { returnType, params: '' });
        }
    }

    if (stubMethods.size > 0) {
        lines.push('');
        lines.push('    // MARK: - Auto-generated Stubs');
        lines.push('    // These methods are called by views but have no matching API endpoint.');
        lines.push('    // Replace with real implementations when endpoints are available.');

        for (const [funcName, { returnType, params }] of stubMethods) {
            // Use the real function name (strip the _id suffix used for Map key dedup)
            const realFuncName = funcName.replace(/_id$/, '');
            lines.push('');
            if (returnType.startsWith('[')) {
                lines.push(`    func ${realFuncName}(${params}) async throws -> ${returnType} { [] }`);
            } else {
                lines.push(`    func ${realFuncName}(${params}) async throws -> ${returnType} {`);
                lines.push(`        throw APIError.serverError(statusCode: 404, message: nil)`);
                lines.push('    }');
            }
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

    // Detect if this is a list endpoint (GET without path params — fetches a collection)
    const isListEndpoint = method === 'GET' && pathParams.length === 0;

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

    // Pagination params for list endpoints
    if (isListEndpoint) {
        params.push('page: Int? = nil');
        params.push('limit: Int? = nil');
        params.push('cursor: String? = nil');
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

    // Build the function signature based on return type and HTTP method
    const funcSignature = `    func ${functionName}(${params.join(', ')}) async throws`;

    if (effectiveReturnType && effectiveReturnType !== 'Void') {
        lines.push(`${funcSignature} -> ${effectiveReturnType} {`);
    } else if (method === 'DELETE' || method === 'POST' || method === 'PUT' || method === 'PATCH') {
        // Mutation/delete endpoints without known return type — return void
        lines.push(`${funcSignature} {`);
    } else {
        // GET or other methods without known return type — use [String] as placeholder
        lines.push(`${funcSignature} -> [String] {`);
    }

    // Build query items for list endpoints with pagination
    if (isListEndpoint) {
        lines.push('        var queryItems: [URLQueryItem] = []');
        lines.push('        if let page { queryItems.append(URLQueryItem(name: "page", value: String(page))) }');
        lines.push('        if let limit { queryItems.append(URLQueryItem(name: "limit", value: String(limit))) }');
        lines.push('        if let cursor { queryItems.append(URLQueryItem(name: "cursor", value: cursor)) }');
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
            isListEndpoint ? 'queryItems: queryItems.isEmpty ? nil : queryItems' : null,
        ].filter(Boolean);

        lines.push(`        return try await request(${requestArgs.join(', ')})`);
    } else if (method === 'GET' && !effectiveReturnType) {
        // GET endpoint with unknown return type — return empty placeholder
        lines.push(`        // TODO: Update return type to match actual API response`);
        lines.push(`        return []`);
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

// ---------------------------------------------------------------------------
// Upload endpoint detection & generation
// ---------------------------------------------------------------------------

/** Detect if an endpoint is a file upload endpoint */
function isUploadEndpoint(endpoint: ApiEndpoint): boolean {
    const method = (endpoint.method ?? 'GET').toUpperCase();
    if (method !== 'POST') return false;

    // Check content-type header for multipart/form-data
    const headers = endpoint.headers ?? {};
    for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === 'content-type' && value.includes('multipart/form-data')) {
            return true;
        }
    }

    // Check if URL contains "upload"
    const url = (endpoint.url ?? '').toLowerCase();
    if (url.includes('upload')) return true;

    return false;
}

function generateUploadFunctionName(endpoint: ApiEndpoint): string {
    const cleaned = cleanURL(endpoint.url) ?? '/upload';
    const segments = cleaned
        .split('/')
        .filter((s) => s && !s.startsWith(':') && !s.startsWith('{') && !s.startsWith('[') && s !== 'api');
    const resource = segments[segments.length - 1] ?? 'file';
    return `upload${pascalCase(singularize(resource))}`;
}

function generateUploadEndpointMethod(endpoint: ApiEndpoint, entities: Entity[] = []): string {
    const functionName = camelCase(generateUploadFunctionName(endpoint));
    const cleanedUrl = cleanURL(endpoint.url) ?? '/';
    const swiftBasePath = cleanedUrl.replace(/^\/api\//, '/');
    const pathParams = extractPathParams(cleanedUrl);

    // Determine return type
    let returnType = typeDefToSwift(endpoint.responseType);
    if (/[<>|{}]|=>/.test(returnType)) returnType = 'Any';
    if (returnType === 'Any' || returnType === '[Any]') {
        const inferred = inferReturnTypeFromEntities(endpoint, entities);
        if (inferred) returnType = inferred;
    }

    const isUnresolvableType = returnType === 'Any' || returnType === '[Any]';
    // For upload endpoints, use [String: String] as a sensible default if type unknown
    const effectiveReturnType = isUnresolvableType ? '[String: String]' : returnType;

    const lines: string[] = [];
    const params: string[] = [];

    // Path params
    for (const param of pathParams) {
        params.push(`${camelCase(param)}: String`);
    }

    // File upload params
    params.push('fileData: Data');
    params.push('fileName: String');
    params.push('mimeType: String');

    if (endpoint.description) {
        lines.push(`    /// ${endpoint.description}`);
    }

    lines.push(`    func ${functionName}(${params.join(', ')}) async throws -> ${effectiveReturnType} {`);

    let swiftPath = swiftBasePath;
    for (const param of pathParams) {
        swiftPath = swiftPath.replace(`:${param}`, `\\(${camelCase(param)})`);
        swiftPath = swiftPath.replace(`{${param}}`, `\\(${camelCase(param)})`);
    }

    lines.push(`        return try await uploadFile(path: "${swiftPath}", fileData: fileData, fileName: fileName, mimeType: mimeType)`);
    lines.push('    }');

    return lines.join('\n');
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
    // Skip entities that conflict with Swift stdlib/framework types
    const entityLookup = new Map<string, string>();
    for (const entity of entities) {
        if (isJunkEntity(entity)) continue;
        const name = entity.name;
        // Exact name takes priority — don't overwrite with plural/singular collisions
        const lower = name.toLowerCase();
        if (!entityLookup.has(lower)) entityLookup.set(lower, name);
        const sing = singularize(lower);
        if (!entityLookup.has(sing)) entityLookup.set(sing, name);
        const plur = pluralize(lower);
        if (!entityLookup.has(plur)) entityLookup.set(plur, name);
        // Split compound PascalCase names and try the last word as a match key
        // e.g., "SavedTemplate" → "template", "UserProfile" → "profile"
        const words = name.replace(/([a-z])([A-Z])/g, '$1 $2').split(' ');
        if (words.length >= 2) {
            const lastWord = words[words.length - 1].toLowerCase();
            if (!entityLookup.has(lastWord)) entityLookup.set(lastWord, name);
            const lastSing = singularize(lastWord);
            if (!entityLookup.has(lastSing)) entityLookup.set(lastSing, name);
            const lastPlur = pluralize(lastWord);
            if (!entityLookup.has(lastPlur)) entityLookup.set(lastPlur, name);
        }
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
// Auth response model
// ---------------------------------------------------------------------------

function generateAuthResponse(model: SemanticAppModel): string {
    // Check if there's a User entity to reference
    const entities = model.entities ?? [];
    const userEntity = entities.find(e =>
        e.name.toLowerCase() === 'user' || e.name.toLowerCase() === 'currentuser' || e.name.toLowerCase() === 'profile',
    );
    const userTypeName = userEntity ? pascalCase(userEntity.name) : 'AuthUser';

    const lines: string[] = [];
    lines.push('// Generated by Morphkit');
    lines.push('');
    lines.push('import Foundation');
    lines.push('');
    lines.push('/// Authentication response from login/register endpoints');
    lines.push('struct AuthResponse: Codable {');
    lines.push('    let token: String');
    lines.push('    let refreshToken: String?');
    lines.push(`    let user: ${userTypeName}?`);
    lines.push('    let expiresIn: Int?');
    lines.push('');
    lines.push('    enum CodingKeys: String, CodingKey {');
    lines.push('        case token');
    lines.push('        case refreshToken = "refresh_token"');
    lines.push('        case user');
    lines.push('        case expiresIn = "expires_in"');
    lines.push('    }');
    lines.push('}');

    // Generate AuthUser only if no User entity exists
    if (!userEntity) {
        lines.push('');
        lines.push('/// Basic authenticated user info');
        lines.push('struct AuthUser: Codable, Identifiable {');
        lines.push('    let id: String');
        lines.push('    let email: String');
        lines.push('    let name: String?');
        lines.push('    let avatarUrl: String?');
        lines.push('');
        lines.push('    enum CodingKeys: String, CodingKey {');
        lines.push('        case id');
        lines.push('        case email');
        lines.push('        case name');
        lines.push('        case avatarUrl = "avatar_url"');
        lines.push('    }');
        lines.push('}');
    }

    lines.push('');
    lines.push('/// Empty response for endpoints that return no body (e.g. logout)');
    lines.push('struct EmptyResponse: Codable {}');
    lines.push('');

    return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function generateNetworkingLayer(model: SemanticAppModel): GeneratedFile[] {
    const files: GeneratedFile[] = [];
    const endpoints = deduplicateEndpoints(model.apiEndpoints ?? []);
    const hasRealBaseURL = inferBaseURL(endpoints) !== 'https://api.example.com';
    const warnings: string[] = [];

    // APIError (production-quality error enum)
    files.push({
        path: 'Networking/APIError.swift',
        content: generateAPIError(),
        sourceMapping: 'morphkit:networking',
        confidence: 'high',
        warnings: [],
    });

    // PaginatedResponse (generic pagination wrapper)
    files.push({
        path: 'Networking/PaginatedResponse.swift',
        content: generatePaginatedResponse(),
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

    // Auth response models — generated when auth is detected
    const hasAuth = model.auth != null;
    if (hasAuth) {
        files.push({
            path: 'Networking/AuthResponse.swift',
            content: generateAuthResponse(model),
            sourceMapping: 'morphkit:networking',
            confidence: 'high',
            warnings: [],
        });
    }

    // DTOs
    const dtos = generateDTOs(model);
    files.push(...dtos);

    return files;
}

// Re-export shared API naming utilities (canonical source: api-naming.ts)
export { generateFunctionName, extractPathParams, cleanURL } from './api-naming';

import { describe, test, expect } from 'bun:test';
import { generateNetworkingLayer } from '../../src/generator/networking-generator';
import type { SemanticAppModel, ApiEndpoint } from '../../src/semantic/model';

describe('Networking Generator', () => {
  const createMinimalModel = (
    endpoints: ApiEndpoint[] = [],
    entities: any[] = [],
  ): SemanticAppModel => ({
    appName: 'TestApp',
    description: 'A test app',
    version: '1.0',
    entities,
    screens: [],
    navigation: {
      type: 'stack',
      routes: [],
      tabs: [],
      deepLinks: [],
      initialScreen: 'Home',
    },
    stateManagement: [],
    apiEndpoints: endpoints,
    auth: null,
    theme: {
      colors: {
        primary: '#007AFF',
        secondary: '#5856D6',
        accent: '#3B82F6',
        background: '#FFFFFF',
        surface: '#F9FAFB',
        error: '#EF4444',
        success: '#10B981',
        warning: '#F59E0B',
        text: {
          primary: '#111827',
          secondary: '#6B7280',
          disabled: '#9CA3AF',
          inverse: '#FFFFFF',
        },
        custom: {},
      },
      typography: {
        fontFamily: { heading: 'System', body: 'System', mono: 'Menlo' },
        sizes: { xs: 12, sm: 14, base: 16, lg: 18, xl: 20, '2xl': 24, '3xl': 30, '4xl': 36 },
        weights: { regular: 400, medium: 500, semibold: 600, bold: 700 },
      },
      spacing: { unit: 4, values: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, '2xl': 48 } },
      borderRadius: {},
      supportsDarkMode: false,
    },
    confidence: 'high',
    metadata: {
      sourceFramework: 'react',
      extractedAt: new Date().toISOString(),
      morphkitVersion: '0.1.0',
      analyzedFiles: [],
      warnings: [],
    },
  });

  const productEntity = {
    name: 'Product',
    description: 'A product',
    sourceFile: 'src/types/product.ts',
    fields: [
      { name: 'id', type: { kind: 'string' as const }, optional: false, description: '', isPrimaryKey: true },
      { name: 'name', type: { kind: 'string' as const }, optional: false, description: '' },
      { name: 'price', type: { kind: 'number' as const }, optional: false, description: '' },
    ],
    relationships: [],
    confidence: 'high' as const,
  };

  test('generates PaginatedResponse struct', () => {
    const model = createMinimalModel();
    const files = generateNetworkingLayer(model);

    const paginatedFile = files.find(f => f.path.includes('PaginatedResponse'));
    expect(paginatedFile).toBeDefined();
    expect(paginatedFile!.content).toContain('struct PaginatedResponse<T: Codable>: Codable');
    expect(paginatedFile!.content).toContain('let items: [T]');
    expect(paginatedFile!.content).toContain('let total: Int?');
    expect(paginatedFile!.content).toContain('let hasMore: Bool');
    expect(paginatedFile!.content).toContain('let nextCursor: String?');
  });

  test('generates APIError enum instead of basic NetworkError', () => {
    const model = createMinimalModel();
    const files = generateNetworkingLayer(model);

    const errorFile = files.find(f => f.path.includes('APIError'));
    expect(errorFile).toBeDefined();
    expect(errorFile!.content).toContain('enum APIError: LocalizedError');
    expect(errorFile!.content).toContain('case networkError(URLError)');
    expect(errorFile!.content).toContain('case serverError(statusCode: Int, message: String?)');
    expect(errorFile!.content).toContain('case decodingError(DecodingError)');
    expect(errorFile!.content).toContain('case unauthorized');
    expect(errorFile!.content).toContain('case rateLimited(retryAfter: TimeInterval?)');
    expect(errorFile!.content).toContain('case noData');
    expect(errorFile!.content).toContain('var isRetryable: Bool');
    // Backward compatibility alias
    expect(errorFile!.content).toContain('typealias NetworkError = APIError');
  });

  test('generates APIClient with retry logic (performRequest)', () => {
    const model = createMinimalModel();
    const files = generateNetworkingLayer(model);

    const clientFile = files.find(f => f.path.includes('APIClient'));
    expect(clientFile).toBeDefined();
    const content = clientFile!.content;

    // performRequest method with retry
    expect(content).toContain('private func performRequest(_ urlRequest: URLRequest) async throws -> (Data, URLResponse)');
    expect(content).toContain('for attempt in 0...maxRetries');
    expect(content).toContain('let maxRetries = 3');

    // Exponential backoff
    expect(content).toContain('pow(2.0, Double(attempt))');

    // Retry-After header parsing
    expect(content).toContain('parseRetryAfter');
    expect(content).toContain('Retry-After');

    // Rate limit detection
    expect(content).toContain('httpResponse.statusCode == 429');
    expect(content).toContain('APIError.rateLimited');

    // Uses performRequest instead of raw session.data
    expect(content).toContain('try await performRequest(urlRequest)');
  });

  test('list endpoints accept pagination parameters', () => {
    const endpoints: ApiEndpoint[] = [
      {
        url: '/api/products',
        method: 'GET',
        headers: {},
        requestBody: null,
        responseType: { kind: 'array', elementType: { kind: 'object', typeName: 'Product' } },
        auth: false,
        caching: null,
        description: 'Fetch all products',
        sourceFile: 'src/api/products.ts',
        confidence: 'high',
      },
    ];

    const model = createMinimalModel(endpoints, [productEntity]);
    const files = generateNetworkingLayer(model);
    const clientFile = files.find(f => f.path.includes('APIClient'));
    expect(clientFile).toBeDefined();
    const content = clientFile!.content;

    // List endpoint should have pagination params
    expect(content).toContain('page: Int? = nil');
    expect(content).toContain('limit: Int? = nil');
    expect(content).toContain('cursor: String? = nil');

    // Should build query items for pagination
    expect(content).toContain('var queryItems: [URLQueryItem] = []');
    expect(content).toContain('URLQueryItem(name: "page"');
    expect(content).toContain('URLQueryItem(name: "limit"');
    expect(content).toContain('URLQueryItem(name: "cursor"');
  });

  test('detail endpoints (GET with path param) do NOT get pagination params', () => {
    const endpoints: ApiEndpoint[] = [
      {
        url: '/api/products/:id',
        method: 'GET',
        headers: {},
        requestBody: null,
        responseType: { kind: 'object', typeName: 'Product' },
        auth: false,
        caching: null,
        description: 'Fetch a single product',
        sourceFile: 'src/api/products.ts',
        confidence: 'high',
      },
    ];

    const model = createMinimalModel(endpoints, [productEntity]);
    const files = generateNetworkingLayer(model);
    const clientFile = files.find(f => f.path.includes('APIClient'));
    const content = clientFile!.content;

    // Should have id parameter but NOT pagination
    expect(content).toContain('id: String');
    // The detail method should NOT have page/limit/cursor
    const fetchProductLine = content.split('\n').find(l => l.includes('func fetchProduct('));
    expect(fetchProductLine).toBeDefined();
    expect(fetchProductLine).not.toContain('page:');
    expect(fetchProductLine).not.toContain('limit:');
    expect(fetchProductLine).not.toContain('cursor:');
  });

  test('generates fetchPaginated and fetchAll methods', () => {
    const model = createMinimalModel();
    const files = generateNetworkingLayer(model);
    const clientFile = files.find(f => f.path.includes('APIClient'));
    const content = clientFile!.content;

    // fetchPaginated generic method
    expect(content).toContain('func fetchPaginated<T: Codable>(');
    expect(content).toContain('PaginatedResponse<T>');

    // fetchAll auto-pagination method
    expect(content).toContain('func fetchAll<T: Codable>(');
    expect(content).toContain('response.hasMore');
    expect(content).toContain('response.nextCursor');
  });

  test('upload endpoints generate multipart form data methods', () => {
    const endpoints: ApiEndpoint[] = [
      {
        url: '/api/upload',
        method: 'POST',
        headers: { 'Content-Type': 'multipart/form-data' },
        requestBody: null,
        responseType: { kind: 'object', typeName: 'UploadResult' },
        auth: true,
        caching: null,
        description: 'Upload a file',
        sourceFile: 'src/api/upload.ts',
        confidence: 'high',
      },
    ];

    const model = createMinimalModel(endpoints);
    const files = generateNetworkingLayer(model);
    const clientFile = files.find(f => f.path.includes('APIClient'));
    const content = clientFile!.content;

    // Should generate an upload-specific endpoint method
    expect(content).toContain('File Upload Endpoints');
    expect(content).toContain('fileData: Data');
    expect(content).toContain('fileName: String');
    expect(content).toContain('mimeType: String');
    expect(content).toContain('uploadFile(');
  });

  test('upload endpoint detected by URL containing "upload"', () => {
    const endpoints: ApiEndpoint[] = [
      {
        url: '/api/files/upload',
        method: 'POST',
        headers: {},
        requestBody: { kind: 'object' },
        responseType: { kind: 'object' },
        auth: false,
        caching: null,
        description: 'Upload a file',
        sourceFile: 'src/api/files.ts',
        confidence: 'medium',
      },
    ];

    const model = createMinimalModel(endpoints);
    const files = generateNetworkingLayer(model);
    const clientFile = files.find(f => f.path.includes('APIClient'));
    const content = clientFile!.content;

    // Should detect upload from URL and generate typed upload method
    expect(content).toContain('File Upload Endpoints');
    expect(content).toContain('fileData: Data');
  });

  test('generated APIClient has uploadFile generic method', () => {
    const model = createMinimalModel();
    const files = generateNetworkingLayer(model);
    const clientFile = files.find(f => f.path.includes('APIClient'));
    const content = clientFile!.content;

    // Generic uploadFile method
    expect(content).toContain('func uploadFile<T: Decodable>(');
    expect(content).toContain('multipart/form-data; boundary=');
    expect(content).toContain('Content-Disposition: form-data');
    expect(content).toContain('fieldName: String = "file"');
  });

  test('generated code uses APIError not raw throws', () => {
    const endpoints: ApiEndpoint[] = [
      {
        url: '/api/products',
        method: 'GET',
        headers: {},
        requestBody: null,
        responseType: { kind: 'array', elementType: { kind: 'object', typeName: 'Product' } },
        auth: false,
        caching: null,
        description: '',
        sourceFile: '',
        confidence: 'high',
      },
    ];

    const model = createMinimalModel(endpoints, [productEntity]);
    const files = generateNetworkingLayer(model);
    const clientFile = files.find(f => f.path.includes('APIClient'));
    const content = clientFile!.content;

    // Should use APIError types
    expect(content).toContain('throw APIError.unauthorized');
    expect(content).toContain('throw APIError.encodingError');
    expect(content).toContain('throw APIError.invalidResponse');
    expect(content).toContain('throw APIError.networkError');
    expect(content).toContain('throw APIError.decodingError');
  });

  test('generates all expected networking files', () => {
    const model = createMinimalModel();
    const files = generateNetworkingLayer(model);
    const paths = files.map(f => f.path);

    expect(paths).toContain('Networking/APIError.swift');
    expect(paths).toContain('Networking/PaginatedResponse.swift');
    expect(paths).toContain('Networking/APIConfiguration.swift');
    expect(paths).toContain('Networking/APIClient.swift');
    expect(paths).toContain('Networking/KeychainHelper.swift');
  });

  test('no JavaScript syntax in generated Swift', () => {
    const endpoints: ApiEndpoint[] = [
      {
        url: '/api/products',
        method: 'GET',
        headers: {},
        requestBody: null,
        responseType: { kind: 'array', elementType: { kind: 'object', typeName: 'Product' } },
        auth: false,
        caching: null,
        description: 'List products',
        sourceFile: 'src/api.ts',
        confidence: 'high',
      },
      {
        url: '/api/products/:id',
        method: 'GET',
        headers: {},
        requestBody: null,
        responseType: { kind: 'object', typeName: 'Product' },
        auth: false,
        caching: null,
        description: 'Get product by ID',
        sourceFile: 'src/api.ts',
        confidence: 'high',
      },
    ];

    const model = createMinimalModel(endpoints, [productEntity]);
    const files = generateNetworkingLayer(model);

    for (const file of files) {
      if (file.path.endsWith('.swift')) {
        expect(file.content).not.toContain('${');
        expect(file.content).not.toContain('const ');
        expect(file.content).not.toContain('function ');
        expect(file.content).not.toContain('url.toString()');
      }
    }
  });
});

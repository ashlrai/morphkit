import { describe, test, expect } from 'bun:test';
import { generateSwiftModels } from '../../src/generator/model-generator';
import type { SemanticAppModel } from '../../src/semantic/model';

describe('Swift Model Generator', () => {
  const createMinimalModel = (entities: any[]): SemanticAppModel => ({
    appName: 'TestApp',
    description: 'A test app',
    entities,
    screens: [],
    navigation: { type: 'stack', routes: [], tabs: [], deepLinks: [] },
    stateManagement: [],
    apiEndpoints: [],
    auth: null,
    theme: {
      colors: { primary: '#007AFF', secondary: '#5856D6', background: '#FFFFFF', surface: '#F2F2F7', text: '#000000', textSecondary: '#8E8E93' },
      typography: { heading: { fontFamily: 'system', fontSize: 28, fontWeight: 'bold' }, body: { fontFamily: 'system', fontSize: 17, fontWeight: 'regular' }, caption: { fontFamily: 'system', fontSize: 12, fontWeight: 'regular' } },
      spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
      borderRadius: {},
    },
  });

  test('generates a basic Swift struct', () => {
    const model = createMinimalModel([
      {
        name: 'Product',
        description: 'A product in the store',
        sourceFile: 'src/types/product.ts',
        fields: [
          { name: 'id', type: { kind: 'string' }, optional: false, description: 'Unique ID', isPrimaryKey: true },
          { name: 'name', type: { kind: 'string' }, optional: false, description: 'Product name' },
          { name: 'price', type: { kind: 'number' }, optional: false, description: 'Price in dollars' },
          { name: 'imageUrl', type: { kind: 'string' }, optional: true, description: 'Image URL' },
        ],
        relationships: [],
      },
    ]);

    const files = generateSwiftModels(model);
    expect(files.length).toBeGreaterThan(0);

    const productFile = files.find(f => f.path.includes('Product'));
    expect(productFile).toBeDefined();

    // Check Swift type mappings
    expect(productFile!.content).toContain('struct Product');
    expect(productFile!.content).toContain('Codable');
    expect(productFile!.content).toContain('Identifiable');
    expect(productFile!.content).toContain('let id: String');
    expect(productFile!.content).toContain('var name: String');
    expect(productFile!.content).toContain('var price: Double');
    expect(productFile!.content).toContain('var imageUrl: String?');
  });

  test('maps TypeScript types to Swift types correctly', () => {
    const model = createMinimalModel([
      {
        name: 'AllTypes',
        description: 'Tests type mapping',
        sourceFile: 'src/types/all.ts',
        fields: [
          { name: 'id', type: { kind: 'string' }, optional: false, description: '', isPrimaryKey: true },
          { name: 'count', type: { kind: 'number' }, optional: false, description: '' },
          { name: 'isActive', type: { kind: 'boolean' }, optional: false, description: '' },
          { name: 'createdAt', type: { kind: 'date' }, optional: false, description: '' },
          { name: 'tags', type: { kind: 'array', elementType: { kind: 'string' } }, optional: false, description: '' },
          { name: 'metadata', type: { kind: 'object' }, optional: true, description: '' },
        ],
        relationships: [],
      },
    ]);

    const files = generateSwiftModels(model);
    const file = files[0];

    expect(file.content).toContain('let id: String');
    expect(file.content).toContain('var count: Int');
    expect(file.content).toContain('var isActive: Bool');
    expect(file.content).toContain('var createdAt: Date');
    expect(file.content).toContain('var tags: [String]');
    expect(file.content).toContain('var metadata: [String: Any]?');
  });

  test('adds UUID default for missing id fields', () => {
    const model = createMinimalModel([
      {
        name: 'Note',
        description: 'A note without an id field',
        sourceFile: 'src/types/note.ts',
        fields: [
          { name: 'title', type: { kind: 'string' }, optional: false, description: '' },
          { name: 'body', type: { kind: 'string' }, optional: false, description: '' },
        ],
        relationships: [],
      },
    ]);

    const files = generateSwiftModels(model);
    const file = files[0];

    // Should add an id property for Identifiable conformance
    expect(file.content).toContain('Identifiable');
    expect(file.content).toContain('id');
  });
});

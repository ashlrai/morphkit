import { describe, test, expect } from 'bun:test';

import {
    generateSwiftModels,
    generateSwiftDataModels,
    generateDataManager,
    getSwiftDataEligibleEntities,
    isSwiftDataEligible,
} from '../../src/generator/model-generator';
import type { SemanticAppModel, Entity } from '../../src/semantic/model';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const createMinimalModel = (entities: any[], overrides: Partial<SemanticAppModel> = {}): SemanticAppModel => ({
    appName: 'TestApp',
    description: 'A test app',
    version: '1.0' as const,
    entities,
    screens: [],
    navigation: { type: 'stack', routes: [], tabs: [], deepLinks: [], initialScreen: 'Home' },
    stateManagement: [],
    apiEndpoints: [],
    auth: null,
    theme: {
        colors: {
            primary: '#007AFF',
            secondary: '#5856D6',
            accent: '#3B82F6',
            background: '#FFFFFF',
            surface: '#F2F2F7',
            error: '#EF4444',
            success: '#10B981',
            warning: '#F59E0B',
            text: { primary: '#000000', secondary: '#8E8E93', disabled: '#9CA3AF', inverse: '#FFFFFF' },
            custom: {},
        },
        typography: {},
        spacing: {},
        borderRadius: {},
        supportsDarkMode: false,
    },
    metadata: {
        extractedAt: new Date().toISOString(),
        morphkitVersion: '0.1.0',
    },
    ...overrides,
});

const productEntity = {
    name: 'Product',
    description: 'A product in the store',
    sourceFile: 'src/types/product.ts',
    confidence: 'high' as const,
    fields: [
        { name: 'id', type: { kind: 'string' as const }, optional: false, description: 'Unique ID', isPrimaryKey: true },
        { name: 'name', type: { kind: 'string' as const }, optional: false, description: 'Product name', isPrimaryKey: false },
        { name: 'price', type: { kind: 'number' as const }, optional: false, description: 'Price in dollars', isPrimaryKey: false },
        { name: 'imageUrl', type: { kind: 'string' as const }, optional: true, description: 'Image URL', isPrimaryKey: false },
    ],
    relationships: [],
};

const userEntity = {
    name: 'User',
    description: 'A user account',
    sourceFile: 'src/types/user.ts',
    confidence: 'medium' as const,
    fields: [
        { name: 'id', type: { kind: 'string' as const }, optional: false, description: '', isPrimaryKey: true },
        { name: 'name', type: { kind: 'string' as const }, optional: false, description: '', isPrimaryKey: false },
        { name: 'email', type: { kind: 'string' as const }, optional: false, description: '', isPrimaryKey: false },
        { name: 'isActive', type: { kind: 'boolean' as const }, optional: false, description: '', isPrimaryKey: false },
    ],
    relationships: [],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SwiftData Persistence Layer', () => {
    describe('SwiftData eligibility', () => {
        test('entities with 2+ fields and high/medium confidence are eligible', () => {
            expect(isSwiftDataEligible(productEntity as Entity)).toBe(true);
            expect(isSwiftDataEligible(userEntity as Entity)).toBe(true);
        });

        test('entities with low confidence are NOT eligible', () => {
            const lowConfidence = {
                ...productEntity,
                confidence: 'low' as const,
            };
            expect(isSwiftDataEligible(lowConfidence as Entity)).toBe(false);
        });

        test('INCOMPLETE entities with only id field are NOT eligible', () => {
            const incompleteEntity = {
                name: 'Stub',
                description: '',
                sourceFile: 'src/types/stub.ts',
                confidence: 'high' as const,
                fields: [
                    { name: 'id', type: { kind: 'string' as const }, optional: false, description: '', isPrimaryKey: true },
                ],
                relationships: [],
            };
            expect(isSwiftDataEligible(incompleteEntity as Entity)).toBe(false);
        });

        test('entities with fewer than 2 fields are NOT eligible', () => {
            const singleField = {
                name: 'Tag',
                description: '',
                sourceFile: 'src/types/tag.ts',
                confidence: 'high' as const,
                fields: [
                    { name: 'name', type: { kind: 'string' as const }, optional: false, description: '', isPrimaryKey: false },
                ],
                relationships: [],
            };
            expect(isSwiftDataEligible(singleField as Entity)).toBe(false);
        });

        test('enum entities are NOT eligible', () => {
            const enumEntity = {
                name: 'SortOrder',
                description: '',
                sourceFile: 'src/types/sort.ts',
                confidence: 'high' as const,
                fields: [
                    { name: '__enum', type: { kind: 'enum' as const, values: ['asc', 'desc'] }, optional: false, description: '', isPrimaryKey: false },
                ],
                relationships: [],
            };
            expect(isSwiftDataEligible(enumEntity as Entity)).toBe(false);
        });

        test('getSwiftDataEligibleEntities filters correctly', () => {
            const model = createMinimalModel([
                productEntity,
                userEntity,
                {
                    name: 'Stub',
                    description: '',
                    sourceFile: 'src/types/stub.ts',
                    confidence: 'high' as const,
                    fields: [
                        { name: 'id', type: { kind: 'string' as const }, optional: false, description: '', isPrimaryKey: true },
                    ],
                    relationships: [],
                },
            ]);

            const eligible = getSwiftDataEligibleEntities(model);
            expect(eligible.length).toBe(2);
            expect(eligible.map(e => e.name)).toContain('Product');
            expect(eligible.map(e => e.name)).toContain('User');
        });
    });

    describe('SwiftData model generation', () => {
        test('generates SwiftData models for eligible entities', () => {
            const model = createMinimalModel([productEntity]);
            const files = generateSwiftDataModels(model);

            expect(files.length).toBeGreaterThan(0);
            const storeFile = files.find(f => f.path.includes('DataStore'));
            expect(storeFile).toBeDefined();
        });

        test('SwiftData model class has @Model annotation', () => {
            const model = createMinimalModel([productEntity]);
            const files = generateSwiftDataModels(model);
            const content = files[0].content;

            expect(content).toContain('@Model');
            expect(content).toContain('final class ProductRecord');
        });

        test('SwiftData model imports SwiftData', () => {
            const model = createMinimalModel([productEntity]);
            const files = generateSwiftDataModels(model);
            const content = files[0].content;

            expect(content).toContain('import SwiftData');
        });

        test('SwiftData model has init(from:) convenience initializer', () => {
            const model = createMinimalModel([productEntity]);
            const files = generateSwiftDataModels(model);
            const content = files[0].content;

            expect(content).toContain('convenience init(from model: Product)');
        });

        test('SwiftData model has toModel() method', () => {
            const model = createMinimalModel([productEntity]);
            const files = generateSwiftDataModels(model);
            const content = files[0].content;

            expect(content).toContain('func toModel() -> Product');
        });

        test('SwiftData model uses @Attribute(.unique) for primary keys', () => {
            const model = createMinimalModel([productEntity]);
            const files = generateSwiftDataModels(model);
            const content = files[0].content;

            expect(content).toContain('@Attribute(.unique)');
        });

        test('SwiftData model uses Record suffix naming', () => {
            const model = createMinimalModel([productEntity, userEntity]);
            const files = generateSwiftDataModels(model);

            const productStore = files.find(f => f.content.includes('ProductRecord'));
            const userStore = files.find(f => f.content.includes('UserRecord'));

            expect(productStore).toBeDefined();
            expect(userStore).toBeDefined();
        });

        test('starts with Generated by Morphkit comment', () => {
            const model = createMinimalModel([productEntity]);
            const files = generateSwiftDataModels(model);
            expect(files[0].content).toContain('// Generated by Morphkit');
        });

        test('does not generate SwiftData models for ineligible entities', () => {
            const model = createMinimalModel([
                {
                    name: 'Stub',
                    description: '',
                    sourceFile: 'src/types/stub.ts',
                    confidence: 'high' as const,
                    fields: [
                        { name: 'id', type: { kind: 'string' as const }, optional: false, description: '', isPrimaryKey: true },
                    ],
                    relationships: [],
                },
            ]);

            const files = generateSwiftDataModels(model);
            expect(files.length).toBe(0);
        });

        test('handles optional fields correctly', () => {
            const model = createMinimalModel([productEntity]);
            const files = generateSwiftDataModels(model);
            const content = files[0].content;

            // imageUrl is optional
            expect(content).toContain('imageUrl: String? = nil');
        });

        test('handles relationship fields with @Relationship', () => {
            const entityWithRel = {
                name: 'Order',
                description: 'An order',
                sourceFile: 'src/types/order.ts',
                confidence: 'high' as const,
                fields: [
                    { name: 'id', type: { kind: 'string' as const }, optional: false, description: '', isPrimaryKey: true },
                    { name: 'total', type: { kind: 'number' as const }, optional: false, description: '', isPrimaryKey: false },
                    { name: 'items', type: { kind: 'array' as const, elementType: { kind: 'object' as const } }, optional: false, description: '', isPrimaryKey: false },
                ],
                relationships: [
                    { targetEntity: 'Product', type: 'one-to-many' as const, fieldName: 'items', description: '' },
                ],
            };
            const model = createMinimalModel([entityWithRel]);
            const files = generateSwiftDataModels(model);
            const content = files[0].content;

            expect(content).toContain('@Relationship');
            expect(content).toContain('[ProductRecord]');
        });
    });

    describe('DataManager generation', () => {
        test('generates DataManager for models with eligible entities', () => {
            const model = createMinimalModel([productEntity]);
            const file = generateDataManager(model);

            expect(file).not.toBeNull();
            expect(file!.path).toBe('State/DataManager.swift');
        });

        test('DataManager has save method for each entity', () => {
            const model = createMinimalModel([productEntity, userEntity]);
            const file = generateDataManager(model);
            const content = file!.content;

            expect(content).toContain('func saveProducts(_ products: [Product])');
            expect(content).toContain('func saveUsers(_ users: [User])');
        });

        test('DataManager has fetch method for each entity', () => {
            const model = createMinimalModel([productEntity, userEntity]);
            const file = generateDataManager(model);
            const content = file!.content;

            expect(content).toContain('func fetchCachedProducts() throws -> [Product]');
            expect(content).toContain('func fetchCachedUsers() throws -> [User]');
        });

        test('DataManager has delete method for each entity', () => {
            const model = createMinimalModel([productEntity]);
            const file = generateDataManager(model);
            const content = file!.content;

            expect(content).toContain('func deleteAllProducts()');
        });

        test('DataManager has save-single method', () => {
            const model = createMinimalModel([productEntity]);
            const file = generateDataManager(model);
            const content = file!.content;

            expect(content).toContain('func saveProduct(_ product: Product)');
        });

        test('DataManager uses FetchDescriptor', () => {
            const model = createMinimalModel([productEntity]);
            const file = generateDataManager(model);
            const content = file!.content;

            expect(content).toContain('FetchDescriptor<ProductRecord>');
        });

        test('DataManager imports SwiftData', () => {
            const model = createMinimalModel([productEntity]);
            const file = generateDataManager(model);
            const content = file!.content;

            expect(content).toContain('import SwiftData');
        });

        test('DataManager is @Observable singleton', () => {
            const model = createMinimalModel([productEntity]);
            const file = generateDataManager(model);
            const content = file!.content;

            expect(content).toContain('@Observable');
            expect(content).toContain('static let shared = DataManager()');
        });

        test('DataManager is null when no eligible entities', () => {
            const model = createMinimalModel([]);
            const file = generateDataManager(model);
            expect(file).toBeNull();
        });

        test('starts with Generated by Morphkit comment', () => {
            const model = createMinimalModel([productEntity]);
            const file = generateDataManager(model);
            expect(file!.content).toContain('// Generated by Morphkit');
        });
    });

    describe('App entry point with SwiftData', () => {
        // This tests the project-generator integration indirectly
        // by verifying that eligible entities would produce .modelContainer

        test('eligible entities produce store names for modelContainer', () => {
            const model = createMinimalModel([productEntity, userEntity]);
            const eligible = getSwiftDataEligibleEntities(model);

            // Verify the naming convention that project-generator uses
            const storeTypeNames = eligible.map(e => {
                const name = e.name.charAt(0).toUpperCase() + e.name.slice(1);
                return `${name}Record.self`;
            });

            expect(storeTypeNames).toContain('ProductRecord.self');
            expect(storeTypeNames).toContain('UserRecord.self');
        });
    });
});

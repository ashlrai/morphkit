import { describe, it, expect } from 'bun:test';
import { diffModels, isDiffEmpty } from '../../src/sync/model-diff';
import type { SemanticAppModel } from '../../src/semantic/model';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMinimalModel(overrides: Partial<SemanticAppModel> = {}): SemanticAppModel {
  return {
    appName: 'TestApp',
    description: '',
    version: '1.0' as const,
    entities: [],
    screens: [],
    navigation: {
      type: 'stack',
      routes: [],
      tabs: [],
      deepLinks: [],
      initialScreen: 'Home',
    },
    stateManagement: [],
    apiEndpoints: [],
    auth: null,
    theme: {
      colors: {
        primary: '#000000',
        secondary: '#6B7280',
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
      borderRadius: { none: 0, sm: 4, md: 8, lg: 12, xl: 16, full: 9999 },
      supportsDarkMode: false,
    },
    confidence: 'medium',
    metadata: {
      sourceFramework: 'next',
      extractedAt: '2024-01-01T00:00:00.000Z',
      morphkitVersion: '0.1.0',
      analyzedFiles: [],
      warnings: [],
    },
    ...overrides,
  };
}

function makeScreen(name: string, overrides: Record<string, unknown> = {}) {
  return {
    name,
    description: '',
    purpose: `The ${name} screen`,
    sourceFile: `src/${name}.tsx`,
    sourceComponent: name,
    layout: 'list' as const,
    components: [],
    dataRequirements: [],
    actions: [],
    stateBindings: [],
    isEntryPoint: false,
    confidence: 'medium' as const,
    ...overrides,
  };
}

function makeEntity(name: string, fields: Array<{ name: string; kind: string; optional?: boolean }>) {
  return {
    name,
    description: '',
    fields: fields.map(f => ({
      name: f.name,
      type: { kind: f.kind as 'string' | 'number' | 'boolean', inferred: false },
      optional: f.optional ?? false,
      description: '',
      isPrimaryKey: f.name === 'id',
    })),
    sourceFile: `src/types/${name}.ts`,
    relationships: [],
    confidence: 'medium' as const,
  };
}

function makeEndpoint(method: string, url: string, overrides: Record<string, unknown> = {}) {
  return {
    url,
    method: method as 'GET' | 'POST',
    headers: {},
    requestBody: null,
    responseType: { kind: 'object' as const, inferred: false },
    auth: false,
    caching: null,
    description: '',
    sourceFile: '',
    confidence: 'medium' as const,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('diffModels', () => {
  it('returns empty diff when models are identical', () => {
    const model = makeMinimalModel({
      screens: [makeScreen('Home')],
      entities: [makeEntity('User', [{ name: 'id', kind: 'string' }])],
    });

    const diff = diffModels(model, model);

    expect(isDiffEmpty(diff)).toBe(true);
    expect(diff.addedScreens).toEqual([]);
    expect(diff.removedScreens).toEqual([]);
    expect(diff.modifiedScreens).toEqual([]);
    expect(diff.addedEntities).toEqual([]);
    expect(diff.removedEntities).toEqual([]);
    expect(diff.modifiedEntities).toEqual([]);
    expect(diff.summary).toBe('No changes detected');
  });

  it('detects added screens', () => {
    const prev = makeMinimalModel({ screens: [makeScreen('Home')] });
    const next = makeMinimalModel({ screens: [makeScreen('Home'), makeScreen('Settings')] });

    const diff = diffModels(prev, next);

    expect(diff.addedScreens).toEqual(['Settings']);
    expect(diff.removedScreens).toEqual([]);
    expect(diff.modifiedScreens).toEqual([]);
    expect(isDiffEmpty(diff)).toBe(false);
  });

  it('detects removed screens', () => {
    const prev = makeMinimalModel({ screens: [makeScreen('Home'), makeScreen('Settings')] });
    const next = makeMinimalModel({ screens: [makeScreen('Home')] });

    const diff = diffModels(prev, next);

    expect(diff.addedScreens).toEqual([]);
    expect(diff.removedScreens).toEqual(['Settings']);
    expect(diff.modifiedScreens).toEqual([]);
  });

  it('detects modified screens when data requirements change', () => {
    const prevScreen = makeScreen('Home', {
      dataRequirements: [{ source: 'User', fetchStrategy: 'api', cardinality: 'many', blocking: true, params: {} }],
    });
    const nextScreen = makeScreen('Home', {
      dataRequirements: [{ source: 'User', fetchStrategy: 'context', cardinality: 'many', blocking: true, params: {} }],
    });

    const prev = makeMinimalModel({ screens: [prevScreen] });
    const next = makeMinimalModel({ screens: [nextScreen] });

    const diff = diffModels(prev, next);

    expect(diff.modifiedScreens).toEqual(['Home']);
    expect(diff.addedScreens).toEqual([]);
    expect(diff.removedScreens).toEqual([]);
  });

  it('detects modified screens when actions change', () => {
    const prevScreen = makeScreen('Home');
    const nextScreen = makeScreen('Home', {
      actions: [{
        label: 'Delete',
        trigger: 'tap',
        effect: { type: 'mutate', target: 'deleteItem', payload: {} },
        destructive: true,
        requiresAuth: false,
      }],
    });

    const prev = makeMinimalModel({ screens: [prevScreen] });
    const next = makeMinimalModel({ screens: [nextScreen] });

    const diff = diffModels(prev, next);

    expect(diff.modifiedScreens).toEqual(['Home']);
  });

  it('detects added entities', () => {
    const prev = makeMinimalModel({ entities: [] });
    const next = makeMinimalModel({
      entities: [makeEntity('Product', [{ name: 'id', kind: 'string' }, { name: 'title', kind: 'string' }])],
    });

    const diff = diffModels(prev, next);

    expect(diff.addedEntities).toEqual(['Product']);
    expect(diff.removedEntities).toEqual([]);
  });

  it('detects removed entities', () => {
    const prev = makeMinimalModel({
      entities: [makeEntity('Product', [{ name: 'id', kind: 'string' }])],
    });
    const next = makeMinimalModel({ entities: [] });

    const diff = diffModels(prev, next);

    expect(diff.removedEntities).toEqual(['Product']);
  });

  it('detects modified entities when fields change', () => {
    const prev = makeMinimalModel({
      entities: [makeEntity('User', [{ name: 'id', kind: 'string' }, { name: 'name', kind: 'string' }])],
    });
    const next = makeMinimalModel({
      entities: [makeEntity('User', [{ name: 'id', kind: 'string' }, { name: 'name', kind: 'string' }, { name: 'email', kind: 'string' }])],
    });

    const diff = diffModels(prev, next);

    expect(diff.modifiedEntities).toEqual(['User']);
    expect(diff.addedEntities).toEqual([]);
    expect(diff.removedEntities).toEqual([]);
  });

  it('detects modified entities when field types change', () => {
    const prev = makeMinimalModel({
      entities: [makeEntity('User', [{ name: 'id', kind: 'string' }, { name: 'age', kind: 'string' }])],
    });
    const next = makeMinimalModel({
      entities: [makeEntity('User', [{ name: 'id', kind: 'string' }, { name: 'age', kind: 'number' }])],
    });

    const diff = diffModels(prev, next);

    expect(diff.modifiedEntities).toEqual(['User']);
  });

  it('detects added endpoints', () => {
    const prev = makeMinimalModel({ apiEndpoints: [] });
    const next = makeMinimalModel({
      apiEndpoints: [makeEndpoint('GET', '/api/users')],
    });

    const diff = diffModels(prev, next);

    expect(diff.addedEndpoints).toEqual(['GET:/api/users']);
  });

  it('detects removed endpoints', () => {
    const prev = makeMinimalModel({
      apiEndpoints: [makeEndpoint('GET', '/api/users'), makeEndpoint('DELETE', '/api/users/:id')],
    });
    const next = makeMinimalModel({
      apiEndpoints: [makeEndpoint('GET', '/api/users')],
    });

    const diff = diffModels(prev, next);

    expect(diff.removedEndpoints).toEqual(['DELETE:/api/users/:id']);
  });

  it('detects modified endpoints when URL stays the same but response type changes', () => {
    const prev = makeMinimalModel({
      apiEndpoints: [makeEndpoint('GET', '/api/users', { responseType: { kind: 'object', inferred: false } })],
    });
    const next = makeMinimalModel({
      apiEndpoints: [makeEndpoint('GET', '/api/users', { responseType: { kind: 'array', inferred: false } })],
    });

    const diff = diffModels(prev, next);

    expect(diff.modifiedEndpoints).toEqual(['GET:/api/users']);
  });

  it('detects navigation changes', () => {
    const prev = makeMinimalModel({
      navigation: { type: 'stack', routes: [], tabs: [], deepLinks: [], initialScreen: 'Home' },
    });
    const next = makeMinimalModel({
      navigation: {
        type: 'tab',
        routes: [{ path: '/', screen: 'Home', params: [], guards: [] }],
        tabs: [{ label: 'Home', icon: 'house', screen: 'Home' }],
        deepLinks: [],
        initialScreen: 'Home',
      },
    });

    const diff = diffModels(prev, next);

    expect(diff.changedNavigation).toBe(true);
  });

  it('detects auth changes', () => {
    const prev = makeMinimalModel({ auth: null });
    const next = makeMinimalModel({
      auth: {
        type: 'jwt',
        provider: null,
        flows: [{ name: 'login', screens: ['Login'], endpoints: ['/api/auth/login'], description: '' }],
        storageStrategy: 'other',
        confidence: 'medium',
      },
    });

    const diff = diffModels(prev, next);

    expect(diff.changedAuth).toBe(true);
  });

  it('generates a human-readable summary', () => {
    const prev = makeMinimalModel({ screens: [makeScreen('Home')] });
    const next = makeMinimalModel({
      screens: [makeScreen('Home'), makeScreen('Settings'), makeScreen('Profile')],
      entities: [makeEntity('User', [{ name: 'id', kind: 'string' }])],
    });

    const diff = diffModels(prev, next);

    expect(diff.summary).toContain('2 new screens');
    expect(diff.summary).toContain('1 new entity');
  });

  it('generates correct singular/plural in summary', () => {
    const prev = makeMinimalModel({});
    const next = makeMinimalModel({
      screens: [makeScreen('Home')],
      entities: [makeEntity('User', [{ name: 'id', kind: 'string' }])],
      apiEndpoints: [makeEndpoint('GET', '/api/users')],
    });

    const diff = diffModels(prev, next);

    expect(diff.summary).toContain('1 new screen');
    expect(diff.summary).not.toContain('1 new screens');
    expect(diff.summary).toContain('1 new entity');
    expect(diff.summary).not.toContain('1 new entitys');
    expect(diff.summary).toContain('1 new endpoint');
  });

  it('handles complex mixed changes', () => {
    const prev = makeMinimalModel({
      screens: [makeScreen('Home'), makeScreen('Settings'), makeScreen('OldPage')],
      entities: [
        makeEntity('User', [{ name: 'id', kind: 'string' }, { name: 'name', kind: 'string' }]),
        makeEntity('OldEntity', [{ name: 'id', kind: 'string' }]),
      ],
      apiEndpoints: [makeEndpoint('GET', '/api/users')],
    });

    const next = makeMinimalModel({
      screens: [
        makeScreen('Home'),
        makeScreen('Settings', { layout: 'form' as const }),  // modified
        makeScreen('Dashboard'),  // added
      ],
      entities: [
        makeEntity('User', [{ name: 'id', kind: 'string' }, { name: 'name', kind: 'string' }, { name: 'email', kind: 'string' }]),  // modified
        makeEntity('Product', [{ name: 'id', kind: 'string' }]),  // added
      ],
      apiEndpoints: [
        makeEndpoint('GET', '/api/users'),
        makeEndpoint('POST', '/api/products'),  // added
      ],
    });

    const diff = diffModels(prev, next);

    expect(diff.addedScreens).toEqual(['Dashboard']);
    expect(diff.removedScreens).toEqual(['OldPage']);
    expect(diff.modifiedScreens).toEqual(['Settings']);
    expect(diff.addedEntities).toEqual(['Product']);
    expect(diff.removedEntities).toEqual(['OldEntity']);
    expect(diff.modifiedEntities).toEqual(['User']);
    expect(diff.addedEndpoints).toEqual(['POST:/api/products']);
    expect(isDiffEmpty(diff)).toBe(false);
  });
});

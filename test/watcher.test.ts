import { describe, test, expect } from 'bun:test';

import type { SemanticAppModel } from '../src/semantic/model';
import {
  diffModels,
  isDiffEmpty,
  shouldWatch,
  createDebouncedRunner,
} from '../src/watcher';

// ---------------------------------------------------------------------------
// Helpers to build minimal SemanticAppModel fixtures
// ---------------------------------------------------------------------------

function makeModel(overrides: Partial<SemanticAppModel> = {}): SemanticAppModel {
  return {
    appName: 'TestApp',
    description: '',
    version: '1.0' as const,
    entities: [],
    screens: [],
    navigation: {
      type: 'tab',
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
      extractedAt: new Date().toISOString(),
      morphkitVersion: '0.1.0',
      analyzedFiles: [],
      warnings: [],
    },
    ...overrides,
  };
}

function makeScreen(name: string, purpose = 'Test screen') {
  return {
    name,
    description: '',
    purpose,
    sourceFile: `src/${name}.tsx`,
    sourceComponent: name,
    layout: 'list' as const,
    components: [],
    dataRequirements: [],
    actions: [],
    stateBindings: [],
    isEntryPoint: false,
    confidence: 'medium' as const,
  };
}

function makeEntity(name: string, fields: string[] = ['id', 'name']) {
  return {
    name,
    description: '',
    fields: fields.map((f) => ({
      name: f,
      type: { kind: 'string' as const },
      optional: false,
      description: '',
      isPrimaryKey: f === 'id',
    })),
    sourceFile: `src/${name}.ts`,
    relationships: [],
    confidence: 'medium' as const,
  };
}

function makeEndpoint(method: string, url: string) {
  return {
    url,
    method: method as any,
    headers: {},
    requestBody: null,
    responseType: { kind: 'object' as const },
    auth: false,
    caching: null,
    description: '',
    sourceFile: '',
    confidence: 'medium' as const,
  };
}

// ---------------------------------------------------------------------------
// diffModels tests
// ---------------------------------------------------------------------------

describe('diffModels', () => {
  test('returns empty diff for identical models', () => {
    const model = makeModel({
      screens: [makeScreen('Home'), makeScreen('Profile')],
      entities: [makeEntity('User')],
    });
    const diff = diffModels(model, model);

    expect(isDiffEmpty(diff)).toBe(true);
    expect(diff.addedScreens).toEqual([]);
    expect(diff.removedScreens).toEqual([]);
    expect(diff.modifiedScreens).toEqual([]);
  });

  test('detects added screens', () => {
    const prev = makeModel({ screens: [makeScreen('Home')] });
    const next = makeModel({
      screens: [makeScreen('Home'), makeScreen('Settings')],
    });
    const diff = diffModels(prev, next);

    expect(diff.addedScreens).toEqual(['Settings']);
    expect(diff.removedScreens).toEqual([]);
    expect(diff.modifiedScreens).toEqual([]);
    expect(isDiffEmpty(diff)).toBe(false);
  });

  test('detects removed screens', () => {
    const prev = makeModel({
      screens: [makeScreen('Home'), makeScreen('Settings')],
    });
    const next = makeModel({ screens: [makeScreen('Home')] });
    const diff = diffModels(prev, next);

    expect(diff.addedScreens).toEqual([]);
    expect(diff.removedScreens).toEqual(['Settings']);
    expect(diff.modifiedScreens).toEqual([]);
    expect(isDiffEmpty(diff)).toBe(false);
  });

  test('detects modified screens', () => {
    const prev = makeModel({
      screens: [makeScreen('Home')],
    });
    // Change layout (included in screen signature) to trigger modification
    const modifiedScreen = { ...makeScreen('Home'), layout: 'form' as const };
    const next = makeModel({
      screens: [modifiedScreen],
    });
    const diff = diffModels(prev, next);

    expect(diff.addedScreens).toEqual([]);
    expect(diff.removedScreens).toEqual([]);
    expect(diff.modifiedScreens).toEqual(['Home']);
    expect(isDiffEmpty(diff)).toBe(false);
  });

  test('detects added entities', () => {
    const prev = makeModel({ entities: [makeEntity('User')] });
    const next = makeModel({
      entities: [makeEntity('User'), makeEntity('Product')],
    });
    const diff = diffModels(prev, next);

    expect(diff.addedEntities).toEqual(['Product']);
    expect(diff.removedEntities).toEqual([]);
    expect(diff.modifiedEntities).toEqual([]);
  });

  test('detects removed entities', () => {
    const prev = makeModel({
      entities: [makeEntity('User'), makeEntity('Product')],
    });
    const next = makeModel({ entities: [makeEntity('User')] });
    const diff = diffModels(prev, next);

    expect(diff.removedEntities).toEqual(['Product']);
  });

  test('detects modified entities (field changes)', () => {
    const prev = makeModel({
      entities: [makeEntity('User', ['id', 'name'])],
    });
    const next = makeModel({
      entities: [makeEntity('User', ['id', 'name', 'email'])],
    });
    const diff = diffModels(prev, next);

    expect(diff.modifiedEntities).toEqual(['User']);
    expect(diff.addedEntities).toEqual([]);
  });

  test('detects added API endpoints', () => {
    const prev = makeModel({
      apiEndpoints: [makeEndpoint('GET', '/api/users')],
    });
    const next = makeModel({
      apiEndpoints: [
        makeEndpoint('GET', '/api/users'),
        makeEndpoint('POST', '/api/users'),
      ],
    });
    const diff = diffModels(prev, next);

    expect(diff.addedEndpoints).toEqual(['POST:/api/users']);
    expect(diff.removedEndpoints).toEqual([]);
  });

  test('detects removed API endpoints', () => {
    const prev = makeModel({
      apiEndpoints: [
        makeEndpoint('GET', '/api/users'),
        makeEndpoint('DELETE', '/api/users'),
      ],
    });
    const next = makeModel({
      apiEndpoints: [makeEndpoint('GET', '/api/users')],
    });
    const diff = diffModels(prev, next);

    expect(diff.removedEndpoints).toEqual(['DELETE:/api/users']);
  });

  test('detects navigation changes', () => {
    const prev = makeModel({
      navigation: {
        type: 'tab',
        routes: [],
        tabs: [],
        deepLinks: [],
        initialScreen: 'Home',
      },
    });
    const next = makeModel({
      navigation: {
        type: 'stack',
        routes: [],
        tabs: [],
        deepLinks: [],
        initialScreen: 'Home',
      },
    });
    const diff = diffModels(prev, next);

    expect(diff.changedNavigation).toBe(true);
  });

  test('detects auth changes', () => {
    const prev = makeModel({ auth: null });
    const next = makeModel({
      auth: {
        type: 'jwt',
        provider: null,
        flows: [],
        storageStrategy: 'other',
        confidence: 'medium',
      },
    });
    const diff = diffModels(prev, next);

    expect(diff.changedAuth).toBe(true);
  });

  test('handles complex combined changes', () => {
    const prev = makeModel({
      screens: [makeScreen('Home'), makeScreen('Profile')],
      entities: [makeEntity('User'), makeEntity('Order')],
      apiEndpoints: [makeEndpoint('GET', '/api/users')],
    });
    // Change Home's layout (structural change detected by signature comparison)
    const modifiedHome = { ...makeScreen('Home'), layout: 'dashboard' as const };
    const next = makeModel({
      screens: [
        modifiedHome,
        makeScreen('Settings'),
      ],
      entities: [makeEntity('User', ['id', 'name', 'avatar']), makeEntity('Product')],
      apiEndpoints: [
        makeEndpoint('GET', '/api/users'),
        makeEndpoint('GET', '/api/products'),
      ],
    });
    const diff = diffModels(prev, next);

    expect(diff.addedScreens).toEqual(['Settings']);
    expect(diff.removedScreens).toEqual(['Profile']);
    expect(diff.modifiedScreens).toEqual(['Home']);
    expect(diff.addedEntities).toEqual(['Product']);
    expect(diff.removedEntities).toEqual(['Order']);
    expect(diff.modifiedEntities).toEqual(['User']);
    expect(diff.addedEndpoints).toEqual(['GET:/api/products']);
  });
});

// ---------------------------------------------------------------------------
// shouldWatch tests
// ---------------------------------------------------------------------------

describe('shouldWatch', () => {
  test('accepts TypeScript files', () => {
    expect(shouldWatch('src/App.tsx')).toBe(true);
    expect(shouldWatch('src/utils.ts')).toBe(true);
  });

  test('accepts JavaScript files', () => {
    expect(shouldWatch('src/App.jsx')).toBe(true);
    expect(shouldWatch('src/utils.js')).toBe(true);
  });

  test('accepts CSS files', () => {
    expect(shouldWatch('src/styles.css')).toBe(true);
  });

  test('rejects non-source files', () => {
    expect(shouldWatch('package.json')).toBe(false);
    expect(shouldWatch('README.md')).toBe(false);
    expect(shouldWatch('image.png')).toBe(false);
    expect(shouldWatch('.env')).toBe(false);
  });

  test('rejects node_modules paths', () => {
    expect(shouldWatch('node_modules/react/index.js')).toBe(false);
  });

  test('rejects .next directory paths', () => {
    expect(shouldWatch('.next/static/chunks/main.js')).toBe(false);
  });

  test('rejects dist directory paths', () => {
    expect(shouldWatch('dist/bundle.js')).toBe(false);
  });

  test('rejects build directory paths', () => {
    expect(shouldWatch('build/index.js')).toBe(false);
  });

  test('rejects .git directory paths', () => {
    expect(shouldWatch('.git/hooks/pre-commit.js')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Debounce tests
// ---------------------------------------------------------------------------

describe('createDebouncedRunner', () => {
  test('multiple rapid triggers result in a single execution', async () => {
    let callCount = 0;
    const debounced = createDebouncedRunner(async () => {
      callCount++;
    }, 50);

    // Trigger 5 times rapidly
    debounced.trigger();
    debounced.trigger();
    debounced.trigger();
    debounced.trigger();
    debounced.trigger();

    // Wait for debounce to fire
    await new Promise((r) => setTimeout(r, 120));

    expect(callCount).toBe(1);

    debounced.cancel();
  });

  test('cancel prevents execution', async () => {
    let callCount = 0;
    const debounced = createDebouncedRunner(async () => {
      callCount++;
    }, 50);

    debounced.trigger();
    debounced.cancel();

    await new Promise((r) => setTimeout(r, 120));

    expect(callCount).toBe(0);
  });

  test('separate triggers spaced apart each execute', async () => {
    let callCount = 0;
    const debounced = createDebouncedRunner(async () => {
      callCount++;
    }, 30);

    debounced.trigger();
    await new Promise((r) => setTimeout(r, 80));
    expect(callCount).toBe(1);

    debounced.trigger();
    await new Promise((r) => setTimeout(r, 80));
    expect(callCount).toBe(2);

    debounced.cancel();
  });
});

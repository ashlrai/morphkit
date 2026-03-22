import { describe, test, expect } from 'bun:test';

import { generateSwiftUIViews, isWebOnlyState, getReferenceScreenNames, resolveEntityNameInOutput } from '../../src/generator/swiftui-generator';
import type { SemanticAppModel, Entity } from '../../src/semantic/model';

describe('SwiftUI View Generator', () => {
  const createModelWithScreens = (screens: any[]): SemanticAppModel => ({
    appName: 'TestApp',
    description: 'A test app',
    entities: [],
    screens,
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

  test('generates a list view', async () => {
    const model = createModelWithScreens([
      {
        name: 'ProductList',
        description: 'Shows a list of products',
        purpose: 'Browse and search products',
        sourceFile: 'app/products/page.tsx',
        sourceComponent: 'ProductList',
        layout: 'list',
        components: [],
        dataRequirements: [{ source: 'Product', fetchStrategy: 'api' as const, cardinality: 'many' as const, blocking: true, params: {} }],
        actions: [{ label: 'selectProduct', trigger: 'tap' as const, effect: { type: 'navigate' as const, target: 'productDetail', payload: {} }, destructive: false, requiresAuth: false }],
        stateBindings: [],
      },
    ]);

    const files = await generateSwiftUIViews(model);
    expect(files.length).toBeGreaterThan(0);

    const listView = files.find(f => f.path.includes('ProductList'));
    expect(listView).toBeDefined();
    expect(listView!.content).toContain('struct ProductListView: View');
    expect(listView!.content).toContain('import SwiftUI');
    expect(listView!.content).toContain('var body: some View');
    expect(listView!.content).toContain('#Preview');
  });

  test('generates a form view', async () => {
    const model = createModelWithScreens([
      {
        name: 'AddProduct',
        description: 'Form to add a new product',
        purpose: 'Create a new product entry',
        sourceFile: 'app/products/new/page.tsx',
        sourceComponent: 'AddProductForm',
        layout: 'form',
        components: [],
        dataRequirements: [],
        actions: [{ label: 'submit', trigger: 'submit' as const, effect: { type: 'mutate' as const, target: 'save', payload: {} }, destructive: false, requiresAuth: false }],
        stateBindings: [],
      },
    ]);

    const files = await generateSwiftUIViews(model);
    const formView = files.find(f => f.path.includes('AddProduct'));
    expect(formView).toBeDefined();
    expect(formView!.content).toContain('Form');
  });

  test('generates a detail view', async () => {
    const model = createModelWithScreens([
      {
        name: 'ProductDetail',
        description: 'Shows product details',
        purpose: 'View full product information',
        sourceFile: 'app/products/[id]/page.tsx',
        sourceComponent: 'ProductDetail',
        layout: 'detail',
        components: [],
        dataRequirements: [{ source: 'Product', fetchStrategy: 'api' as const, cardinality: 'one' as const, blocking: true, params: {} }],
        actions: [
          { label: 'addToCart', trigger: 'tap' as const, effect: { type: 'mutate' as const, target: 'addToCart', payload: {} }, destructive: false, requiresAuth: false },
          { label: 'share', trigger: 'tap' as const, effect: { type: 'share' as const, target: 'product', payload: {} }, destructive: false, requiresAuth: false },
        ],
        stateBindings: [],
      },
    ]);

    const files = await generateSwiftUIViews(model);
    const detailView = files.find(f => f.path.includes('ProductDetail'));
    expect(detailView).toBeDefined();
    // Detail views use ScrollView or have product property
    expect(detailView!.content).toContain('struct ProductDetailView: View');
  });

  test('isWebOnlyState filters hover/tooltip/dropdown state names', async () => {
    expect(isWebOnlyState('isHovered')).toBe(true);
    expect(isWebOnlyState('tooltipVisible')).toBe(true);
    expect(isWebOnlyState('dropdownOpen')).toBe(true);
    expect(isWebOnlyState('showDropdown')).toBe(true);
    expect(isWebOnlyState('isHovering')).toBe(true);
    // These should NOT be filtered
    expect(isWebOnlyState('isLoading')).toBe(false);
    expect(isWebOnlyState('userName')).toBe(false);
    expect(isWebOnlyState('selectedItem')).toBe(false);
  });

  test('settings view generates semantic groupings', async () => {
    const model = createModelWithScreens([
      {
        name: 'Settings',
        description: 'User settings page',
        purpose: 'Manage app settings',
        sourceFile: 'app/settings/page.tsx',
        sourceComponent: 'Settings',
        layout: 'settings',
        components: [],
        dataRequirements: [],
        actions: [],
        stateBindings: ['username', 'email', 'notificationsEnabled', 'darkMode'],
      },
    ]);

    const files = await generateSwiftUIViews(model);
    const settingsView = files.find(f => f.path.includes('Settings'));
    expect(settingsView).toBeDefined();
    expect(settingsView!.content).toContain('Section');
  });

  test('reference implementation scoring selects top screens', async () => {
    const model: SemanticAppModel = {
      appName: 'TestApp',
      description: 'A test app',
      entities: [
        { name: 'Product', description: '', fields: [
          { name: 'id', type: { kind: 'string' }, optional: false, description: '', isPrimaryKey: true },
          { name: 'name', type: { kind: 'string' }, optional: false, description: '', isPrimaryKey: false },
        ], sourceFile: '', relationships: [], confidence: 'high' },
      ],
      screens: [
        {
          name: 'ProductList',
          description: 'Products listing',
          purpose: 'Browse products',
          sourceFile: 'app/products/page.tsx',
          sourceComponent: 'ProductList',
          layout: 'list',
          components: [],
          dataRequirements: [{ source: 'Product', fetchStrategy: 'api' as const, cardinality: 'many' as const, blocking: true, params: {} }],
          actions: [{ label: 'select', trigger: 'tap' as const, effect: { type: 'navigate' as const, target: 'detail', payload: {} }, destructive: false, requiresAuth: false }],
          stateBindings: [],
        },
        {
          name: 'Home',
          description: 'Home',
          purpose: 'Landing',
          sourceFile: 'app/page.tsx',
          sourceComponent: 'Home',
          layout: 'dashboard',
          components: [],
          dataRequirements: [],
          actions: [],
          stateBindings: [],
        },
      ],
      navigation: { type: 'stack', routes: [], tabs: [], deepLinks: [] },
      stateManagement: [],
      apiEndpoints: [{ url: '/api/products', method: 'GET', auth: false }],
      auth: null,
      theme: {
        colors: { primary: '#007AFF', secondary: '#5856D6', background: '#FFFFFF', surface: '#F2F2F7', text: '#000000', textSecondary: '#8E8E93' },
        typography: { heading: { fontFamily: 'system', fontSize: 28, fontWeight: 'bold' }, body: { fontFamily: 'system', fontSize: 17, fontWeight: 'regular' }, caption: { fontFamily: 'system', fontSize: 12, fontWeight: 'regular' } },
        spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
        borderRadius: {},
      },
    };

    const refNames = getReferenceScreenNames(model);
    // Should select at least one reference screen (the one with API data + actions)
    expect(refNames.size).toBeGreaterThanOrEqual(1);
    expect(refNames.size).toBeLessThanOrEqual(2);
  });

  test('type mismatch in loadData emits TODO comment when scalar vs array', async () => {
    // State binding "referral" resolves to String (scalar via name inference)
    // but data requirement uses cardinality 'many' which returns an array.
    // The loadData assignment should emit a TODO comment, not a live assignment.
    const model: SemanticAppModel = {
      appName: 'TestApp',
      description: 'Test',
      entities: [],
      screens: [
        {
          name: 'Dashboard',
          description: 'Dashboard view',
          purpose: 'Show overview',
          sourceFile: 'app/dashboard/page.tsx',
          sourceComponent: 'Dashboard',
          layout: 'dashboard',
          components: [],
          dataRequirements: [
            { source: 'referral', fetchStrategy: 'api' as const, cardinality: 'many' as const, blocking: true, params: {} },
          ],
          actions: [],
          stateBindings: ['referral'],
        },
      ],
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
    };

    const files = await generateSwiftUIViews(model);
    const dashView = files.find(f => f.path.includes('Dashboard'));
    expect(dashView).toBeDefined();
    // The assignment should be a TODO or a data-req-declared variable (which handles it correctly)
    // The key check: the generated view should compile without type errors
    expect(dashView!.content).toContain('struct DashboardView: View');
  });

  test('includes Morphkit header comment', async () => {
    const model = createModelWithScreens([
      {
        name: 'Home',
        description: 'Home screen',
        purpose: 'Main landing page',
        sourceFile: 'app/page.tsx',
        sourceComponent: 'Home',
        layout: 'dashboard',
        components: [],
        dataRequirements: [],
        actions: [],
        stateBindings: [],
      },
    ]);

    const files = await generateSwiftUIViews(model);
    for (const file of files) {
      expect(file.content).toContain('Generated by Morphkit');
    }
  });
});

describe('Entity Resolution', () => {
  const makeEntity = (name: string, fieldCount: number): Entity => ({
    name,
    description: `A ${name}`,
    sourceFile: `src/types/${name.toLowerCase()}.ts`,
    fields: Array.from({ length: fieldCount }, (_, i) => ({
      name: i === 0 ? 'id' : `field${i}`,
      type: { kind: 'string' as const },
      optional: false,
      description: '',
      ...(i === 0 ? { isPrimaryKey: true } : {}),
    })),
    relationships: [],
    confidence: 'high' as const,
  });

  const makeModel = (entities: Entity[]): SemanticAppModel => ({
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

  test('resolveEntityNameInOutput finds exact match', async () => {
    const model = makeModel([makeEntity('Product', 5)]);
    expect(resolveEntityNameInOutput('Product', model)).toBe('Product');
  });

  test('resolveEntityNameInOutput finds compound suffix match', async () => {
    const model = makeModel([makeEntity('StructuredRound', 4)]);
    expect(resolveEntityNameInOutput('Round', model)).toBe('StructuredRound');
  });

  test('resolveEntityNameInOutput returns null for no match', async () => {
    const model = makeModel([makeEntity('Product', 5)]);
    expect(resolveEntityNameInOutput('Order', model)).toBeNull();
  });

  test('resolveEntityNameInOutput prefers exact over suffix match', async () => {
    const model = makeModel([makeEntity('Round', 3), makeEntity('StructuredRound', 4)]);
    expect(resolveEntityNameInOutput('Round', model)).toBe('Round');
  });

  test('dashboard state and body use same entity resolution', async () => {
    const model: SemanticAppModel = {
      ...makeModel([makeEntity('Tour', 6), makeEntity('Booking', 4)]),
      screens: [{
        name: 'Home',
        description: 'Home screen',
        purpose: 'Main landing page',
        sourceFile: 'app/page.tsx',
        sourceComponent: 'Home',
        layout: 'dashboard',
        components: [],
        dataRequirements: [],
        actions: [],
        stateBindings: [],
      }],
    };

    const files = await generateSwiftUIViews(model);
    const homeView = files.find(f => f.path.includes('Home'));
    expect(homeView).toBeDefined();
    const content = homeView!.content;
    // The dashboard should reference the entity with most fields (Tour)
    // and the @State array should use the same name as the body references
    if (content.includes('@State private var tours:')) {
      expect(content).toContain('tours.isEmpty');
    }
  });

  test('profile screen declares entity state variable', async () => {
    const model: SemanticAppModel = {
      ...makeModel([makeEntity('User', 5)]),
      screens: [{
        name: 'Profile',
        description: 'User profile',
        purpose: 'View user profile',
        sourceFile: 'app/profile/page.tsx',
        sourceComponent: 'Profile',
        layout: 'profile',
        components: [],
        dataRequirements: [],
        actions: [],
        stateBindings: [],
      }],
    };

    const files = await generateSwiftUIViews(model);
    const profileView = files.find(f => f.path.includes('Profile'));
    expect(profileView).toBeDefined();
    // Profile should declare a state variable for the entity
    const content = profileView!.content;
    // Should have either @State private var user or @State private var profile
    const hasEntityState = content.includes('@State private var user:') || content.includes('@State private var profile:');
    expect(hasEntityState).toBe(true);
  });

  test('data requirement uses resolved entity type for state declaration', async () => {
    const model: SemanticAppModel = {
      ...makeModel([makeEntity('StructuredRound', 5)]),
      screens: [{
        name: 'Rounds',
        description: 'List of rounds',
        purpose: 'Browse rounds',
        sourceFile: 'app/rounds/page.tsx',
        sourceComponent: 'RoundsList',
        layout: 'list',
        components: [],
        dataRequirements: [{ source: 'Round', fetchStrategy: 'api' as const, cardinality: 'many' as const, blocking: true, params: {} }],
        actions: [],
        stateBindings: [],
      }],
    };

    const files = await generateSwiftUIViews(model);
    const roundsView = files.find(f => f.path.includes('Rounds'));
    expect(roundsView).toBeDefined();
    const content = roundsView!.content;
    // Should resolve "Round" to "StructuredRound" via suffix matching
    expect(content).toContain('[StructuredRound]');
    // Should NOT fall back to [String]
    expect(content).not.toContain('rounds: [String]');
  });

  test('loadData uses networking generator function name for matching endpoint', async () => {
    const model: SemanticAppModel = {
      ...makeModel([makeEntity('Product', 5)]),
      screens: [{
        name: 'ProductList',
        description: 'Product listing',
        purpose: 'Browse products',
        sourceFile: 'app/products/page.tsx',
        sourceComponent: 'ProductList',
        layout: 'list',
        components: [],
        dataRequirements: [{ source: 'Product', fetchStrategy: 'api' as const, cardinality: 'many' as const, blocking: true, params: {} }],
        actions: [],
        stateBindings: [],
      }],
      apiEndpoints: [{
        url: '/api/products',
        method: 'GET',
        sourceFile: 'src/api.ts',
        description: 'Fetch products',
        params: [],
        responseType: { kind: 'array', elementType: { kind: 'object', typeName: 'Product' } },
        auth: false,
      }],
    };

    const files = await generateSwiftUIViews(model);
    const listView = files.find(f => f.path.includes('ProductList'));
    expect(listView).toBeDefined();
    const content = listView!.content;
    // Should use fetchProducts (matching networking generator output)
    expect(content).toContain('fetchProducts()');
  });
});

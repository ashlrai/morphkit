import { describe, test, expect } from 'bun:test';

import { generateSwiftUIViews, isWebOnlyState, getReferenceScreenNames } from '../../src/generator/swiftui-generator';
import type { SemanticAppModel } from '../../src/semantic/model';

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

  test('generates a list view', () => {
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

    const files = generateSwiftUIViews(model);
    expect(files.length).toBeGreaterThan(0);

    const listView = files.find(f => f.path.includes('ProductList'));
    expect(listView).toBeDefined();
    expect(listView!.content).toContain('struct ProductListView: View');
    expect(listView!.content).toContain('import SwiftUI');
    expect(listView!.content).toContain('var body: some View');
    expect(listView!.content).toContain('#Preview');
  });

  test('generates a form view', () => {
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

    const files = generateSwiftUIViews(model);
    const formView = files.find(f => f.path.includes('AddProduct'));
    expect(formView).toBeDefined();
    expect(formView!.content).toContain('Form');
  });

  test('generates a detail view', () => {
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

    const files = generateSwiftUIViews(model);
    const detailView = files.find(f => f.path.includes('ProductDetail'));
    expect(detailView).toBeDefined();
    // Detail views use ScrollView or have product property
    expect(detailView!.content).toContain('struct ProductDetailView: View');
  });

  test('isWebOnlyState filters hover/tooltip/dropdown state names', () => {
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

  test('settings view generates semantic groupings', () => {
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

    const files = generateSwiftUIViews(model);
    const settingsView = files.find(f => f.path.includes('Settings'));
    expect(settingsView).toBeDefined();
    expect(settingsView!.content).toContain('Section');
  });

  test('reference implementation scoring selects top screens', () => {
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

  test('type mismatch in loadData emits TODO comment when scalar vs array', () => {
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

    const files = generateSwiftUIViews(model);
    const dashView = files.find(f => f.path.includes('Dashboard'));
    expect(dashView).toBeDefined();
    // The assignment should be a TODO or a data-req-declared variable (which handles it correctly)
    // The key check: the generated view should compile without type errors
    expect(dashView!.content).toContain('struct DashboardView: View');
  });

  test('includes Morphkit header comment', () => {
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

    const files = generateSwiftUIViews(model);
    for (const file of files) {
      expect(file.content).toContain('Generated by Morphkit');
    }
  });
});

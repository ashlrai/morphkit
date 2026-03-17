/**
 * Platform Adapter — maps web-specific patterns to iOS/SwiftUI equivalents.
 *
 * This is the "translation layer" that makes intelligent decisions about how
 * web concepts (React state, CSS layout, fetch calls, URL routing) should be
 * expressed in native iOS terms (SwiftUI views, @Observable stores,
 * NavigationStack, URLSession, etc.).
 *
 * Currently supports iOS only. The adapter runs BEFORE code generation so that
 * generators receive pre-decided platform mappings rather than making ad-hoc
 * translation choices.
 */

import type {
  SemanticAppModel,
  Screen,
  StatePattern,
  ApiEndpoint,
  NavigationFlow,
  ConfidenceLevel,
} from './model.js';

// ---------------------------------------------------------------------------
// iOS-specific configuration types
// ---------------------------------------------------------------------------

/** Top-level iOS navigation architecture. */
export interface iOSNavigationConfig {
  /** Primary navigation pattern */
  pattern: 'tab' | 'stack' | 'mixed';
  /** Tab bar items (present when pattern is 'tab' or 'mixed') */
  tabs?: { title: string; icon: string; screen: string }[];
  /** The root/initial route */
  rootRoute: string;
}

/** iOS state management architecture. */
export interface iOSStateConfig {
  /** Observable stores to generate */
  stores: {
    name: string;
    type: 'observable' | 'swiftdata' | 'appStorage';
    properties: {
      name: string;
      swiftType: string;
      wrapper: '@State' | '@Published' | '@AppStorage' | '@Binding' | 'var';
      defaultValue?: string;
    }[];
  }[];
  /** Mapping from web state names to iOS store names */
  stateMapping: Map<string, string>;
}

/** Mapping from a web component to a SwiftUI equivalent. */
export interface iOSComponentMapping {
  /** Primary SwiftUI view to use */
  swiftUIView: string;
  /** SwiftUI modifiers to apply */
  modifiers: string[];
  /** Optional wrapper view (e.g., NavigationStack, ScrollView) */
  wrapperView?: string;
}

/** iOS networking layer configuration. */
export interface iOSNetworkingConfig {
  /** Base URL for API requests */
  baseURL: string;
  /** Authentication strategy */
  authStrategy: 'bearer' | 'cookie' | 'none';
  /** Mapped API endpoints */
  endpoints: {
    method: string;
    path: string;
    swiftMethod: string;
  }[];
}

/** Extended model with iOS-specific annotations layered on top. */
export interface AdaptedModel extends SemanticAppModel {
  iosNavigation: iOSNavigationConfig;
  iosStateArchitecture: iOSStateConfig;
  iosUIMapping: Map<string, iOSComponentMapping>;
  iosNetworking: iOSNetworkingConfig;
}

// ---------------------------------------------------------------------------
// Navigation adaptation
// ---------------------------------------------------------------------------

/**
 * Map web navigation patterns to iOS navigation architecture.
 *
 * Decision rules:
 * - < 5 top-level routes → TabView
 * - Sidebar navigation → TabView with more items
 * - Nested routes → NavigationStack inside tabs
 * - Modals/dialogs → .sheet presentation
 * - URL params → NavigationPath values
 */
function adaptNavigation(
  navigation: NavigationFlow,
  screens: Screen[],
): iOSNavigationConfig {
  const topLevelRoutes = navigation.routes.filter(
    (r) => !r.path.includes('/:') || r.path.split('/').filter(Boolean).length <= 1,
  );

  const hasNestedRoutes = navigation.routes.some((r) => {
    const segments = r.path.split('/').filter(Boolean);
    return segments.length > 1 && !segments.some((s) => s.startsWith(':'));
  });

  // Determine pattern
  let pattern: iOSNavigationConfig['pattern'];
  if (navigation.type === 'tab') {
    pattern = 'tab';
  } else if (navigation.type === 'stack') {
    pattern = 'stack';
  } else if (topLevelRoutes.length < 5 && !hasNestedRoutes) {
    pattern = 'tab';
  } else if (topLevelRoutes.length < 5 && hasNestedRoutes) {
    pattern = 'mixed';
  } else if (topLevelRoutes.length <= 6) {
    pattern = 'tab';
  } else {
    pattern = 'mixed';
  }

  // Build tabs
  let tabs: iOSNavigationConfig['tabs'];
  if (pattern === 'tab' || pattern === 'mixed') {
    if (navigation.tabs.length > 0) {
      tabs = navigation.tabs.map((tab) => ({
        title: tab.label,
        icon: tab.icon,
        screen: tab.screen,
      }));
    } else {
      // Infer tabs from top-level routes
      tabs = topLevelRoutes.slice(0, 5).map((route) => ({
        title: route.screen,
        icon: suggestSFSymbol(route.screen),
        screen: route.screen,
      }));
    }

    // Ensure we don't exceed iOS tab bar limits (5 is standard, 6+ gets "More")
    if (tabs && tabs.length > 5) {
      // Keep top 4 and add a "More" tab
      const kept = tabs.slice(0, 4);
      kept.push({
        title: 'More',
        icon: 'ellipsis',
        screen: 'MoreMenu',
      });
      tabs = kept;
    }
  }

  const rootRoute = navigation.initialScreen || screens[0]?.name || 'Home';

  return { pattern, tabs, rootRoute };
}

// ---------------------------------------------------------------------------
// State adaptation
// ---------------------------------------------------------------------------

/**
 * Map web state management patterns to iOS state architecture.
 *
 * Mapping rules:
 * - useState (local) → @State
 * - useContext / Context providers → @Environment or @Observable class
 * - Redux/Zustand (global store) → @Observable singleton or SwiftData
 * - React Query/SWR (server state) → async/await + @Observable
 * - useReducer → @Observable with methods
 * - localStorage/sessionStorage → UserDefaults or @AppStorage
 */
function adaptState(statePatterns: StatePattern[]): iOSStateConfig {
  const stores: iOSStateConfig['stores'] = [];
  const stateMapping = new Map<string, string>();

  if (statePatterns.length === 0) {
    return { stores: [], stateMapping };
  }

  // Group state patterns by type for consolidation
  const localPatterns = statePatterns.filter((sp) => sp.type === 'local');
  const globalPatterns = statePatterns.filter((sp) => sp.type === 'global');
  const serverPatterns = statePatterns.filter((sp) => sp.type === 'server');

  // Global stores → @Observable singletons
  for (const sp of globalPatterns) {
    const storeName = toSwiftStoreName(sp.name);
    const storeType = determineStoreType(sp);

    const properties = buildStoreProperties(sp);
    stores.push({
      name: storeName,
      type: storeType,
      properties,
    });
    stateMapping.set(sp.name, storeName);
  }

  // Server state → @Observable with async methods
  for (const sp of serverPatterns) {
    const storeName = toSwiftStoreName(sp.name);

    const properties = buildStoreProperties(sp);
    // Add loading/error state for server patterns
    properties.push(
      { name: 'isLoading', swiftType: 'Bool', wrapper: 'var', defaultValue: 'false' },
      { name: 'error', swiftType: 'Error?', wrapper: 'var', defaultValue: 'nil' },
    );

    stores.push({
      name: storeName,
      type: 'observable',
      properties,
    });
    stateMapping.set(sp.name, storeName);
  }

  // Local state patterns are mapped per-screen (they become @State in views)
  // We still record the mapping for reference
  for (const sp of localPatterns) {
    stateMapping.set(sp.name, `@State ${sp.name}`);
  }

  return { stores, stateMapping };
}

/** Convert a web state name to a Swift store class name. */
function toSwiftStoreName(name: string): string {
  // Remove common prefixes/suffixes
  let clean = name
    .replace(/Store$|Slice$|Reducer$|Context$/i, '')
    .replace(/^use/i, '');

  // PascalCase + "Store" suffix
  clean = clean.charAt(0).toUpperCase() + clean.slice(1);
  return `${clean}Store`;
}

/** Determine the iOS store type based on the web state pattern. */
function determineStoreType(
  sp: StatePattern,
): 'observable' | 'swiftdata' | 'appStorage' {
  // localStorage/sessionStorage → appStorage
  if (
    sp.source === 'other' &&
    sp.name.toLowerCase().includes('storage')
  ) {
    return 'appStorage';
  }

  // If the state has complex relationships or persistence needs → swiftdata
  if (sp.mutations.length > 5 && sp.type === 'global') {
    return 'swiftdata';
  }

  // Default: @Observable
  return 'observable';
}

/** Build Swift property definitions from a state pattern's shape. */
function buildStoreProperties(
  sp: StatePattern,
): iOSStateConfig['stores'][0]['properties'] {
  if (!sp.shape || sp.shape.kind !== 'object' || !sp.shape.fields) {
    return [];
  }

  return sp.shape.fields.map((field) => ({
    name: field.name,
    swiftType: mapTypeToSwift(field.type),
    wrapper: sp.type === 'local' ? ('@State' as const) : ('var' as const),
    defaultValue: getSwiftDefault(field.type, field.optional),
  }));
}

/** Map a semantic TypeDefinition to a Swift type string. */
function mapTypeToSwift(type: { kind: string; typeName?: string; elementType?: any }): string {
  switch (type.kind) {
    case 'string':
      return 'String';
    case 'number':
      return 'Double';
    case 'boolean':
      return 'Bool';
    case 'date':
      return 'Date';
    case 'array':
      return `[${type.elementType ? mapTypeToSwift(type.elementType) : 'Any'}]`;
    case 'object':
      return type.typeName || 'Any';
    case 'enum':
      return type.typeName || 'String';
    case 'unknown':
    default:
      return 'Any';
  }
}

/** Get a Swift default value for a type. */
function getSwiftDefault(
  type: { kind: string },
  optional: boolean,
): string | undefined {
  if (optional) return 'nil';
  switch (type.kind) {
    case 'string':
      return '""';
    case 'number':
      return '0';
    case 'boolean':
      return 'false';
    case 'array':
      return '[]';
    case 'date':
      return 'Date()';
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// UI mapping
// ---------------------------------------------------------------------------

/**
 * Map web UI patterns to SwiftUI equivalents.
 *
 * Layout mapping:
 * - CSS Grid / Flexbox → Grid / HStack / VStack / LazyVGrid
 * - Tailwind spacing (p-4, m-2) → .padding() values
 * - Tailwind colors → SwiftUI Color extensions
 * - Tailwind typography → .font() modifiers
 * - CSS media queries → GeometryReader or @Environment(\.horizontalSizeClass)
 * - Web forms → SwiftUI Form with sections
 */
function adaptUI(screens: Screen[]): Map<string, iOSComponentMapping> {
  const mapping = new Map<string, iOSComponentMapping>();

  for (const screen of screens) {
    const componentMapping = mapScreenToSwiftUI(screen);
    mapping.set(screen.name, componentMapping);

    // Also map child components
    for (const comp of screen.components) {
      if (comp.name && !mapping.has(comp.name)) {
        mapping.set(comp.name, mapComponentRefToSwiftUI(
          { name: comp.name, count: comp.count ?? 'single', suggestedSwiftUI: comp.suggestedSwiftUI },
          screen.layout,
        ));
      }
    }
  }

  return mapping;
}

/** Map a screen's layout type to a SwiftUI view structure. */
function mapScreenToSwiftUI(screen: Screen): iOSComponentMapping {
  switch (screen.layout) {
    case 'list':
      return {
        swiftUIView: 'List',
        modifiers: ['.listStyle(.insetGrouped)', '.navigationTitle("\\"' + screen.name + '\\"")', '.searchable(text: $searchText)'],
        wrapperView: 'NavigationStack',
      };

    case 'grid':
      return {
        swiftUIView: 'LazyVGrid',
        modifiers: ['.padding()'],
        wrapperView: 'ScrollView',
      };

    case 'form':
      return {
        swiftUIView: 'Form',
        modifiers: ['.navigationTitle("' + screen.name + '")'],
        wrapperView: 'NavigationStack',
      };

    case 'detail':
      return {
        swiftUIView: 'ScrollView',
        modifiers: ['.navigationTitle("' + screen.name + '")', '.navigationBarTitleDisplayMode(.inline)'],
        wrapperView: 'NavigationStack',
      };

    case 'dashboard':
      return {
        swiftUIView: 'ScrollView',
        modifiers: ['.navigationTitle("' + screen.name + '")'],
        wrapperView: 'NavigationStack',
      };

    case 'settings':
      return {
        swiftUIView: 'Form',
        modifiers: ['.navigationTitle("Settings")'],
        wrapperView: 'NavigationStack',
      };

    case 'profile':
      return {
        swiftUIView: 'ScrollView',
        modifiers: ['.navigationTitle("Profile")'],
        wrapperView: 'NavigationStack',
      };

    case 'auth':
      return {
        swiftUIView: 'VStack',
        modifiers: ['.padding()', '.frame(maxWidth: .infinity, maxHeight: .infinity)'],
        wrapperView: undefined,
      };

    case 'onboarding':
      return {
        swiftUIView: 'TabView',
        modifiers: ['.tabViewStyle(.page)', '.indexViewStyle(.page(backgroundDisplayMode: .always))'],
        wrapperView: undefined,
      };

    case 'empty':
      return {
        swiftUIView: 'ContentUnavailableView',
        modifiers: [],
        wrapperView: undefined,
      };

    case 'custom':
    default:
      return {
        swiftUIView: 'VStack',
        modifiers: ['.padding()'],
        wrapperView: 'NavigationStack',
      };
  }
}

/** Map a child component reference to a SwiftUI view. */
function mapComponentRefToSwiftUI(
  comp: { name: string; count: string; suggestedSwiftUI?: string },
  parentLayout: string,
): iOSComponentMapping {
  // Use suggested SwiftUI component if available
  if (comp.suggestedSwiftUI) {
    return {
      swiftUIView: comp.suggestedSwiftUI,
      modifiers: [],
    };
  }

  const nameLower = comp.name.toLowerCase();

  // Card-like components
  if (nameLower.includes('card') || nameLower.includes('item') || nameLower.includes('cell')) {
    return {
      swiftUIView: comp.count === 'repeated' ? 'ForEach' : 'VStack',
      modifiers: [
        '.padding()',
        '.background(Color(.systemBackground))',
        '.cornerRadius(12)',
        '.shadow(radius: 2)',
      ],
    };
  }

  // Button-like components
  if (nameLower.includes('button') || nameLower.includes('cta')) {
    return {
      swiftUIView: 'Button',
      modifiers: ['.buttonStyle(.borderedProminent)'],
    };
  }

  // Input-like components
  if (nameLower.includes('input') || nameLower.includes('field') || nameLower.includes('textfield')) {
    return {
      swiftUIView: 'TextField',
      modifiers: ['.textFieldStyle(.roundedBorder)'],
    };
  }

  // Search components
  if (nameLower.includes('search')) {
    return {
      swiftUIView: 'TextField',
      modifiers: ['.textFieldStyle(.roundedBorder)', '.overlay(alignment: .trailing) { Image(systemName: "magnifyingglass") }'],
    };
  }

  // Header/banner components
  if (nameLower.includes('header') || nameLower.includes('banner') || nameLower.includes('hero')) {
    return {
      swiftUIView: 'VStack',
      modifiers: ['.padding()', '.frame(maxWidth: .infinity)'],
    };
  }

  // Navigation/menu components
  if (nameLower.includes('nav') || nameLower.includes('menu') || nameLower.includes('sidebar')) {
    return {
      swiftUIView: 'List',
      modifiers: ['.listStyle(.sidebar)'],
    };
  }

  // Modal/dialog components
  if (nameLower.includes('modal') || nameLower.includes('dialog') || nameLower.includes('popup')) {
    return {
      swiftUIView: 'VStack',
      modifiers: ['.padding()', '.presentationDetents([.medium, .large])'],
      wrapperView: '.sheet',
    };
  }

  // Loading/skeleton components
  if (nameLower.includes('loading') || nameLower.includes('skeleton') || nameLower.includes('spinner')) {
    return {
      swiftUIView: 'ProgressView',
      modifiers: [],
    };
  }

  // Image/avatar components
  if (nameLower.includes('image') || nameLower.includes('avatar') || nameLower.includes('thumbnail')) {
    return {
      swiftUIView: 'AsyncImage',
      modifiers: ['.frame(width: 44, height: 44)', '.clipShape(Circle())'],
    };
  }

  // Default: generic VStack
  return {
    swiftUIView: 'VStack',
    modifiers: ['.padding()'],
  };
}

// ---------------------------------------------------------------------------
// Networking adaptation
// ---------------------------------------------------------------------------

/**
 * Map web networking patterns to iOS equivalents.
 *
 * Data mapping:
 * - fetch/axios → URLSession async/await
 * - API routes → direct API calls (skip BFF layer)
 * - Web sockets → URLSessionWebSocketTask
 * - GraphQL → Apollo iOS or custom
 */
function adaptNetworking(
  apiEndpoints: ApiEndpoint[],
  auth: SemanticAppModel['auth'],
): iOSNetworkingConfig {
  if (apiEndpoints.length === 0) {
    return {
      baseURL: '',
      authStrategy: 'none',
      endpoints: [],
    };
  }

  // Determine base URL
  const baseURL = inferBaseURL(apiEndpoints);

  // Determine auth strategy
  let authStrategy: iOSNetworkingConfig['authStrategy'] = 'none';
  if (auth) {
    switch (auth.type) {
      case 'jwt':
        authStrategy = 'bearer';
        break;
      case 'session':
        authStrategy = 'cookie';
        break;
      case 'oauth':
        authStrategy = 'bearer';
        break;
      case 'api-key':
        authStrategy = 'bearer';
        break;
      default:
        authStrategy = apiEndpoints.some((e) => e.auth) ? 'bearer' : 'none';
    }
  } else if (apiEndpoints.some((e) => e.auth)) {
    authStrategy = 'bearer';
  }

  // Map endpoints to Swift method names
  const endpoints = apiEndpoints.map((ep) => ({
    method: ep.method,
    path: ep.url,
    swiftMethod: generateSwiftMethodName(ep),
  }));

  return { baseURL, authStrategy, endpoints };
}

/** Infer a common base URL from all API endpoints. */
function inferBaseURL(endpoints: ApiEndpoint[]): string {
  const urls = endpoints.map((e) => e.url);
  if (urls.length === 0) return '';

  // Check for absolute URLs
  const absoluteUrls = urls.filter((u) => u.startsWith('http'));
  if (absoluteUrls.length > 0) {
    try {
      const parsed = new URL(absoluteUrls[0]);
      return `${parsed.protocol}//${parsed.host}`;
    } catch {
      // fall through
    }
  }

  // For relative URLs, find the common prefix
  const segments = urls.map((u) => u.split('/').filter(Boolean));
  if (segments.length === 0) return '/api';

  const commonSegments: string[] = [];
  const firstSegments = segments[0];

  for (let i = 0; i < firstSegments.length; i++) {
    const seg = firstSegments[i];
    // Stop at dynamic segments
    if (seg.startsWith(':') || seg.startsWith('{') || seg.startsWith('[')) break;
    if (segments.every((s) => s[i] === seg)) {
      commonSegments.push(seg);
    } else {
      break;
    }
  }

  return commonSegments.length > 0 ? '/' + commonSegments.join('/') : '/api';
}

/** Generate a Swift method name for an API endpoint. */
function generateSwiftMethodName(endpoint: ApiEndpoint): string {
  const pathSegments = endpoint.url
    .split('/')
    .filter(Boolean)
    .filter((s) => !s.startsWith(':') && !s.startsWith('{') && !s.startsWith('['));

  // Remove common API prefixes
  const filtered = pathSegments.filter(
    (s) => s !== 'api' && s !== 'v1' && s !== 'v2' && s !== 'v3',
  );

  const resource = filtered.length > 0
    ? filtered.map((s, i) => (i === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1))).join('')
    : 'resource';

  const hasIdParam = endpoint.url.includes(':id') || endpoint.url.includes('{id}') || endpoint.url.includes('[id]');

  switch (endpoint.method) {
    case 'GET':
      return hasIdParam ? `fetch${capitalize(resource)}` : `fetchAll${capitalize(resource)}`;
    case 'POST':
      return `create${capitalize(resource)}`;
    case 'PUT':
    case 'PATCH':
      return `update${capitalize(resource)}`;
    case 'DELETE':
      return `delete${capitalize(resource)}`;
  }
}

/** Capitalize the first letter of a string. */
function capitalize(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Suggest an SF Symbol name for a given label.
 * Mirrors the builder's version but kept here to avoid cross-module dependency.
 */
function suggestSFSymbol(label: string): string {
  const lower = label.toLowerCase();
  const symbolMap: Record<string, string> = {
    home: 'house.fill',
    dashboard: 'square.grid.2x2.fill',
    search: 'magnifyingglass',
    explore: 'safari.fill',
    profile: 'person.fill',
    account: 'person.circle.fill',
    settings: 'gearshape.fill',
    notifications: 'bell.fill',
    messages: 'message.fill',
    chat: 'bubble.left.and.bubble.right.fill',
    favorites: 'heart.fill',
    cart: 'cart.fill',
    orders: 'bag.fill',
    products: 'square.grid.2x2.fill',
    analytics: 'chart.bar.fill',
    history: 'clock.fill',
    feed: 'list.bullet',
    more: 'ellipsis',
  };

  for (const [key, symbol] of Object.entries(symbolMap)) {
    if (lower.includes(key)) return symbol;
  }

  return 'circle.fill';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Adapt a SemanticAppModel for iOS code generation.
 *
 * This function maps web-specific patterns to their iOS/SwiftUI equivalents,
 * annotating the model with platform-specific configuration that generators
 * can consume directly. It handles navigation mapping, state architecture
 * translation, UI component mapping, and networking adaptation.
 *
 * @param model - The platform-agnostic SemanticAppModel
 * @param platform - Target platform (currently only 'ios' is supported)
 * @returns An AdaptedModel with iOS-specific annotations
 *
 * @example
 * ```typescript
 * const model = await buildSemanticModel(analysisResult);
 * const adapted = adaptForPlatform(model, 'ios');
 * // adapted.iosNavigation, adapted.iosStateArchitecture, etc.
 * ```
 */
export function adaptForPlatform(
  model: SemanticAppModel,
  platform: 'ios',
): AdaptedModel {
  if (platform !== 'ios') {
    throw new Error(`Unsupported platform: ${platform}. Only 'ios' is currently supported.`);
  }

  // 1. Adapt navigation
  const iosNavigation = adaptNavigation(model.navigation, model.screens);

  // 2. Adapt state management
  const iosStateArchitecture = adaptState(model.stateManagement);

  // 3. Adapt UI components
  const iosUIMapping = adaptUI(model.screens);

  // 4. Adapt networking
  const iosNetworking = adaptNetworking(model.apiEndpoints, model.auth);

  return {
    ...model,
    iosNavigation,
    iosStateArchitecture,
    iosUIMapping,
    iosNetworking,
  };
}

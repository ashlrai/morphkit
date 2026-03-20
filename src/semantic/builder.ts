/**
 * Semantic Model Builder
 *
 * Takes raw output from all analyzers (repo scanner, component extractor,
 * route extractor, state analyzer, API analyzer) and constructs a unified
 * SemanticAppModel — the core intermediate representation that bridges
 * web analysis and iOS code generation.
 *
 * Uses the Grok AI client for intent extraction when code purpose is ambiguous.
 */

import * as fs from 'fs';
import * as path from 'path';

import type { GrokClient} from '../ai/index.js';
import { getGrokClient as getClient } from '../ai/index.js';
import type { ExtractedComponentInfo } from '../ai/prompts/component-mapping.js';
import { createAIProvider } from '../ai/provider.js';
import type { AIProvider , AIProviderConfig, AIProviderName } from '../ai/provider.js';
import type { SwiftUIMapping } from '../ai/structured-output.js';
import type { ExtractedApi } from '../analyzer/api-extractor.js';
import type { ParsedFile, TypeProperty } from '../analyzer/ast-parser.js';
import type { ExtractedComponent } from '../analyzer/component-extractor.js';
import type { RepoScanResult } from '../analyzer/repo-scanner.js';
import type { ExtractedRoute } from '../analyzer/route-extractor.js';
import type { ExtractedState } from '../analyzer/state-extractor.js';

import type {
  SemanticAppModel,
  Screen,
  NavigationFlow,
  StatePattern,
  ApiEndpoint,
  AuthPattern,
  ThemeConfig,
  Entity,
  Route,
  TabItem,
  ConfidenceLevel,
  LayoutType,
  ComponentRef,
  DataRequirement,
  UserAction,
  TypeDefinition,
} from './model.js';


// Re-export the analyzer types so consumers can reference them
export type { ExtractedComponent } from '../analyzer/component-extractor.js';
export type { ExtractedRoute } from '../analyzer/route-extractor.js';
export type { ExtractedState } from '../analyzer/state-extractor.js';
export type { ExtractedApi } from '../analyzer/api-extractor.js';

// ---------------------------------------------------------------------------
// Analyzer Output Types (aggregated from all extractors)
// ---------------------------------------------------------------------------

/**
 * Aggregated result from all analyzers — input to the semantic builder.
 * Matches the AnalysisResult from analyzer/index.ts.
 */
export interface AnalysisResult {
  scanResult: RepoScanResult;
  parsedFiles: ParsedFile[];
  components: ExtractedComponent[];
  routes: ExtractedRoute[];
  statePatterns: ExtractedState[];
  apiEndpoints: ExtractedApi[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Attempt to get a GrokClient instance. Returns null if the AI module
 * is not configured (e.g., no API key). The builder degrades gracefully
 * by falling back to heuristic-based extraction.
 */
function getGrokClientSafe(): GrokClient | null {
  // Allow explicit opt-out via environment variable
  if (process.env.MORPHKIT_NO_AI === '1' || process.env.MORPHKIT_NO_AI === 'true') {
    return null;
  }

  // Only attempt AI if the API key is configured
  if (!process.env.XAI_API_KEY) {
    return null;
  }

  try {
    const client = getClient();
    return client;
  } catch (_err) {
    return null;
  }
}

/**
 * Detect and create an AIProvider from environment variables.
 * Checks for an explicit provider setting first, then auto-detects
 * from available API keys (Claude > OpenAI > Grok).
 *
 * Returns null if AI is disabled or no API keys are available.
 */
async function getAIProviderSafe(): Promise<AIProvider | null> {
  // Allow explicit opt-out
  if (process.env.MORPHKIT_NO_AI === '1' || process.env.MORPHKIT_NO_AI === 'true') {
    console.log('[morphkit] Using heuristic analysis (AI disabled via --no-ai)');
    return null;
  }

  // Check for explicit provider setting
  const explicitProvider = process.env.MORPHKIT_AI_PROVIDER as AIProviderName | undefined;
  const explicitModel = process.env.MORPHKIT_AI_MODEL;

  // Build config from explicit setting or auto-detect
  let config: AIProviderConfig | null = null;

  if (explicitProvider && explicitProvider !== 'none' as any) {
    const keyMap: Record<AIProviderName, string | undefined> = {
      claude: process.env.ANTHROPIC_API_KEY,
      grok: process.env.XAI_API_KEY,
      openai: process.env.OPENAI_API_KEY,
    };
    const apiKey = keyMap[explicitProvider];
    if (!apiKey) {
      console.log(`[morphkit] Using heuristic analysis (${explicitProvider} provider selected but no API key found)`);
      return null;
    }
    config = { provider: explicitProvider, apiKey, model: explicitModel };
  } else {
    // Auto-detect: check keys in priority order
    if (process.env.ANTHROPIC_API_KEY) {
      config = { provider: 'claude', apiKey: process.env.ANTHROPIC_API_KEY, model: explicitModel };
    } else if (process.env.OPENAI_API_KEY) {
      config = { provider: 'openai', apiKey: process.env.OPENAI_API_KEY, model: explicitModel };
    } else if (process.env.XAI_API_KEY) {
      config = { provider: 'grok', apiKey: process.env.XAI_API_KEY, model: explicitModel };
    }
  }

  if (!config) {
    console.log('[morphkit] Using heuristic analysis (set ANTHROPIC_API_KEY, OPENAI_API_KEY, or XAI_API_KEY for AI-enhanced results)');
    return null;
  }

  try {
    const provider = await createAIProvider(config);
    console.log(`[morphkit] AI-enhanced analysis enabled (provider: ${provider.name}${explicitModel ? `, model: ${explicitModel}` : ''})`);
    return provider;
  } catch (err) {
    console.log(`[morphkit] Using heuristic analysis (AI provider initialization failed: ${sanitizeErrorMessage(err)})`);
    return null;
  }
}

/** Default timeout for AI calls (ms). Prevents the pipeline from hanging. */
const AI_CALL_TIMEOUT_MS = 30_000;

/**
 * Sanitize an error message to ensure API keys are never leaked in logs.
 * Strips any occurrence of common key patterns (xai-*, sk-*, Bearer tokens).
 */
function sanitizeErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  // Redact API key patterns: xai-..., sk-..., Bearer tokens
  return msg.replace(/\b(xai-|sk-|Bearer\s+)[A-Za-z0-9_-]{8,}/g, '$1[REDACTED]');
}

/**
 * Convert an ExtractedComponent into the ExtractedComponentInfo shape
 * needed by the component mapping AI prompt.
 */
function toComponentInfo(
  component: ExtractedComponent,
  sourceCode: string,
): ExtractedComponentInfo {
  return {
    name: component.name,
    jsxElements: component.children.map((c) => c.name),
    cssClasses: [], // CSS classes are not extracted at the component level; the AI infers from source
    hooks: component.hooks.map((h) => h.hookName),
    eventHandlers: component.eventHandlers.map((h) => h.name),
    props: component.props.map((p) => ({ name: p.name, type: p.type ?? 'unknown' })),
    stateVariables: component.hooks
      .filter((h) => h.hookName === 'useState')
      .map((h) => ({ name: h.stateName ?? h.hookName, initialValue: h.initialValue ?? '' })),
    uxPatterns: [],
    sourceCode,
  };
}

/**
 * Call the AI for component mapping and return the result, or null on failure.
 * Wraps the call in try/catch + timeout so it never breaks the pipeline.
 */
async function aiMapComponent(
  aiClient: GrokClient,
  component: ExtractedComponent,
  sourceCode: string,
): Promise<SwiftUIMapping | null> {
  try {
    const info = await toComponentInfo(component, sourceCode);
    const result = await withAITimeout(aiClient.mapComponent({ component: info }));
    return result;
  } catch (err) {
    console.warn(`[morphkit] AI component mapping failed for ${component.name}, using heuristics:`, sanitizeErrorMessage(err));
    return null;
  }
}

/**
 * Run an async AI call with a timeout. Returns null if the call exceeds the limit.
 */
async function withAITimeout<T>(
  promise: Promise<T>,
  timeoutMs: number = AI_CALL_TIMEOUT_MS,
): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    const result = await Promise.race([promise, timeout]);
    return result;
  } finally {
    clearTimeout(timer!);
  }
}

/** Check whether a route path contains dynamic params like :id or [id]. */
function routeHasDynamicParams(routePath: string): boolean {
  return routePath.includes(':') || /\[(?!\.{3})/.test(routePath);
}

/**
 * Infer a layout type from component structure, route path, and state bindings.
 * Uses multiple signal sources to avoid defaulting everything to 'custom'.
 * When AI is available and heuristics return 'custom', tries the AI provider for a better answer.
 */
async function inferLayout(
  component: ExtractedComponent,
  routePath?: string,
  statePatterns?: ExtractedState[],
  aiClient?: GrokClient | null,
  appName?: string,
  aiProvider?: AIProvider | null,
): Promise<LayoutType> {
  const children = component.children.map((c) => c.name).join(' ').toLowerCase();
  const name = component.name.toLowerCase();

  // --- 1. Strong signals from component name ---
  if (name.includes('form') || name.includes('addproduct') || name.includes('create') || name.includes('edit')) return 'form';
  if (name.includes('grid') || children.includes('grid')) return 'grid';
  if (name.includes('list')) return 'list';
  if (name.includes('dashboard') || name.includes('overview') || name.includes('home')) return 'dashboard';
  if (name.includes('detail') || name.includes('single')) return 'detail';
  if (name.includes('setting') || name.includes('preference')) return 'settings';
  if (name.includes('profile') || name.includes('account')) return 'profile';
  if (name.includes('login') || name.includes('signup') || name.includes('register') || name.includes('auth')) return 'auth';
  if (name.includes('onboard') || name.includes('welcome') || name.includes('intro')) return 'onboarding';

  // --- 2. Route path signals ---
  if (routePath) {
    const hasDynamic = routeHasDynamicParams(routePath);
    if (hasDynamic) return 'detail';

    // Single-segment paths like /products, /cart, /orders → likely list
    const staticSegments = routePath.split('/').filter(Boolean).filter((s) => !s.startsWith(':') && !s.startsWith('['));
    if (staticSegments.length === 1) {
      const seg = staticSegments[0]!.toLowerCase();
      if (seg === 'home' || seg === 'dashboard') return 'dashboard';
      // Most single-segment routes are collection pages
      return 'list';
    }
  }

  // --- 3. Child component name patterns ---
  if (children.includes('card') || children.includes('tile') || children.includes('item')) return 'grid';
  if (children.includes('row') || children.includes('listitem')) return 'list';
  if (children.includes('input') || children.includes('field') || children.includes('textarea') || children.includes('select')) return 'form';

  // --- 4. State binding signals — array state suggests list/grid ---
  if (statePatterns) {
    const componentState = statePatterns.filter((sp) => sp.ownerName === component.name);
    for (const sp of componentState) {
      if (sp.useState) {
        const typeStr = (sp.useState.type || '').toLowerCase();
        if (typeStr.endsWith('[]') || typeStr.startsWith('array<')) return 'list';
      }
    }
    // Heavy filtering/sorting state → list
    const filterSortHooks = componentState.filter((sp) => {
      if (!sp.useState) return false;
      const v = sp.useState.variableName.toLowerCase();
      return v.includes('filter') || v.includes('sort') || v.includes('search') || v.includes('page') || v.includes('query');
    });
    if (filterSortHooks.length >= 2) return 'list';
  }

  // --- 5. Props clues ---
  const propsStr = component.props.map((p) => p.name).join(' ').toLowerCase();
  if (propsStr.includes('items') || propsStr.includes('data') || propsStr.includes('list')) return 'list';

  // --- 6. Hook clues ---
  const hookNames = component.hooks.map((h) => h.hookName).join(' ').toLowerCase();
  if (hookNames.includes('useform')) return 'form';

  // --- 7. AI fallback for ambiguous components ---
  // Prefer the new provider-agnostic interface; fall back to legacy GrokClient
  if (aiProvider) {
    try {
      const context = `App: ${appName ?? 'App'}. Route: ${routePath ?? 'none'}. Determine the most appropriate iOS layout type.`;
      const intent = await withAITimeout(aiProvider.analyzeIntent(
        {
          name: component.name,
          props: component.props.map((p) => p.name),
          children: component.children.map((c) => c.name),
          hooks: component.hooks.map((h) => h.hookName),
        },
        context,
      ));
      if (intent) {
        const aiLayout = mapPurposeToLayout(intent.purpose);
        if (aiLayout !== 'custom') {
          return aiLayout;
        }
      }
    } catch (err) {
      console.warn('[morphkit] AI layout inference failed, using heuristic fallback:', sanitizeErrorMessage(err));
    }
  } else if (aiClient) {
    try {
      const intent = await withAITimeout(aiClient.analyzeIntent({
        code: `// Component: ${component.name}\n// Props: ${component.props.map((p) => p.name).join(', ')}\n// Children: ${component.children.map((c) => c.name).join(', ')}`,
        appContext: {
          appName: appName ?? 'App',
          domain: 'unknown',
          additionalContext: `Route: ${routePath ?? 'none'}. Determine the most appropriate iOS layout type for this component.`,
        },
      }));
      if (intent) {
        const aiLayout = mapSuggestedPatternToLayout(intent.suggestedIOSPattern);
        if (aiLayout !== 'custom') {
          return aiLayout;
        }
      }
    } catch (err) {
      console.warn('[morphkit] AI layout inference failed, using heuristic fallback:', sanitizeErrorMessage(err));
    }
  }

  return 'custom';
}

/**
 * Map an AI-suggested iOS pattern string to a LayoutType.
 * The AI returns freeform pattern descriptions like "List with searchable modifier".
 * We extract the dominant layout signal from that.
 */
function mapSuggestedPatternToLayout(pattern: string): LayoutType {
  const lower = pattern.toLowerCase();
  if (lower.includes('list') || lower.includes('foreach')) return 'list';
  if (lower.includes('form')) return 'form';
  if (lower.includes('grid') || lower.includes('lazyvgrid') || lower.includes('lazyhgrid')) return 'grid';
  if (lower.includes('detail') || lower.includes('scrollview')) return 'detail';
  if (lower.includes('dashboard') || lower.includes('widget')) return 'dashboard';
  if (lower.includes('tab')) return 'dashboard';
  if (lower.includes('setting') || lower.includes('preference')) return 'settings';
  if (lower.includes('profile') || lower.includes('account')) return 'profile';
  if (lower.includes('login') || lower.includes('auth') || lower.includes('sign')) return 'auth';
  if (lower.includes('onboard') || lower.includes('welcome')) return 'onboarding';
  return 'custom';
}

/**
 * Map an AI-generated purpose description to a LayoutType.
 * Used with the provider-agnostic AIProvider.analyzeIntent which returns
 * a purpose string rather than the Grok-specific suggestedIOSPattern.
 */
function mapPurposeToLayout(purpose: string): LayoutType {
  const lower = purpose.toLowerCase();
  if (lower.includes('list') || lower.includes('catalog') || lower.includes('browse') || lower.includes('feed')) return 'list';
  if (lower.includes('form') || lower.includes('edit') || lower.includes('create') || lower.includes('input')) return 'form';
  if (lower.includes('grid') || lower.includes('gallery')) return 'grid';
  if (lower.includes('detail') || lower.includes('view ') || lower.includes('single')) return 'detail';
  if (lower.includes('dashboard') || lower.includes('overview') || lower.includes('summary')) return 'dashboard';
  if (lower.includes('setting') || lower.includes('preference') || lower.includes('configuration')) return 'settings';
  if (lower.includes('profile') || lower.includes('account')) return 'profile';
  if (lower.includes('login') || lower.includes('auth') || lower.includes('sign')) return 'auth';
  if (lower.includes('onboard') || lower.includes('welcome') || lower.includes('intro')) return 'onboarding';
  return 'custom';
}

/** Build a TypeDefinition from a simple type string. */
function typeFromString(typeStr: string): TypeDefinition {
  const normalized = typeStr.trim().toLowerCase();
  if (normalized === 'string') return { kind: 'string' };
  if (normalized === 'number' || normalized === 'int' || normalized === 'float') return { kind: 'number' };
  if (normalized === 'boolean' || normalized === 'bool') return { kind: 'boolean' };
  if (normalized === 'date') return { kind: 'date' };
  if (normalized.endsWith('[]') || normalized.startsWith('array<')) {
    const elementStr = normalized.endsWith('[]')
      ? normalized.slice(0, -2)
      : normalized.slice(6, -1);
    return { kind: 'array', elementType: typeFromString(elementStr) };
  }
  if (normalized === 'unknown' || normalized === 'any' || normalized === 'void' || normalized === '') {
    return { kind: 'unknown' };
  }
  return { kind: 'object', typeName: typeStr, inferred: true };
}

/**
 * Suggest an SF Symbol name for a given tab/screen label.
 * This is a best-effort heuristic mapping.
 */
function suggestSFSymbol(label: string): string {
  const lower = label.toLowerCase();

  const symbolMap: Record<string, string> = {
    home: 'house.fill',
    dashboard: 'square.grid.2x2.fill',
    search: 'magnifyingglass',
    explore: 'safari.fill',
    discover: 'sparkle.magnifyingglass',
    profile: 'person.fill',
    account: 'person.circle.fill',
    settings: 'gearshape.fill',
    preferences: 'slider.horizontal.3',
    notifications: 'bell.fill',
    messages: 'message.fill',
    chat: 'bubble.left.and.bubble.right.fill',
    favorites: 'heart.fill',
    bookmarks: 'bookmark.fill',
    cart: 'cart.fill',
    orders: 'bag.fill',
    products: 'square.grid.2x2.fill',
    analytics: 'chart.bar.fill',
    history: 'clock.fill',
    feed: 'list.bullet',
    calendar: 'calendar',
    map: 'map.fill',
    more: 'ellipsis',
  };

  for (const [key, symbol] of Object.entries(symbolMap)) {
    if (lower.includes(key)) return symbol;
  }

  return 'circle.fill';
}

/** Determine the top-level navigation pattern based on route structure. */
function inferNavigationPattern(routes: ExtractedRoute[]): 'tab' | 'stack' | 'mixed' {
  // Top-level routes are those with no parent
  const topLevelRoutes = routes.filter((r) => r.parentPath === undefined);
  const hasNestedRoutes = routes.some((r) => r.childPaths.length > 0);

  if (topLevelRoutes.length === 0) return 'stack';
  if (topLevelRoutes.length < 5 && !hasNestedRoutes) return 'tab';
  if (topLevelRoutes.length < 5 && hasNestedRoutes) return 'mixed';
  if (topLevelRoutes.length <= 6) return 'tab';

  return 'mixed';
}

/** Convert a route path to a human-readable screen name, disambiguating detail routes. */
function routePathToScreenName(routePath: string): string {
  const allSegments = routePath.split('/').filter(Boolean);
  const staticSegments = allSegments.filter((s) => !s.startsWith(':') && !s.startsWith('['));
  const hasDynamic = routeHasDynamicParams(routePath);

  if (staticSegments.length === 0 && !hasDynamic) return 'Home';
  if (staticSegments.length === 0 && hasDynamic) return 'Detail';

  const baseName = staticSegments
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('');

  // Append "Detail" for routes with dynamic params to avoid duplicates
  // e.g. /products → "Products", /products/:id → "ProductsDetail"
  if (hasDynamic) {
    return baseName + 'Detail';
  }

  return baseName;
}

// ---------------------------------------------------------------------------
// Mapping helpers: analyzer types -> builder-compatible shapes
// ---------------------------------------------------------------------------

/** Map an ExtractedState's kind to a StatePattern source value. */
function mapStateSource(
  kind: ExtractedState['kind'],
): StatePattern['source'] {
  switch (kind) {
    case 'useState': return 'useState';
    case 'useReducer': return 'useReducer';
    case 'context': return 'context';
    case 'zustand': return 'zustand';
    case 'redux-slice': return 'redux';
    case 'react-query': return 'tanstack-query';
    case 'swr': return 'swr';
    case 'other': return 'other';
  }
}

/** Map an ExtractedState's scope to a StatePattern type value. */
function mapStateType(scope: ExtractedState['scope']): StatePattern['type'] {
  switch (scope) {
    case 'local': return 'local';
    case 'shared': return 'global';
    case 'global': return 'global';
  }
}

/**
 * Extract shape fields from an ExtractedState.
 * Different state kinds store shape info differently.
 */
function extractStateShape(sp: ExtractedState): { name: string; type: string }[] {
  if (sp.zustand) {
    return sp.zustand.stateProperties.map((name) => ({ name, type: 'unknown' }));
  }
  if (sp.redux) {
    return sp.redux.stateProperties.map((name) => ({ name, type: 'unknown' }));
  }
  if (sp.useState) {
    return [{ name: sp.useState.variableName, type: sp.useState.type || 'unknown' }];
  }
  if (sp.useReducer) {
    return [{ name: sp.useReducer.stateName, type: 'unknown' }];
  }
  if (sp.context) {
    return [{ name: sp.context.contextName, type: sp.context.valueShape || 'unknown' }];
  }
  return [];
}

/**
 * Extract mutation names from an ExtractedState.
 */
function extractStateMutations(sp: ExtractedState): { name: string; payload?: string }[] {
  if (sp.zustand) {
    return sp.zustand.actions.map((name) => ({ name }));
  }
  if (sp.redux) {
    return sp.redux.actions.map((name) => ({ name }));
  }
  if (sp.useReducer) {
    return sp.useReducer.actionTypes.map((name) => ({ name }));
  }
  if (sp.useState) {
    return [{ name: sp.useState.setterName }];
  }
  return [];
}

/** Get a display name for the state pattern. */
function getStateName(sp: ExtractedState): string {
  if (sp.zustand) return sp.zustand.storeName;
  if (sp.redux) return sp.redux.sliceName;
  if (sp.context) return sp.context.contextName;
  if (sp.useState) return sp.useState.variableName;
  if (sp.useReducer) return sp.useReducer.stateName;
  return sp.ownerName;
}

/** Get consumer names from an ExtractedState. */
function getStateConsumers(sp: ExtractedState): string[] {
  // The analyzer's ExtractedState doesn't track consumers directly;
  // we return the owner as a consumer by default
  return [sp.ownerName];
}

/**
 * Get the URL and method from an ExtractedApi.
 */
function getApiUrlAndMethod(api: ExtractedApi): { url: string; method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' } {
  if (api.fetch) {
    const method = normalizeHttpMethod(api.fetch.method);
    return { url: api.fetch.url, method };
  }
  if (api.axios) {
    const method = normalizeHttpMethod(api.axios.method);
    return { url: api.axios.url, method };
  }
  if (api.nextApiRoute) {
    const method = api.nextApiRoute.methods.length > 0
      ? normalizeHttpMethod(api.nextApiRoute.methods[0])
      : 'GET';
    return { url: api.nextApiRoute.urlPath, method };
  }
  if (api.serverAction) {
    return { url: `/actions/${api.serverAction.name}`, method: 'POST' };
  }
  // Fallback
  return { url: '/unknown', method: 'GET' };
}

/** Normalize HTTP method from extended set to the model's supported set. */
function normalizeHttpMethod(method: string): 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' {
  switch (method.toUpperCase()) {
    case 'GET': return 'GET';
    case 'POST': return 'POST';
    case 'PUT': return 'PUT';
    case 'PATCH': return 'PATCH';
    case 'DELETE': return 'DELETE';
    default: return 'GET';
  }
}

// ---------------------------------------------------------------------------
// Theme extraction helpers
// ---------------------------------------------------------------------------

/** Build a default theme config. Analyzers may enhance this later. */
function buildDefaultTheme(): ThemeConfig {
  return {
    colors: {
      primary: '#3B82F6',
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
    spacing: {
      unit: 4,
      values: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, '2xl': 48 },
    },
    borderRadius: { none: 0, sm: 4, md: 8, lg: 12, xl: 16, full: 9999 },
    supportsDarkMode: false,
  };
}

/**
 * Attempt to extract theme information from the scan result.
 * Looks for Tailwind config, CSS variables, or theme files.
 *
 * When a Tailwind config is present, reads its raw text and regex-extracts
 * color definitions from `theme.extend.colors` (or `theme.colors`).
 * Recognized color names: brand, primary, accent — the first match found
 * is used as the primary color in the generated theme.
 */
function extractThemeFromScan(scanResult: RepoScanResult): ThemeConfig {
  const theme = buildDefaultTheme();

  // Mark dark mode support if Tailwind is detected (it usually supports dark mode)
  if (scanResult.hasTailwind) {
    theme.supportsDarkMode = true;
  }

  // Try to extract colors from the Tailwind config file
  if (scanResult.hasTailwind) {
    const tailwindConfig = scanResult.configs.find((f) =>
      path.basename(f.relativePath).startsWith('tailwind.config'),
    );

    if (tailwindConfig) {
      try {
        const configText = fs.readFileSync(tailwindConfig.absolutePath, 'utf-8');
        const extractedColor = extractTailwindPrimaryColor(configText);
        if (extractedColor) {
          theme.colors.primary = extractedColor;
          theme.colors.accent = extractedColor;
        }
      } catch {
        // If we can't read the config, fall through to defaults
      }
    }
  }

  return theme;
}

/**
 * Regex-extract a primary/brand/accent color hex value from raw Tailwind
 * config text. Works with both JS and TS config files.
 *
 * Searches for common color key names in order of priority:
 *   1. `primary`
 *   2. `brand`
 *   3. `accent`
 *
 * Returns the first hex color found, or `null` if none match.
 */
function extractTailwindPrimaryColor(configText: string): string | null {
  // Order matters — primary takes precedence over brand over accent
  const colorNames = ['primary', 'brand', 'accent'];

  for (const name of colorNames) {
    // Match patterns like:  brand: '#6366f1'  or  brand: "#6366f1"  or  "brand": "#6366f1"
    // Also handles optional quotes around the key and flexible whitespace
    const pattern = new RegExp(
      `['"]?${name}['"]?\\s*:\\s*['"]?(#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?)`,
    );
    const match = configText.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Auth detection
// ---------------------------------------------------------------------------

/** Detect authentication patterns from routes, APIs, and components. */
function detectAuthPattern(
  routes: ExtractedRoute[],
  apis: ExtractedApi[],
  components: ExtractedComponent[],
): AuthPattern | null {
  // Check for auth-related API calls
  const authApis = apis.filter((a) => {
    const { url } = getApiUrlAndMethod(a);
    return url.toLowerCase().includes('auth') || url.toLowerCase().includes('login') || url.toLowerCase().includes('signin');
  });

  // Look for auth-related components
  const authComponents = components.filter((c) => {
    const name = c.name.toLowerCase();
    return (
      name.includes('login') ||
      name.includes('signup') ||
      name.includes('register') ||
      name.includes('auth') ||
      name.includes('forgot')
    );
  });

  // If no auth signals found, return null
  if (authApis.length === 0 && authComponents.length === 0) {
    return null;
  }

  // Build auth flows from detected components
  const flows: AuthPattern['flows'] = [];

  const loginComponents = authComponents.filter((c) =>
    c.name.toLowerCase().includes('login'),
  );
  if (loginComponents.length > 0) {
    flows.push({
      name: 'login',
      screens: loginComponents.map((c) => c.name),
      endpoints: authApis
        .filter((a) => {
          const { url } = getApiUrlAndMethod(a);
          return url.toLowerCase().includes('login') || url.toLowerCase().includes('signin');
        })
        .map((a) => {
          const { method, url } = getApiUrlAndMethod(a);
          return `${method} ${url}`;
        }),
      description: 'User login flow',
    });
  }

  const signupComponents = authComponents.filter((c) => {
    const name = c.name.toLowerCase();
    return name.includes('signup') || name.includes('register');
  });
  if (signupComponents.length > 0) {
    flows.push({
      name: 'signup',
      screens: signupComponents.map((c) => c.name),
      endpoints: authApis
        .filter((a) => {
          const { url } = getApiUrlAndMethod(a);
          return url.toLowerCase().includes('signup') || url.toLowerCase().includes('register');
        })
        .map((a) => {
          const { method, url } = getApiUrlAndMethod(a);
          return `${method} ${url}`;
        }),
      description: 'User registration flow',
    });
  }

  // Determine auth type heuristically
  const allUrls = apis.map((a) => getApiUrlAndMethod(a).url.toLowerCase());
  const hasOAuthHints = allUrls.some(
    (u) => u.includes('oauth') || u.includes('callback'),
  );

  const authType: AuthPattern['type'] = hasOAuthHints ? 'oauth' : 'jwt';

  return {
    type: authType,
    provider: null,
    flows,
    storageStrategy: 'localStorage',
    confidence: authComponents.length > 0 ? 'medium' : 'low',
  };
}

// ---------------------------------------------------------------------------
// Screen building
// ---------------------------------------------------------------------------

/**
 * Build Screen definitions by merging component data with route data.
 * Routes with page files become screens, matched to components by file path.
 */
async function buildScreens(
  components: ExtractedComponent[],
  routes: ExtractedRoute[],
  statePatterns: ExtractedState[],
  apis: ExtractedApi[],
  aiClient: GrokClient | null,
  appName?: string,
  aiProvider?: AIProvider | null,
): Promise<Screen[]> {
  const componentByFile = new Map<string, ExtractedComponent>();
  for (const comp of components) {
    componentByFile.set(comp.filePath, comp);
  }

  const screens: Screen[] = [];
  const processedComponents = new Set<string>();

  // First pass: create screens from routes that have a page file
  for (const route of routes) {
    if (!route.files.page) continue;

    // Try to find the component for this route's page file
    const component = componentByFile.get(route.files.page);
    if (!component) continue;

    processedComponents.add(component.name);

    const screen = await buildScreenFromRouteAndComponent(
      route,
      component,
      statePatterns,
      apis,
      aiClient,
      appName,
      aiProvider,
    );
    screens.push(screen);
  }

  // Second pass: create screens from page-level components that aren't in routes
  for (const comp of components) {
    if (processedComponents.has(comp.name)) continue;
    if (comp.category !== 'page') continue;

    const screen = await buildScreenFromComponent(comp, statePatterns, apis, aiClient, appName, aiProvider);
    screens.push(screen);
  }

  // Mark entry points
  if (screens.length > 0) {
    const homeScreen = screens.find(
      (s) =>
        s.name === 'Home' ||
        s.name.toLowerCase().includes('home') ||
        s.name.toLowerCase().includes('dashboard'),
    );
    if (homeScreen) {
      homeScreen.isEntryPoint = true;
    } else {
      // Default: first screen is entry point
      screens[0].isEntryPoint = true;
    }
  }

  return screens;
}

/** Build a Screen from a matched route + component pair. */
async function buildScreenFromRouteAndComponent(
  route: ExtractedRoute,
  component: ExtractedComponent,
  statePatterns: ExtractedState[],
  apis: ExtractedApi[],
  aiClient?: GrokClient | null,
  appName?: string,
  aiProvider?: AIProvider | null,
): Promise<Screen> {
  const screenName = routePathToScreenName(route.urlPath);
  const layout = await inferLayout(component, route.urlPath, statePatterns, aiClient, appName, aiProvider);

  // Find state patterns related to this component
  const stateBindings = statePatterns
    .filter((sp) => sp.ownerName === component.name)
    .map((sp) => getStateName(sp));

  // Find API calls made by this component
  const componentApis = apis.filter((a) => a.ownerName === component.name);

  // Build data requirements from direct API calls
  const dataRequirements: DataRequirement[] = [];

  for (const api of componentApis) {
    const { method, url } = getApiUrlAndMethod(api);
    dataRequirements.push({
      source: `${method} ${url}`,
      fetchStrategy: 'api',
      cardinality: method === 'GET' ? 'many' : 'one',
      blocking: method === 'GET',
      params: {},
    });
  }

  // Add data requirements from server-state hooks (react-query, swr, fetch in useEffect)
  const componentState = statePatterns.filter((sp) => sp.ownerName === component.name);
  for (const sp of componentState) {
    if (sp.serverState) {
      const source = sp.serverState.fetchFn || sp.serverState.queryKey || sp.serverState.hookName;
      const alreadyAdded = dataRequirements.some((dr) => dr.source === source);
      if (!alreadyAdded) {
        dataRequirements.push({
          source,
          fetchStrategy: 'api',
          cardinality: 'many',
          blocking: true,
          params: {},
        });
      }
    }
    // useState with array type → data requirement from local/derived state
    if (sp.useState) {
      const typeStr = (sp.useState.type || '').toLowerCase();
      if (typeStr.endsWith('[]') || typeStr.startsWith('array<')) {
        const entityName = sp.useState.type!.replace(/\[\]$/, '').replace(/^Array</, '').replace(/>$/, '');
        if (entityName && /^[A-Z]/.test(entityName)) {
          const alreadyAdded = dataRequirements.some((dr) => dr.source === entityName);
          if (!alreadyAdded) {
            dataRequirements.push({
              source: entityName,
              fetchStrategy: 'local',
              cardinality: 'many',
              blocking: false,
              params: {},
            });
          }
        }
      }
    }
    // Zustand/Redux stores → context-based data requirements
    if (sp.zustand || sp.redux) {
      const storeName = sp.zustand ? sp.zustand.storeName : sp.redux!.sliceName;
      const alreadyAdded = dataRequirements.some((dr) => dr.source === storeName);
      if (!alreadyAdded) {
        dataRequirements.push({
          source: storeName,
          fetchStrategy: 'context',
          cardinality: 'many',
          blocking: false,
          params: {},
        });
      }
    }
  }

  // Build child component references
  const componentRefs: ComponentRef[] = component.children.map((child) => ({
    name: child.name,
    props: {},
    count: child.count > 1 ? ('repeated' as const) : ('single' as const),
  }));

  // Build user actions from event handlers
  const actions: UserAction[] = component.eventHandlers.map((handler) => {
    const isSubmit = handler.name.toLowerCase().includes('submit');
    const isDelete = handler.name.toLowerCase().includes('delete') || handler.name.toLowerCase().includes('remove');
    const isNavigate = handler.name.toLowerCase().includes('navigate') || handler.name.toLowerCase().includes('goto');

    let effectType: 'navigate' | 'apiCall' | 'mutate' | 'other';
    if (isNavigate) {
      effectType = 'navigate';
    } else if (isSubmit) {
      effectType = 'apiCall';
    } else if (isDelete) {
      effectType = 'mutate';
    } else {
      effectType = 'other';
    }

    return {
      label: handler.name.replace(/^handle|^on/, '').replace(/([A-Z])/g, ' $1').trim(),
      trigger: isSubmit ? ('submit' as const) : ('tap' as const),
      effect: {
        type: effectType,
        target: handler.name,
        payload: {},
      },
      destructive: isDelete,
      requiresAuth: false,
    };
  });

  // Build base screen with heuristic defaults
  const screen: Screen = {
    name: screenName,
    description: `Screen for ${route.urlPath}`,
    purpose: `Renders the ${screenName} view at route ${route.urlPath}`,
    sourceFile: component.filePath,
    sourceComponent: component.name,
    layout,
    components: componentRefs,
    dataRequirements,
    actions,
    stateBindings,
    isEntryPoint: false,
    confidence: 'medium',
  };

  // Enhance with AI — prefer provider-agnostic interface, fall back to legacy GrokClient
  if (aiProvider) {
    // 1. Intent analysis via provider-agnostic interface
    try {
      const context = `App: ${appName ?? 'App'}. Route: ${route.urlPath}. Analyze this component's purpose and data needs.`;
      const intent = await withAITimeout(aiProvider.analyzeIntent(
        {
          name: component.name,
          props: component.props.map((p) => p.name),
          children: component.children.map((c) => c.name),
          hooks: component.hooks.map((h) => h.hookName),
        },
        context,
      ));
      if (intent) {
        screen.purpose = intent.purpose;
        screen.description = intent.purpose;
        if (screen.layout === 'custom') {
          const aiLayout = mapPurposeToLayout(intent.purpose);
          if (aiLayout !== 'custom') {
            screen.layout = aiLayout;
          }
        }
        screen.confidence = 'high';
      }
    } catch (err) {
      console.warn(`[morphkit] AI intent analysis failed for ${screenName}, using heuristics:`, sanitizeErrorMessage(err));
    }

    // 2. Component mapping via provider-agnostic interface
    try {
      const mapResult = await withAITimeout(aiProvider.mapComponent(
        {
          name: component.name,
          jsxElements: component.children.map((c) => c.name),
          props: component.props.map((p) => p.name),
        },
        'ios',
      ));
      if (mapResult && screen.components.length > 0) {
        screen.components[0]!.suggestedSwiftUI = mapResult.swiftUIView;
      }
    } catch (err) {
      console.warn(`[morphkit] AI component mapping failed for ${screenName}, using heuristics:`, sanitizeErrorMessage(err));
    }
  } else if (aiClient) {
    const componentCode = await readComponentSource(component.filePath);

    // 1. Intent analysis — understand what the component does and why
    try {
      const intent = await withAITimeout(aiClient.analyzeIntent({
        code: componentCode,
        appContext: {
          appName: appName ?? 'App',
          domain: 'unknown',
          knownRoutes: [route.urlPath],
        },
      }));
      if (intent) {
        screen.purpose = intent.purpose;
        screen.description = intent.purpose;
        if (screen.layout === 'custom') {
          const aiLayout = mapSuggestedPatternToLayout(intent.suggestedIOSPattern);
          if (aiLayout !== 'custom') {
            screen.layout = aiLayout;
          }
        }
        screen.confidence = 'high';
      }
    } catch (err) {
      console.warn(`[morphkit] AI intent analysis failed for ${screenName}, using heuristics:`, sanitizeErrorMessage(err));
    }

    // 2. Component mapping — get SwiftUI mapping suggestions
    const mapping = await aiMapComponent(aiClient, component, componentCode);
    if (mapping) {
      if (screen.components.length > 0) {
        screen.components[0]!.suggestedSwiftUI = mapping.swiftUIComponent;
      }
    }
  }

  return screen;
}

/**
 * Read a component's source file for AI analysis.
 * Returns a truncated version to stay within token limits.
 */
async function readComponentSource(filePath: string): Promise<string> {
  try {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    // Truncate to ~4000 chars to stay within reasonable token limits
    return content.length > 4000 ? content.slice(0, 4000) + '\n// ... (truncated)' : content;
  } catch {
    return `// Source file not readable: ${filePath}`;
  }
}

/** Build a Screen from a standalone page component (no matching route). */
async function buildScreenFromComponent(
  component: ExtractedComponent,
  statePatterns: ExtractedState[],
  apis: ExtractedApi[],
  aiClient?: GrokClient | null,
  appName?: string,
  aiProvider?: AIProvider | null,
): Promise<Screen> {
  const layout = await inferLayout(component, undefined, statePatterns, aiClient, appName, aiProvider);
  const stateBindings = statePatterns
    .filter((sp) => sp.ownerName === component.name)
    .map((sp) => getStateName(sp));

  const componentApis = apis.filter((a) => a.ownerName === component.name);

  const dataRequirements: DataRequirement[] = componentApis.map((api) => {
    const { method, url } = getApiUrlAndMethod(api);
    return {
      source: `${method} ${url}`,
      fetchStrategy: 'api' as const,
      cardinality: method === 'GET' ? ('many' as const) : ('one' as const),
      blocking: method === 'GET',
      params: {},
    };
  });

  // Add data requirements from server-state hooks
  const componentState = statePatterns.filter((sp) => sp.ownerName === component.name);
  for (const sp of componentState) {
    if (sp.serverState) {
      const source = sp.serverState.fetchFn || sp.serverState.queryKey || sp.serverState.hookName;
      const alreadyAdded = dataRequirements.some((dr) => dr.source === source);
      if (!alreadyAdded) {
        dataRequirements.push({
          source,
          fetchStrategy: 'api',
          cardinality: 'many',
          blocking: true,
          params: {},
        });
      }
    }
    if (sp.zustand || sp.redux) {
      const storeName = sp.zustand ? sp.zustand.storeName : sp.redux!.sliceName;
      const alreadyAdded = dataRequirements.some((dr) => dr.source === storeName);
      if (!alreadyAdded) {
        dataRequirements.push({
          source: storeName,
          fetchStrategy: 'context',
          cardinality: 'many',
          blocking: false,
          params: {},
        });
      }
    }
  }

  const screen: Screen = {
    name: component.name,
    description: `Screen derived from component ${component.name}`,
    purpose: `Renders the ${component.name} view`,
    sourceFile: component.filePath,
    sourceComponent: component.name,
    layout,
    components: component.children.map((c) => ({
      name: c.name,
      props: {},
      count: c.count > 1 ? ('repeated' as const) : ('single' as const),
    })),
    dataRequirements,
    actions: [],
    stateBindings,
    isEntryPoint: false,
    confidence: 'low',
  };

  // Enhance with AI — prefer provider-agnostic interface, fall back to legacy GrokClient
  if (aiProvider) {
    try {
      const context = `App: ${appName ?? 'App'}. Analyze this standalone component's purpose and data needs.`;
      const intent = await withAITimeout(aiProvider.analyzeIntent(
        {
          name: component.name,
          props: component.props.map((p) => p.name),
          children: component.children.map((c) => c.name),
          hooks: component.hooks.map((h) => h.hookName),
        },
        context,
      ));
      if (intent) {
        screen.purpose = intent.purpose;
        screen.description = intent.purpose;
        if (screen.layout === 'custom') {
          const aiLayout = mapPurposeToLayout(intent.purpose);
          if (aiLayout !== 'custom') {
            screen.layout = aiLayout;
          }
        }
        screen.confidence = 'medium';
      }
    } catch (err) {
      console.warn(`[morphkit] AI intent analysis failed for ${component.name}, using heuristics:`, sanitizeErrorMessage(err));
    }

    try {
      const mapResult = await withAITimeout(aiProvider.mapComponent(
        {
          name: component.name,
          jsxElements: component.children.map((c) => c.name),
          props: component.props.map((p) => p.name),
        },
        'ios',
      ));
      if (mapResult && screen.components.length > 0) {
        screen.components[0]!.suggestedSwiftUI = mapResult.swiftUIView;
      }
    } catch (err) {
      console.warn(`[morphkit] AI component mapping failed for ${component.name}, using heuristics:`, sanitizeErrorMessage(err));
    }
  } else if (aiClient) {
    const componentCode = await readComponentSource(component.filePath);

    // 1. Intent analysis
    try {
      const intent = await withAITimeout(aiClient.analyzeIntent({
        code: componentCode,
        appContext: {
          appName: appName ?? 'App',
          domain: 'unknown',
        },
      }));
      if (intent) {
        screen.purpose = intent.purpose;
        screen.description = intent.purpose;
        if (screen.layout === 'custom') {
          const aiLayout = mapSuggestedPatternToLayout(intent.suggestedIOSPattern);
          if (aiLayout !== 'custom') {
            screen.layout = aiLayout;
          }
        }
        screen.confidence = 'medium';
      }
    } catch (err) {
      console.warn(`[morphkit] AI intent analysis failed for ${component.name}, using heuristics:`, sanitizeErrorMessage(err));
    }

    // 2. Component mapping
    const mapping = await aiMapComponent(aiClient, component, componentCode);
    if (mapping) {
      if (screen.components.length > 0) {
        screen.components[0]!.suggestedSwiftUI = mapping.swiftUIComponent;
      }
    }
  }

  return screen;
}

// ---------------------------------------------------------------------------
// Navigation building
// ---------------------------------------------------------------------------

/** Build NavigationFlow from extracted routes and inferred screens. */
function buildNavigation(
  routes: ExtractedRoute[],
  screens: Screen[],
): NavigationFlow {
  const pattern = inferNavigationPattern(routes);

  // Build route entries from the extracted routes
  const routeEntries: Route[] = routes
    .filter((r) => r.files.page !== undefined)
    .map((r) => {
      const params = r.segments
        .filter((s) => s.kind === 'dynamic' || s.kind === 'catch-all')
        .map((s) => s.paramName ?? s.name);

      return {
        path: r.urlPath,
        screen: routePathToScreenName(r.urlPath),
        params,
        guards: [],
      };
    });

  // Build tabs for tab-based navigation
  const tabs: TabItem[] = [];
  if (pattern === 'tab' || pattern === 'mixed') {
    const topLevelRoutes = routes.filter((r) => r.parentPath === undefined && r.files.page !== undefined);
    for (const route of topLevelRoutes) {
      const screenName = routePathToScreenName(route.urlPath);
      const label = screenName || 'Home';
      tabs.push({
        label,
        icon: suggestSFSymbol(label),
        screen: screenName,
      });
    }
  }

  // Determine initial screen
  const entryScreen = screens.find((s) => s.isEntryPoint);
  const initialScreen = entryScreen?.name ?? screens[0]?.name ?? 'Home';

  return {
    type: pattern === 'stack' ? 'stack' : pattern === 'tab' ? 'tab' : 'mixed',
    routes: routeEntries,
    tabs,
    deepLinks: [],
    initialScreen,
  };
}

// ---------------------------------------------------------------------------
// State management building
// ---------------------------------------------------------------------------

/** Convert extracted state patterns to semantic StatePattern entries. */
function buildStateManagement(
  statePatterns: ExtractedState[],
): StatePattern[] {
  return statePatterns.map((sp) => {
    const shape = extractStateShape(sp);
    const mutations = extractStateMutations(sp);

    // Deduplicate shape fields by name
    const seenFieldNames = new Set<string>();
    const uniqueShape = shape.filter((field) => {
      if (seenFieldNames.has(field.name)) return false;
      seenFieldNames.add(field.name);
      return true;
    });

    return {
      name: getStateName(sp),
      type: mapStateType(sp.scope),
      shape: {
        kind: 'object' as const,
        fields: uniqueShape.map((field) => ({
          name: field.name,
          type: typeFromString(field.type),
          optional: false,
          description: '',
          isPrimaryKey: false,
        })),
        inferred: true,
      },
      mutations: mutations.map((m) => ({
        name: m.name,
        payload: m.payload ? typeFromString(m.payload) : null,
        description: '',
        optimistic: false,
      })),
      source: mapStateSource(sp.kind),
      consumers: getStateConsumers(sp),
      confidence: 'medium' as ConfidenceLevel,
    };
  });
}

// ---------------------------------------------------------------------------
// API endpoint building
// ---------------------------------------------------------------------------

/** Convert extracted API calls to semantic ApiEndpoint entries. */
function buildApiEndpoints(apis: ExtractedApi[]): ApiEndpoint[] {
  // Deduplicate by method + URL
  const seen = new Set<string>();
  const endpoints: ApiEndpoint[] = [];

  for (const api of apis) {
    const { method, url } = getApiUrlAndMethod(api);
    const key = `${method} ${url}`;
    if (seen.has(key)) continue;
    seen.add(key);

    endpoints.push({
      url,
      method,
      headers: {},
      requestBody: api.requestType ? typeFromString(api.requestType) : null,
      responseType: api.responseType
        ? typeFromString(api.responseType)
        : { kind: 'unknown' as const },
      auth: false, // Could be enhanced with auth detection
      caching: (api.kind === 'react-query' || api.kind === 'swr')
        ? { type: 'stale-while-revalidate' as const, ttlSeconds: null, invalidateOn: [] }
        : null,
      description: '',
      sourceFile: api.filePath,
      confidence: 'medium' as ConfidenceLevel,
    });
  }

  return endpoints;
}

// ---------------------------------------------------------------------------
// Entity extraction
// ---------------------------------------------------------------------------

/**
 * Check if a name looks like a state variable rather than a real data entity.
 * State variables are things like isLoading, searchQuery, added, etc.
 */
function isStateVariableName(name: string): boolean {
  // Starts with common state-variable prefixes (isLoading, hasError, showModal, etc.)
  if (/^(is|has|show|should|can|did|will)[A-Z]/.test(name)) return true;

  // Common state variable names (case-insensitive check)
  const lower = name.toLowerCase();
  const stateVarNames = [
    'added', 'loading', 'error', 'selected', 'search', 'sort', 'filter',
    'query', 'open', 'visible', 'active', 'disabled', 'checked', 'expanded',
    'collapsed', 'searchquery', 'sortorder', 'selectedcategory', 'isloading',
    'count', 'total', 'page', 'pagenumber', 'pagesize', 'currentpage',
    'offset', 'limit', 'hasmore', 'hasnext', 'hasprevious',
    'mounted', 'ready', 'initialized', 'value', 'text', 'input',
    'message', 'status', 'result', 'show', 'hide', 'toggle',
  ];
  if (stateVarNames.includes(lower)) return true;

  return false;
}

/** Deduplicate entity fields by name, keeping the first occurrence. */
function deduplicateFields(
  fields: { name: string; type: TypeDefinition; optional: boolean; description: string; isPrimaryKey: boolean }[],
): typeof fields {
  const seen = new Set<string>();
  return fields.filter((f) => {
    if (seen.has(f.name)) return false;
    seen.add(f.name);
    return true;
  });
}

// ---------------------------------------------------------------------------
// TypeScript type definition → Entity conversion
// ---------------------------------------------------------------------------

/**
 * Convert a raw TS type string (from the AST parser) into a semantic
 * TypeDefinition used by the model. Handles primitives, arrays, unions
 * with null/undefined (marking optionality), Date, and complex types.
 *
 * Returns `{ typeDef, isOptionalFromUnion }` so the caller can merge
 * optionality from union types (e.g. `string | null`) with the property's
 * own `?` token.
 */
function tsTypeStringToTypeDef(raw: string): { typeDef: TypeDefinition; isOptionalFromUnion: boolean } {
  let typeStr = raw.trim();
  let isOptionalFromUnion = false;

  // Handle union types that include null / undefined → mark optional
  if (typeStr.includes('|')) {
    const parts = typeStr.split('|').map((p) => p.trim()).filter(Boolean);
    const nonNullParts = parts.filter((p) => p !== 'null' && p !== 'undefined');
    if (nonNullParts.length < parts.length) {
      isOptionalFromUnion = true;
    }
    if (nonNullParts.length === 1) {
      typeStr = nonNullParts[0]!;
    } else if (nonNullParts.length > 1) {
      // Genuine union type (not just T | null)
      return {
        typeDef: {
          kind: 'union',
          values: nonNullParts,
          inferred: false,
        },
        isOptionalFromUnion,
      };
    } else {
      // All parts were null/undefined — unlikely but handle gracefully
      return { typeDef: { kind: 'unknown', inferred: true }, isOptionalFromUnion: true };
    }
  }

  // Strip parentheses that ts-morph sometimes adds
  typeStr = typeStr.replace(/^\((.+)\)$/, '$1').trim();

  const lower = typeStr.toLowerCase();

  // Primitives
  if (lower === 'string') return { typeDef: { kind: 'string' }, isOptionalFromUnion };
  if (lower === 'number') return { typeDef: { kind: 'number' }, isOptionalFromUnion };
  if (lower === 'boolean') return { typeDef: { kind: 'boolean' }, isOptionalFromUnion };
  if (lower === 'date') return { typeDef: { kind: 'date' }, isOptionalFromUnion };

  // Array forms: T[] and Array<T>
  if (typeStr.endsWith('[]')) {
    const inner = typeStr.slice(0, -2).trim();
    const { typeDef: elementType } = tsTypeStringToTypeDef(inner);
    return { typeDef: { kind: 'array', elementType }, isOptionalFromUnion };
  }
  const arrayMatch = typeStr.match(/^Array<(.+)>$/i);
  if (arrayMatch) {
    const { typeDef: elementType } = tsTypeStringToTypeDef(arrayMatch[1]!);
    return { typeDef: { kind: 'array', elementType }, isOptionalFromUnion };
  }

  // Everything else → object with typeName
  return {
    typeDef: { kind: 'object', typeName: typeStr, inferred: false },
    isOptionalFromUnion,
  };
}

/**
 * Convert TypeScript interface / type-alias definitions from parsed files
 * into Entity objects with fully-typed fields.
 *
 * Exported interfaces/types with 2+ properties become struct entities.
 * Exported type aliases that are string literal unions (e.g.
 * `type SortOrder = 'price-asc' | 'price-desc' | 'name'`) become enum
 * entities — a single field named `__enum` with kind 'enum' and the values.
 */
function entitiesFromTypeDefinitions(parsedFiles: ParsedFile[]): Map<string, Entity> {
  const entityMap = new Map<string, Entity>();

  for (const pf of parsedFiles) {
    for (const td of pf.types) {
      if (!td.isExported) continue;

      // --- String literal union type aliases → enum entities ---
      // e.g. type SortOrder = 'price-asc' | 'price-desc' | 'name' | 'rating'
      // These have kind 'type-alias' and text containing string literals
      // separated by |.  Note: ts-morph may resolve string union types and
      // report string prototype properties, so we match on text pattern
      // rather than relying on properties.length === 0.
      if (td.kind === 'type-alias') {
        const stringUnionMatch = td.text.match(/=\s*((?:'[^']*'(?:\s*\|\s*)?)+)\s*;?\s*$/);
        if (stringUnionMatch) {
          const valuesRaw = stringUnionMatch[1];
          const values = valuesRaw.split('|').map((v) => v.trim().replace(/^'|'$/g, '')).filter(Boolean);
          if (values.length >= 2) {
            entityMap.set(td.name, {
              name: td.name,
              description: `Enum from TypeScript string union type "${td.name}"`,
              fields: [{
                name: '__enum',
                type: { kind: 'enum', values, typeName: td.name },
                optional: false,
                description: '',
                isPrimaryKey: false,
              }],
              sourceFile: pf.filePath,
              relationships: [],
              confidence: 'high',
            });
            continue;
          }
        }
      }

      // --- Struct entities: interfaces / type aliases with 2+ properties ---
      if (td.properties.length < 2) continue;

      // Skip names that look like state variables or React utility types
      if (isStateVariableName(td.name)) continue;
      if (/Props$|State$|Context$|Ref$|Config$|Options$|Params$|Result$/.test(td.name)) continue;

      const fields = td.properties.map((prop: TypeProperty) => {
        const { typeDef, isOptionalFromUnion } = tsTypeStringToTypeDef(prop.type);
        return {
          name: prop.name,
          type: typeDef,
          optional: prop.isOptional || isOptionalFromUnion,
          description: '',
          isPrimaryKey: prop.name === 'id',
        };
      });

      entityMap.set(td.name, {
        name: td.name,
        description: `Data entity from TypeScript ${td.kind} "${td.name}"`,
        fields: deduplicateFields(fields),
        sourceFile: pf.filePath,
        relationships: [],
        confidence: 'high',
      });
    }
  }

  return entityMap;
}

/**
 * Infer entities from TypeScript type definitions, component props, API response
 * types, and state shapes.  Entities represent the core data objects in the
 * application.
 *
 * TypeScript interfaces/types take precedence because they carry explicit field
 * types.  State-inferred or API-inferred entities are only added when there is
 * no matching TS type definition.
 *
 * Filters out state variables (booleans, single-field primitives) and keeps
 * only entities that look like real data models (multiple fields, noun-like names).
 */
function inferEntities(
  components: ExtractedComponent[],
  statePatterns: ExtractedState[],
  apis: ExtractedApi[],
  parsedFiles: ParsedFile[],
): Entity[] {
  // Start with entities derived from TypeScript type definitions — these have
  // explicit field types and take precedence over inferred entities.
  const entityMap = entitiesFromTypeDefinitions(parsedFiles);

  // Extract entities from state pattern shapes (skip if already defined by TS types)
  for (const sp of statePatterns) {
    const shape = extractStateShape(sp);
    if (shape.length > 0) {
      const stateName = getStateName(sp);
      const entityName = stateName.charAt(0).toUpperCase() + stateName.slice(1);

      // Skip entities that look like simple state variables
      if (isStateVariableName(entityName)) continue;

      // Skip entities with 0-1 fields (likely a primitive state value, not a data model)
      if (shape.length <= 1) continue;

      if (!entityMap.has(entityName)) {
        const candidateFields = deduplicateFields(
          shape.map((field) => ({
            name: field.name,
            type: typeFromString(field.type),
            optional: false,
            description: '',
            isPrimaryKey: field.name === 'id',
          })),
        );

        // Skip state-derived entities that are poorly typed (>50% unknown fields)
        // when a better-typed entity with overlapping name/fields already exists.
        // This avoids creating redundant "UseCartStore" entities when "Cart"/"CartItem"
        // already exist from TS interface extraction.
        const unknownCount = candidateFields.filter(
          (f) => f.type.kind === 'unknown' || f.type.typeName === 'unknown',
        ).length;
        const isPoorlyTyped = candidateFields.length > 0 && unknownCount / candidateFields.length > 0.5;

        if (isPoorlyTyped) {
          const candidateFieldNames = new Set(candidateFields.map((f) => f.name.toLowerCase()));
          // Strip common hook/store prefixes/suffixes for name matching
          const strippedName = entityName.replace(/^Use/i, '').replace(/Store$/i, '');
          let hasOverlap = false;
          for (const [existingName, existingEntity] of entityMap) {
            // Name overlap check
            if (strippedName && strippedName.length >= 3 &&
                (existingName.toLowerCase().includes(strippedName.toLowerCase()) ||
                 strippedName.toLowerCase().includes(existingName.toLowerCase()))) {
              hasOverlap = true;
              break;
            }
            // Field overlap: >50% of candidate fields exist in the existing entity
            const existingFieldNames = new Set((existingEntity.fields ?? []).map((f) => f.name.toLowerCase()));
            const overlapCount = [...candidateFieldNames].filter((n) => existingFieldNames.has(n)).length;
            if (candidateFields.length > 0 && overlapCount / candidateFields.length > 0.5) {
              hasOverlap = true;
              break;
            }
          }
          if (hasOverlap) continue; // Skip this poorly-typed duplicate entity
        }

        entityMap.set(entityName, {
          name: entityName,
          description: `Data entity derived from ${sp.kind} state "${stateName}"`,
          fields: candidateFields,
          sourceFile: sp.filePath,
          relationships: [],
          confidence: 'medium',
        });
      }
    }
  }

  // Extract entities from useState with array types that reference PascalCase models.
  // Only create a new entity if no TS interface entity already exists with that name.
  // If a TS interface entity exists (even with few fields), prefer it over an empty placeholder.
  for (const sp of statePatterns) {
    if (!sp.useState) continue;
    const typeStr = sp.useState.type || '';
    if (typeStr.endsWith('[]') || typeStr.startsWith('Array<')) {
      const elementType = typeStr.endsWith('[]')
        ? typeStr.slice(0, -2)
        : typeStr.slice(6, -1);
      if (elementType && /^[A-Z]/.test(elementType) && !isStateVariableName(elementType)) {
        // Only create if no entity with this name already exists
        // (an existing entity from TS interfaces already has proper fields)
        if (!entityMap.has(elementType)) {
          // Also check case-insensitive match against existing entities
          const existingMatch = [...entityMap.keys()].find(k => k.toLowerCase() === elementType.toLowerCase());
          if (!existingMatch) {
            entityMap.set(elementType, {
              name: elementType,
              description: `Data entity inferred from useState type "${typeStr}" in ${sp.ownerName}`,
              fields: [],
              sourceFile: sp.filePath,
              relationships: [],
              confidence: 'low',
            });
          }
        }
      }
    }
  }

  // Extract entities from API response type hints (all API kinds, not just fetch).
  // Same merge-first approach: only create empty placeholders if no TS interface exists.
  for (const api of apis) {
    if (api.responseType) {
      const entityName = api.responseType.replace(/\[\]$/, '').replace(/^Array</, '').replace(/>$/, '');
      if (entityName && /^[A-Z]/.test(entityName) && !isStateVariableName(entityName)) {
        if (!entityMap.has(entityName)) {
          const existingMatch = [...entityMap.keys()].find(k => k.toLowerCase() === entityName.toLowerCase());
          if (!existingMatch) {
            entityMap.set(entityName, {
              name: entityName,
              description: `Data entity inferred from API response at ${getApiUrlAndMethod(api).url}`,
              fields: [],
              sourceFile: api.filePath,
              relationships: [],
              confidence: 'low',
            });
          }
        }
      }
    }
  }

  // Extract entities from component prop types (PascalCase array/object props).
  // Same approach — don't create empty placeholders when a real entity exists.
  for (const comp of components) {
    for (const prop of comp.props) {
      const typeStr = prop.type || '';
      if (typeStr.endsWith('[]') || typeStr.startsWith('Array<')) {
        const elementType = typeStr.endsWith('[]')
          ? typeStr.slice(0, -2)
          : typeStr.slice(6, -1);
        if (elementType && /^[A-Z]/.test(elementType) && !isStateVariableName(elementType)) {
          if (!entityMap.has(elementType)) {
            const existingMatch = [...entityMap.keys()].find(k => k.toLowerCase() === elementType.toLowerCase());
            if (!existingMatch) {
              entityMap.set(elementType, {
                name: elementType,
                description: `Data entity inferred from prop "${prop.name}" on component ${comp.name}`,
                fields: [],
                sourceFile: comp.filePath,
                relationships: [],
                confidence: 'low',
              });
            }
          }
        }
      } else if (/^[A-Z][a-zA-Z]+$/.test(typeStr) && !isStateVariableName(typeStr)) {
        if (!entityMap.has(typeStr)) {
          const existingMatch = [...entityMap.keys()].find(k => k.toLowerCase() === typeStr.toLowerCase());
          if (!existingMatch) {
            entityMap.set(typeStr, {
              name: typeStr,
              description: `Data entity inferred from prop "${prop.name}" on component ${comp.name}`,
              fields: [],
              sourceFile: comp.filePath,
              relationships: [],
              confidence: 'low',
            });
          }
        }
      }
    }
  }

  // Back-fill pass: enrich entities that only have a synthetic `id` field
  // by looking up their name against ALL type definitions (including non-exported
  // and types with < 2 properties that were skipped by entitiesFromTypeDefinitions).
  const allTypeDefs = new Map<string, { properties: TypeProperty[], sourceFile: string }>();
  for (const pf of parsedFiles) {
    for (const td of pf.types) {
      if (td.properties.length >= 1) {
        allTypeDefs.set(td.name.toLowerCase(), { properties: td.properties, sourceFile: pf.filePath });
      }
    }
  }

  for (const [, entity] of entityMap) {
    // Only back-fill entities with 0-1 fields (empty or just synthetic id)
    const hasOnlySyntheticId = entity.fields.length === 0 ||
      (entity.fields.length === 1 && entity.fields[0].name === 'id' && entity.confidence === 'low');
    if (!hasOnlySyntheticId) continue;

    const match = allTypeDefs.get(entity.name.toLowerCase());
    if (!match || match.properties.length < 2) continue;

    const fields = match.properties.map((prop: TypeProperty) => {
      const { typeDef, isOptionalFromUnion } = tsTypeStringToTypeDef(prop.type);
      return {
        name: prop.name,
        type: typeDef,
        optional: prop.isOptional || isOptionalFromUnion,
        description: '',
        isPrimaryKey: prop.name === 'id',
      };
    });

    entity.fields = deduplicateFields(fields);
    entity.confidence = 'medium';
    if (match.sourceFile) entity.sourceFile = match.sourceFile;
  }

  // Filter out junk entities: generic type names, entities with angle brackets, empty-field entities
  const allEntities = Array.from(entityMap.values()).filter((e) => {
    if (e.name.includes('<') || e.name.includes('>')) return false;
    if (e.name === 'Promise' || e.name === 'Array' || e.name === 'Record') return false;
    if (/^(any|unknown|void|never|undefined|null|object|string|number|boolean)$/i.test(e.name)) return false;
    return true;
  });

  // Remove low-quality entities:
  // 1. Entities with zero fields (empty placeholders that couldn't be resolved)
  // 2. Entities where ALL non-id fields have type 'unknown' (poorly-typed state inferences)
  // 3. Entities whose names conflict with Swift standard library types
  const SWIFT_STDLIB_CONFLICTS = new Set([
    'Collection', 'Error', 'Type', 'Result', 'Optional', 'Array',
    'Dictionary', 'Set', 'Range', 'Sequence', 'Iterator',
    'Encoder', 'Decoder', 'Mirror', 'Index', 'Element',
    'Color', 'AccentColor', 'Image', 'Text', 'Button', 'View', 'Font',
    'NavigationPath', 'State', 'Binding', 'Environment', 'Observable',
    'Notification', 'Timer', 'Locale', 'Calendar', 'TimeZone',
  ]);

  return allEntities.filter((e) => {
    // Don't filter enum entities
    if (e.fields.length === 1 && e.fields[0].name === '__enum') return true;
    // Keep entities with zero fields but add a synthetic id field so they compile.
    // These are placeholders that the developer/AI needs to fill in.
    if (e.fields.length === 0) {
      e.fields = [{ name: 'id', type: { kind: 'string' }, optional: false, description: 'Auto-generated placeholder — add real fields', isPrimaryKey: true }];
      e.confidence = 'low';
      return true;
    }
    // Reject entities whose names conflict with Swift stdlib types
    if (SWIFT_STDLIB_CONFLICTS.has(e.name)) return false;
    // Keep entities that have at least one non-id field
    const nonIdFields = e.fields.filter((f) => f.name !== 'id' && !f.isPrimaryKey);
    if (nonIdFields.length === 0) return true; // id-only entities from TS interfaces are fine
    // Reject entities where ALL non-id fields are unknown type
    const allUnknown = nonIdFields.every((f) =>
      f.type.kind === 'unknown' ||
      (f.type.kind === 'object' && f.type.typeName === 'unknown'),
    );
    return !allUnknown;
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a unified Semantic App Model from raw analyzer outputs.
 *
 * This is the core function that bridges analysis (input) and generation (output).
 * It merges data from all extractors, infers navigation structure, correlates
 * state with screens, matches API calls to components, detects auth patterns,
 * and extracts theme information.
 *
 * @param analysisResult - Aggregated output from all analyzers
 * @returns A complete SemanticAppModel ready for platform adaptation and code generation
 *
 * @example
 * ```typescript
 * const analysisResult = await analyzeRepo('/path/to/web-app');
 * const model = await buildSemanticModel(analysisResult);
 * const adapted = adaptForPlatform(model, 'ios');
 * ```
 */
export async function buildSemanticModel(
  analysisResult: AnalysisResult,
): Promise<SemanticAppModel> {
  const { scanResult: scan, parsedFiles, components, routes, statePatterns, apiEndpoints } = analysisResult;

  // Wire up AI: try provider-agnostic interface first, fall back to legacy GrokClient
  const aiProvider = await getAIProviderSafe();
  const aiClient = aiProvider ? null : getGrokClientSafe();

  // 8. Determine app name from scan result (needed early for AI context)
  const appName = inferAppName(scan);

  // 1. Build screens by merging component + route data
  const screens = await buildScreens(components, routes, statePatterns, apiEndpoints, aiClient, appName, aiProvider);

  // 2. Build navigation structure from routes
  const navigation = buildNavigation(routes, screens);

  // 3. Build state management patterns
  const stateManagement = buildStateManagement(statePatterns);

  // 4. Build API endpoints (deduplicated)
  const apiEndpointModels = buildApiEndpoints(apiEndpoints);

  // 5. Detect authentication patterns
  const auth = detectAuthPattern(routes, apiEndpoints, components);

  // 6. Extract theme information
  const theme = extractThemeFromScan(scan);

  // 7. Infer data entities
  const entities = inferEntities(components, statePatterns, apiEndpoints, parsedFiles);

  // 7b. AI entity field enhancement — enrich incomplete entities (<=1 field)
  if (aiProvider) {
    await enhanceEntitiesWithAI(entities, aiProvider, components, apiEndpoints, statePatterns);
  }

  // 9. Calculate overall confidence
  const confidence = calculateOverallConfidence(screens, stateManagement, apiEndpointModels);

  // 10. Collect warnings
  const warnings = collectWarnings(screens, routes, statePatterns, apiEndpoints);

  const model: SemanticAppModel = {
    appName,
    description: `iOS app generated from ${scan.framework} web application`,
    version: '1.0',
    entities,
    screens,
    navigation,
    stateManagement,
    apiEndpoints: apiEndpointModels,
    auth,
    theme,
    confidence,
    metadata: {
      sourceFramework: mapFramework(scan.framework),
      extractedAt: new Date().toISOString(),
      morphkitVersion: '0.1.0',
      analyzedFiles: scan.allFiles.map((f) => f.relativePath),
      warnings,
    },
  };

  return model;
}

/**
 * Enhance incomplete entities (those with <=1 field) by using AI to infer
 * fields from usage context — component props, API endpoints, state shapes.
 *
 * Modifies entities in-place. All calls are wrapped in try/catch with timeout
 * so failures never break the pipeline.
 */
async function enhanceEntitiesWithAI(
  entities: Entity[],
  aiProvider: AIProvider,
  components: ExtractedComponent[],
  apis: ExtractedApi[],
  statePatterns: ExtractedState[],
): Promise<void> {
  // Only enhance entities that are incomplete (placeholder with <=1 field)
  const incompleteEntities = entities.filter((e) => {
    // Skip enum entities
    if (e.fields.length === 1 && e.fields[0].name === '__enum') return false;
    return e.fields.length <= 1;
  });

  if (incompleteEntities.length === 0) return;

  // Process up to 10 entities to avoid excessive API calls
  const toEnhance = incompleteEntities.slice(0, 10);

  for (const entity of toEnhance) {
    try {
      // Build usage context for the AI
      const nameLower = entity.name.toLowerCase();

      // Find components that reference this entity (via props, state, or children)
      const usages = components
        .filter((c) => {
          const propsStr = c.props.map((p) => `${p.name}:${p.type || ''}`).join(' ').toLowerCase();
          return propsStr.includes(nameLower);
        })
        .map((c) => `Component ${c.name} uses ${entity.name} in props`);

      // Find API endpoints that reference this entity
      const apiEndpoints = apis
        .filter((a) => {
          const responseType = (a.responseType || '').toLowerCase();
          return responseType.includes(nameLower);
        })
        .map((a) => {
          const { method, url } = getApiUrlAndMethod(a);
          return `${method} ${url} (response: ${a.responseType || 'unknown'})`;
        });

      // Find state patterns that reference this entity
      const stateShapes = statePatterns
        .filter((sp) => {
          if (sp.useState) {
            return (sp.useState.type || '').toLowerCase().includes(nameLower);
          }
          return false;
        })
        .map((sp) => `State: ${getStateName(sp)} (type: ${sp.useState?.type || 'unknown'})`);

      const result = await withAITimeout(aiProvider.enhanceEntityFields(
        entity.name,
        { usages, apiEndpoints, stateShapes },
      ));

      if (result && result.fields.length > 0) {
        // Convert AI-returned fields to the entity field format
        entity.fields = deduplicateFields(
          result.fields.map((f) => ({
            name: f.name,
            type: typeFromString(f.type),
            optional: f.optional,
            description: '',
            isPrimaryKey: f.name === 'id',
          })),
        );
        // Upgrade confidence since AI enriched the entity
        if (entity.confidence === 'low') {
          entity.confidence = 'medium';
        }
      }
    } catch (err) {
      console.warn(`[morphkit] AI entity enhancement failed for ${entity.name}, keeping heuristic fields:`, sanitizeErrorMessage(err));
    }
  }
}

/** Infer the app name from the repository scan result.
 *  Converts hyphenated/underscore directory names to PascalCase
 *  so the name is a valid Swift identifier (e.g. "sample-nextjs-app" → "SampleNextjsApp").
 */
function inferAppName(scanResult: RepoScanResult): string {
  const pathSegments = scanResult.repoPath.split('/').filter(Boolean);
  const dirName = pathSegments[pathSegments.length - 1] ?? 'App';
  // PascalCase: split on hyphens/underscores/spaces, capitalize each segment
  return dirName
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((seg) => seg.charAt(0).toUpperCase() + seg.slice(1))
    .join('');
}

/** Map scanner framework kind to semantic model framework enum. */
function mapFramework(
  framework: RepoScanResult['framework'],
): SemanticAppModel['metadata']['sourceFramework'] {
  switch (framework) {
    case 'nextjs-app-router':
    case 'nextjs-pages-router':
      return 'next';
    case 'react':
      return 'react';
    default:
      return 'other';
  }
}

/** Calculate overall model confidence from constituent parts. */
function calculateOverallConfidence(
  screens: Screen[],
  stateManagement: StatePattern[],
  apiEndpoints: ApiEndpoint[],
): ConfidenceLevel {
  if (screens.length === 0) return 'low';

  const allConfidences = [
    ...screens.map((s) => s.confidence),
    ...stateManagement.map((s) => s.confidence),
    ...apiEndpoints.map((a) => a.confidence),
  ];

  if (allConfidences.length === 0) return 'low';

  const scores = allConfidences.map((c) =>
    c === 'high' ? 3 : c === 'medium' ? 2 : 1,
  );
  const avg = scores.reduce((sum, s) => sum + s, 0) / scores.length;

  if (avg >= 2.5) return 'high';
  if (avg >= 1.5) return 'medium';
  return 'low';
}

/** Collect warnings about potential issues in the extracted model. */
function collectWarnings(
  screens: Screen[],
  routes: ExtractedRoute[],
  statePatterns: ExtractedState[],
  apis: ExtractedApi[],
): string[] {
  const warnings: string[] = [];

  if (screens.length === 0) {
    warnings.push('No screens were extracted. The app may use an unsupported routing pattern.');
  }

  if (routes.length === 0) {
    warnings.push('No routes detected. Navigation structure will be inferred from components.');
  }

  if (statePatterns.length === 0) {
    warnings.push('No state management patterns detected. State architecture will use defaults.');
  }

  if (apis.length === 0) {
    warnings.push('No API endpoints detected. The app may use server-side data fetching not visible to static analysis.');
  }

  return warnings;
}

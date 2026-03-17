/**
 * Morphkit Semantic App Model
 *
 * The core intermediate representation that captures what a web app *does*
 * in a framework-agnostic way. This bridges web analysis (input) and
 * iOS/SwiftUI code generation (output).
 *
 * Design principles:
 * - Detailed enough to produce good SwiftUI code
 * - Abstract enough to extract from real React/Vue/Angular codebases
 * - Every node carries provenance (sourceFile) so generators can trace back
 * - Confidence scoring lets generators degrade gracefully on uncertain data
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Primitives & Enums
// ---------------------------------------------------------------------------

export const ConfidenceLevelSchema = z.enum(['high', 'medium', 'low']);

export const LayoutTypeSchema = z.enum([
  'list',
  'grid',
  'form',
  'detail',
  'dashboard',
  'settings',
  'profile',
  'auth',
  'onboarding',
  'empty',
  'custom',
]);

export const HttpMethodSchema = z.enum([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
]);

export const CacheStrategySchema = z.object({
  type: z.enum(['none', 'memory', 'disk', 'stale-while-revalidate']),
  ttlSeconds: z.number().nullable(),
  invalidateOn: z.array(z.string()).describe('Mutation names that bust this cache'),
});

// ---------------------------------------------------------------------------
// TypeDefinition — recursive type description extracted from TS source
// ---------------------------------------------------------------------------

export const TypeDefinitionSchema: z.ZodType<TypeDefinition> = z.lazy(() =>
  z.object({
    kind: z.enum([
      'string',
      'number',
      'boolean',
      'date',
      'enum',
      'array',
      'object',
      'union',
      'literal',
      'unknown',
    ]),
    /** For 'enum' / 'union' / 'literal' */
    values: z.array(z.union([z.string(), z.number(), z.boolean()])).optional(),
    /** For 'array' — the element type */
    elementType: z.lazy((): z.ZodType<TypeDefinition> => TypeDefinitionSchema).optional(),
    /** For 'object' — nested fields */
    fields: z.array(z.object({
      name: z.string(),
      type: z.lazy((): z.ZodType<TypeDefinition> => TypeDefinitionSchema),
      optional: z.boolean().default(false),
      description: z.string().default(''),
      isPrimaryKey: z.boolean().default(false),
    })).optional(),
    /** Original TS type name if it was a named type/interface */
    typeName: z.string().optional(),
    /** Whether this came from an explicit TS type or was inferred */
    inferred: z.boolean().default(false),
  }) as unknown as z.ZodType<TypeDefinition>,
);

export interface TypeDefinition {
  kind:
    | 'string'
    | 'number'
    | 'boolean'
    | 'date'
    | 'enum'
    | 'array'
    | 'object'
    | 'union'
    | 'literal'
    | 'unknown';
  values?: (string | number | boolean)[];
  elementType?: TypeDefinition;
  fields?: Field[];
  typeName?: string;
  inferred?: boolean;
}

// ---------------------------------------------------------------------------
// Field & Relationship — building blocks for Entity
// ---------------------------------------------------------------------------

export const FieldSchema = z.object({
  name: z.string(),
  type: TypeDefinitionSchema,
  optional: z.boolean().default(false),
  description: z.string().default(''),
  /** If this field is the entity's primary key */
  isPrimaryKey: z.boolean().default(false),
});

export const RelationshipSchema = z.object({
  targetEntity: z.string(),
  type: z.enum(['one-to-one', 'one-to-many', 'many-to-many']),
  fieldName: z.string().describe('The local field that holds the reference'),
  description: z.string().default(''),
});

// ---------------------------------------------------------------------------
// Entity — a data shape extracted from TS interfaces/types
// ---------------------------------------------------------------------------

export const EntitySchema = z.object({
  name: z.string(),
  description: z.string().default(''),
  fields: z.array(FieldSchema),
  sourceFile: z.string().describe('Path in the original web app'),
  relationships: z.array(RelationshipSchema).default([]),
  confidence: ConfidenceLevelSchema.default('medium'),
});

// ---------------------------------------------------------------------------
// Screen building blocks
// ---------------------------------------------------------------------------

export const ComponentRefSchema = z.object({
  /** Semantic name, e.g. "UserCard", "SearchBar" */
  name: z.string(),
  /** What SwiftUI concept this maps to (informational, not binding) */
  suggestedSwiftUI: z.string().optional(),
  /** Props/bindings this component expects */
  props: z.record(z.string(), TypeDefinitionSchema).default({}),
  /** How many times it appears on the screen (1 = single, >1 = repeated/list) */
  count: z.enum(['single', 'repeated']).default('single'),
});

export const DataRequirementSchema = z.object({
  /** Entity name or API endpoint name */
  source: z.string(),
  /** How the data is fetched: inline state, API call, prop drilling, etc. */
  fetchStrategy: z.enum(['prop', 'context', 'api', 'local', 'derived']),
  /** Is the data a single item or a collection? */
  cardinality: z.enum(['one', 'many']),
  /** Is data required before the screen can render? */
  blocking: z.boolean().default(true),
  /** Filters/params applied when fetching */
  params: z.record(z.string(), z.string()).default({}),
});

export const UserActionSchema = z.object({
  /** Human-readable label, e.g. "Delete item", "Submit form" */
  label: z.string(),
  trigger: z.enum(['tap', 'swipe', 'longPress', 'submit', 'pull-to-refresh', 'scroll', 'other']),
  /** What happens: navigate, mutate state, call API, etc. */
  effect: z.object({
    type: z.enum(['navigate', 'mutate', 'apiCall', 'modal', 'alert', 'share', 'other']),
    target: z.string().describe('Screen name, mutation name, or endpoint name'),
    payload: z.record(z.string(), z.string()).default({}),
  }),
  /** Is this action destructive (shows confirmation)? */
  destructive: z.boolean().default(false),
  /** Auth required to perform this action? */
  requiresAuth: z.boolean().default(false),
});

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export const ScreenSchema = z.object({
  name: z.string(),
  description: z.string().default(''),
  purpose: z.string().describe('One-line summary of what this screen is for'),
  sourceFile: z.string(),
  sourceComponent: z.string().describe('Exported component name in the web app'),
  layout: LayoutTypeSchema,
  components: z.array(ComponentRefSchema).default([]),
  dataRequirements: z.array(DataRequirementSchema).default([]),
  actions: z.array(UserActionSchema).default([]),
  stateBindings: z
    .array(z.string())
    .default([])
    .describe('Names of StatePatterns this screen reads or writes'),
  /** Whether this screen is an entry point (e.g. home, login) */
  isEntryPoint: z.boolean().default(false),
  confidence: ConfidenceLevelSchema.default('medium'),
});

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

export const RouteSchema = z.object({
  path: z.string().describe('URL path pattern from the web app, e.g. /users/:id'),
  screen: z.string().describe('Screen name this route maps to'),
  params: z.array(z.string()).default([]).describe('Dynamic path/query params'),
  guards: z
    .array(z.string())
    .default([])
    .describe('Conditions required, e.g. "authenticated"'),
});

export const TabItemSchema = z.object({
  label: z.string(),
  icon: z.string().describe('SF Symbol name suggestion for iOS'),
  screen: z.string(),
  badge: z.string().optional().describe('State binding for badge count'),
});

export const DeepLinkSchema = z.object({
  pattern: z.string().describe('URL pattern, e.g. myapp://users/{id}'),
  screen: z.string(),
  params: z.array(z.string()).default([]),
});

export const NavigationFlowSchema = z.object({
  type: z.enum(['tab', 'stack', 'drawer', 'mixed']),
  routes: z.array(RouteSchema).default([]),
  tabs: z.array(TabItemSchema).default([]),
  deepLinks: z.array(DeepLinkSchema).default([]),
  /** The default/root screen name */
  initialScreen: z.string(),
});

// ---------------------------------------------------------------------------
// State Management
// ---------------------------------------------------------------------------

export const MutationSchema = z.object({
  name: z.string().describe('Action/event name, e.g. "addTodo"'),
  payload: TypeDefinitionSchema.nullable().default(null),
  description: z.string().default('').describe('What this mutation does in plain English'),
  /** Is this mutation optimistic (updates UI before server confirms)? */
  optimistic: z.boolean().default(false),
});

export const StatePatternSchema = z.object({
  name: z.string(),
  type: z.enum(['local', 'global', 'server']),
  shape: TypeDefinitionSchema,
  mutations: z.array(MutationSchema).default([]),
  source: z.enum([
    'useState',
    'useReducer',
    'redux',
    'zustand',
    'context',
    'mobx',
    'tanstack-query',
    'swr',
    'other',
  ]),
  /** Which screens consume this state */
  consumers: z.array(z.string()).default([]),
  confidence: ConfidenceLevelSchema.default('medium'),
});

// ---------------------------------------------------------------------------
// API Endpoints
// ---------------------------------------------------------------------------

export const ApiEndpointSchema = z.object({
  /** Relative or absolute URL pattern */
  url: z.string(),
  method: HttpMethodSchema,
  headers: z.record(z.string(), z.string()).default({}),
  requestBody: TypeDefinitionSchema.nullable().default(null),
  responseType: TypeDefinitionSchema,
  /** Whether this endpoint requires authentication */
  auth: z.boolean().default(false),
  caching: CacheStrategySchema.nullable().default(null),
  /** Human-readable description of what this endpoint does */
  description: z.string().default(''),
  /** Source file where this call was found */
  sourceFile: z.string().default(''),
  confidence: ConfidenceLevelSchema.default('medium'),
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const AuthFlowSchema = z.object({
  name: z.string().describe('e.g. "login", "signup", "forgot-password", "logout"'),
  /** Screens involved in this flow */
  screens: z.array(z.string()),
  /** API endpoints involved */
  endpoints: z.array(z.string()),
  description: z.string().default(''),
});

export const AuthPatternSchema = z.object({
  type: z.enum(['jwt', 'session', 'oauth', 'api-key', 'other']),
  provider: z.string().nullable().default(null).describe('e.g. "firebase", "auth0", "supabase"'),
  flows: z.array(AuthFlowSchema).default([]),
  /** Where tokens/credentials are stored in the web app */
  storageStrategy: z
    .enum(['localStorage', 'sessionStorage', 'cookie', 'memory', 'other'])
    .default('other'),
  confidence: ConfidenceLevelSchema.default('medium'),
});

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

export const ColorPaletteSchema = z.object({
  primary: z.string().describe('Hex color'),
  secondary: z.string().default('#6B7280'),
  accent: z.string().default('#3B82F6'),
  background: z.string().default('#FFFFFF'),
  surface: z.string().default('#F9FAFB'),
  error: z.string().default('#EF4444'),
  success: z.string().default('#10B981'),
  warning: z.string().default('#F59E0B'),
  text: z.object({
    primary: z.string().default('#111827'),
    secondary: z.string().default('#6B7280'),
    disabled: z.string().default('#9CA3AF'),
    inverse: z.string().default('#FFFFFF'),
  }).default({}),
  /** Any additional named colors extracted from the app */
  custom: z.record(z.string(), z.string()).default({}),
});

export const TypographyScaleSchema = z.object({
  fontFamily: z.object({
    heading: z.string().default('System'),
    body: z.string().default('System'),
    mono: z.string().default('Menlo'),
  }).default({}),
  sizes: z.object({
    xs: z.number().default(12),
    sm: z.number().default(14),
    base: z.number().default(16),
    lg: z.number().default(18),
    xl: z.number().default(20),
    '2xl': z.number().default(24),
    '3xl': z.number().default(30),
    '4xl': z.number().default(36),
  }).default({}),
  /** Font weights used in the app */
  weights: z.object({
    regular: z.number().default(400),
    medium: z.number().default(500),
    semibold: z.number().default(600),
    bold: z.number().default(700),
  }).default({}),
});

export const SpacingScaleSchema = z.object({
  unit: z.number().default(4).describe('Base spacing unit in points'),
  values: z
    .record(z.string(), z.number())
    .default({
      xs: 4,
      sm: 8,
      md: 16,
      lg: 24,
      xl: 32,
      '2xl': 48,
    })
    .describe('Named spacing values in points'),
});

export const ThemeConfigSchema = z.object({
  colors: ColorPaletteSchema,
  typography: TypographyScaleSchema.default({}),
  spacing: SpacingScaleSchema.default({}),
  borderRadius: z
    .record(z.string(), z.number())
    .default({
      none: 0,
      sm: 4,
      md: 8,
      lg: 12,
      xl: 16,
      full: 9999,
    }),
  /** Whether the app supports dark mode */
  supportsDarkMode: z.boolean().default(false),
});

// ---------------------------------------------------------------------------
// SemanticAppModel — the top-level model
// ---------------------------------------------------------------------------

export const SemanticAppModelSchema = z.object({
  appName: z.string(),
  description: z.string().default(''),
  /** Schema version for forward compatibility */
  version: z.literal('1.0'),
  entities: z.array(EntitySchema).default([]),
  screens: z.array(ScreenSchema).default([]),
  navigation: NavigationFlowSchema,
  stateManagement: z.array(StatePatternSchema).default([]),
  apiEndpoints: z.array(ApiEndpointSchema).default([]),
  auth: AuthPatternSchema.nullable().default(null),
  theme: ThemeConfigSchema,
  /** Overall confidence in the extracted model */
  confidence: ConfidenceLevelSchema.default('medium'),
  /** Metadata about the extraction process */
  metadata: z
    .object({
      sourceFramework: z
        .enum(['react', 'next', 'vue', 'nuxt', 'angular', 'svelte', 'other'])
        .default('other'),
      extractedAt: z.string().datetime().describe('ISO 8601 timestamp'),
      morphkitVersion: z.string(),
      /** Files that were analyzed */
      analyzedFiles: z.array(z.string()).default([]),
      /** Warnings or issues encountered during extraction */
      warnings: z.array(z.string()).default([]),
    })
    .default({
      extractedAt: new Date().toISOString(),
      morphkitVersion: '0.1.0',
    }),
});

// ---------------------------------------------------------------------------
// Inferred TypeScript types
// ---------------------------------------------------------------------------

export type ConfidenceLevel = z.infer<typeof ConfidenceLevelSchema>;
export type LayoutType = z.infer<typeof LayoutTypeSchema>;
export type HttpMethod = z.infer<typeof HttpMethodSchema>;
export type CacheStrategy = z.infer<typeof CacheStrategySchema>;
export type Field = z.infer<typeof FieldSchema>;
export type Relationship = z.infer<typeof RelationshipSchema>;
export type Entity = z.infer<typeof EntitySchema>;
export type ComponentRef = z.infer<typeof ComponentRefSchema>;
export type DataRequirement = z.infer<typeof DataRequirementSchema>;
export type UserAction = z.infer<typeof UserActionSchema>;
export type Screen = z.infer<typeof ScreenSchema>;
export type Route = z.infer<typeof RouteSchema>;
export type TabItem = z.infer<typeof TabItemSchema>;
export type DeepLink = z.infer<typeof DeepLinkSchema>;
export type NavigationFlow = z.infer<typeof NavigationFlowSchema>;
export type Mutation = z.infer<typeof MutationSchema>;
export type StatePattern = z.infer<typeof StatePatternSchema>;
export type ApiEndpoint = z.infer<typeof ApiEndpointSchema>;
export type AuthFlow = z.infer<typeof AuthFlowSchema>;
export type AuthPattern = z.infer<typeof AuthPatternSchema>;
export type ColorPalette = z.infer<typeof ColorPaletteSchema>;
export type TypographyScale = z.infer<typeof TypographyScaleSchema>;
export type SpacingScale = z.infer<typeof SpacingScaleSchema>;
export type ThemeConfig = z.infer<typeof ThemeConfigSchema>;
export type SemanticAppModel = z.infer<typeof SemanticAppModelSchema>;

/**
 * @module semantic
 *
 * Re-exports the full semantic layer: the app model types, the model builder,
 * and the platform adapter.
 *
 * - **model** — Zod schemas and TypeScript types for the SemanticAppModel
 * - **builder** — Constructs a SemanticAppModel from raw analyzer outputs
 * - **adapter** — Maps the model to iOS-specific concepts before code generation
 */

// Model types & schemas
export {
  // Schemas
  ConfidenceLevelSchema,
  LayoutTypeSchema,
  HttpMethodSchema,
  CacheStrategySchema,
  TypeDefinitionSchema,
  FieldSchema,
  RelationshipSchema,
  EntitySchema,
  ComponentRefSchema,
  DataRequirementSchema,
  UserActionSchema,
  ScreenSchema,
  RouteSchema,
  TabItemSchema,
  DeepLinkSchema,
  NavigationFlowSchema,
  MutationSchema,
  StatePatternSchema,
  ApiEndpointSchema,
  AuthFlowSchema,
  AuthPatternSchema,
  ColorPaletteSchema,
  TypographyScaleSchema,
  SpacingScaleSchema,
  ThemeConfigSchema,
  SemanticAppModelSchema,
  // Types
  type ConfidenceLevel,
  type LayoutType,
  type HttpMethod,
  type CacheStrategy,
  type TypeDefinition,
  type Field,
  type Relationship,
  type Entity,
  type ComponentRef,
  type DataRequirement,
  type UserAction,
  type Screen,
  type Route,
  type TabItem,
  type DeepLink,
  type NavigationFlow,
  type Mutation,
  type StatePattern,
  type ApiEndpoint,
  type AuthFlow,
  type AuthPattern,
  type ColorPalette,
  type TypographyScale,
  type SpacingScale,
  type ThemeConfig,
  type SemanticAppModel,
} from './model.js';

// Builder
export {
  buildSemanticModel,
  type AnalysisResult,
} from './builder.js';

// Adapter
export {
  adaptForPlatform,
  type AdaptedModel,
  type iOSNavigationConfig,
  type iOSStateConfig,
  type iOSComponentMapping,
  type iOSNetworkingConfig,
} from './adapter.js';

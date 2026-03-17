/**
 * @module ai
 *
 * Morphkit AI integration — re-exports the Grok client, all structured
 * output schemas/types, and prompt utilities.
 */

// Client
export { GrokClient } from "./grok-client.js";
export type {
  GrokClientConfig,
  IntentContext,
  ComponentMapping,
  CodeGenPrompt,
  NavigationContext,
  StateContext,
  TokenUsage,
} from "./grok-client.js";

// Structured output schemas & types
export {
  IntentAnalysisSchema,
  SwiftUIMappingSchema,
  GeneratedCodeSchema,
  NavigationPlanSchema,
  StateArchitectureSchema,
  PropertyDefSchema,
  TabDefSchema,
  RouteDefSchema,
  StoreDefSchema,
} from "./structured-output.js";
export type {
  IntentAnalysis,
  SwiftUIMapping,
  GeneratedCode,
  iOSNavigationPlan,
  iOSStateArchitecture,
  PropertyDef,
  TabDef,
  RouteDef,
  StoreDef,
} from "./structured-output.js";

// Prompt utilities
export {
  buildIntentExtractionPrompt,
  INTENT_EXTRACTION_SYSTEM_PROMPT,
} from "./prompts/intent-extraction.js";
export type { AppContext } from "./prompts/intent-extraction.js";

export {
  buildComponentMappingPrompt,
  COMPONENT_MAPPING_SYSTEM_PROMPT,
} from "./prompts/component-mapping.js";
export type { ExtractedComponentInfo } from "./prompts/component-mapping.js";

export {
  buildCodeGenerationPrompt,
  CODE_GENERATION_SYSTEM_PROMPT,
  CODE_GENERATION_RESPONSE_SCHEMA,
} from "./prompts/code-generation.js";
export type { ScreenGenContext } from "./prompts/code-generation.js";

// ---------------------------------------------------------------------------
// Singleton Factory
// ---------------------------------------------------------------------------

import { GrokClient, type GrokClientConfig } from "./grok-client.js";

let _instance: GrokClient | null = null;
let _instanceConfig: string | null = null;

/**
 * Get a singleton `GrokClient` instance. If called multiple times with the
 * same config (or no config), returns the same instance. Passing a different
 * config creates a new instance.
 *
 * @param config - Optional client configuration.
 * @returns A shared `GrokClient` instance.
 *
 * @example
 * ```ts
 * import { getGrokClient } from "./ai";
 *
 * const client = getGrokClient();
 * const intent = await client.analyzeIntent({ code, appContext });
 * ```
 */
export function getGrokClient(config?: GrokClientConfig): GrokClient {
  const configKey = JSON.stringify(config ?? {});

  if (_instance && _instanceConfig === configKey) {
    return _instance;
  }

  _instance = new GrokClient(config);
  _instanceConfig = configKey;
  return _instance;
}

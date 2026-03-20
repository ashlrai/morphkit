/**
 * @module ai/provider
 *
 * Provider-agnostic AI abstraction for Morphkit. Defines the AIProvider
 * interface that all AI backends (Claude, Grok, OpenAI) must implement,
 * plus a factory function for creating providers from config.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// AI Provider Response Schemas (Zod-first, per project convention)
// ---------------------------------------------------------------------------

/** Schema for analyzeIntent response. */
export const AIIntentResultSchema = z.object({
  purpose: z.string().describe('High-level description of what this component accomplishes'),
  userGoals: z.array(z.string()).describe('End-user goals this screen serves'),
  dataNeeds: z.array(z.string()).describe('Data entities or API calls this component requires'),
});

/** Schema for mapComponent response. */
export const AIComponentMapResultSchema = z.object({
  swiftUIView: z.string().describe('Primary SwiftUI view type, e.g. "List", "Form", "ScrollView"'),
  layout: z.string().describe('Layout strategy, e.g. "VStack", "LazyVGrid(columns: 2)"'),
  modifiers: z.array(z.string()).describe('SwiftUI modifiers to apply'),
});

/** Schema for suggestStateArchitecture response. */
export const AIStateArchitectureResultSchema = z.object({
  stores: z.array(z.object({
    name: z.string(),
    responsibilities: z.array(z.string()),
    scope: z.enum(['app', 'feature', 'view']),
  })).describe('Recommended @Observable stores'),
  bindings: z.array(z.object({
    screen: z.string(),
    store: z.string(),
    properties: z.array(z.string()),
  })).describe('How screens bind to stores'),
});

/** Schema for enhanceEntityFields response. */
export const AIEntityFieldsResultSchema = z.object({
  fields: z.array(z.object({
    name: z.string(),
    type: z.string().describe('Swift-compatible type, e.g. "String", "Int", "[Item]"'),
    optional: z.boolean(),
  })).describe('Inferred entity fields'),
});

// ---------------------------------------------------------------------------
// Inferred Types
// ---------------------------------------------------------------------------

export type AIIntentResult = z.infer<typeof AIIntentResultSchema>;
export type AIComponentMapResult = z.infer<typeof AIComponentMapResultSchema>;
export type AIStateArchitectureResult = z.infer<typeof AIStateArchitectureResultSchema>;
export type AIEntityFieldsResult = z.infer<typeof AIEntityFieldsResultSchema>;

// ---------------------------------------------------------------------------
// AIProvider Interface
// ---------------------------------------------------------------------------

/** Input shape for analyzeIntent. */
export interface AIComponentInput {
  name: string;
  props: string[];
  children: string[];
  hooks: string[];
}

/** Input shape for mapComponent. */
export interface AIMapComponentInput {
  name: string;
  jsxElements: string[];
  props: string[];
}

/** Input shape for enhanceEntityFields context. */
export interface AIEntityContext {
  usages: string[];
  apiEndpoints: string[];
  stateShapes: string[];
}

/**
 * Provider-agnostic AI interface for Morphkit's semantic analysis pipeline.
 *
 * All methods return structured data validated against Zod schemas.
 * Implementations must handle retries, timeouts, and error recovery internally.
 */
export interface AIProvider {
  /** Human-readable provider name for logging. */
  readonly name: string;

  /**
   * Analyze the intent behind a React component — what it does and why.
   * Used for layout inference when heuristics return 'custom'.
   */
  analyzeIntent(
    component: AIComponentInput,
    context: string,
  ): Promise<AIIntentResult>;

  /**
   * Map a React component to its SwiftUI equivalent.
   * Used when heuristic component mapping has low confidence.
   */
  mapComponent(
    component: AIMapComponentInput,
    targetPlatform: 'ios',
  ): Promise<AIComponentMapResult>;

  /**
   * Suggest an iOS state management architecture based on web state patterns.
   */
  suggestStateArchitecture(
    statePatterns: any[],
    screens: string[],
  ): Promise<AIStateArchitectureResult>;

  /**
   * Enhance incomplete entity definitions by inferring fields from usage context.
   * Called for entities with <=1 field (placeholder entities).
   */
  enhanceEntityFields(
    entityName: string,
    context: AIEntityContext,
  ): Promise<AIEntityFieldsResult>;
}

// ---------------------------------------------------------------------------
// Provider Config
// ---------------------------------------------------------------------------

/** Supported AI provider backends. */
export type AIProviderName = 'claude' | 'grok' | 'openai';

/** Configuration for creating an AI provider. */
export interface AIProviderConfig {
  provider: AIProviderName;
  apiKey: string;
  model?: string;
  /** Base URL override (useful for OpenAI-compatible endpoints). */
  baseURL?: string;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an AIProvider instance from configuration.
 *
 * Lazily imports the provider module to avoid loading unused SDKs.
 *
 * @param config - Provider configuration with API key and optional model override.
 * @returns A configured AIProvider instance.
 *
 * @example
 * ```ts
 * const provider = await createAIProvider({
 *   provider: 'claude',
 *   apiKey: process.env.ANTHROPIC_API_KEY!,
 * });
 * const intent = await provider.analyzeIntent(component, context);
 * ```
 */
export async function createAIProvider(config: AIProviderConfig): Promise<AIProvider> {
  switch (config.provider) {
    case 'claude': {
      const { ClaudeProvider } = await import('./providers/claude.js');
      return new ClaudeProvider(config.apiKey, config.model);
    }
    case 'grok': {
      const { GrokProvider } = await import('./providers/grok.js');
      return new GrokProvider(config.apiKey, config.model);
    }
    case 'openai': {
      const { OpenAIProvider } = await import('./providers/openai.js');
      return new OpenAIProvider(config.apiKey, config.model, config.baseURL);
    }
    default:
      throw new Error(`Unknown AI provider: ${config.provider}`);
  }
}

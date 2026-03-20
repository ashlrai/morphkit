/**
 * @module grok-client
 *
 * Wraps the xAI Grok API (OpenAI-compatible) for Morphkit's specific needs:
 * intent analysis, component mapping, code generation, navigation
 * planning, and state architecture recommendations.
 *
 * All responses are validated against Zod schemas from `structured-output.ts`.
 */

import OpenAI from "openai";

import {
  buildCodeGenerationPrompt,
  CODE_GENERATION_SYSTEM_PROMPT,
  type ScreenGenContext,
} from "./prompts/code-generation.js";
import {
  buildComponentMappingPrompt,
  COMPONENT_MAPPING_SYSTEM_PROMPT,
  type ExtractedComponentInfo,
} from "./prompts/component-mapping.js";
import {
  buildIntentExtractionPrompt,
  INTENT_EXTRACTION_SYSTEM_PROMPT,
  type AppContext,
} from "./prompts/intent-extraction.js";
import {
  IntentAnalysisSchema,
  SwiftUIMappingSchema,
  GeneratedCodeSchema,
  NavigationPlanSchema,
  StateArchitectureSchema,
  type IntentAnalysis,
  type SwiftUIMapping,
  type GeneratedCode,
  type iOSNavigationPlan,
  type iOSStateArchitecture,
} from "./structured-output.js";

// ---------------------------------------------------------------------------
// Public Types (inputs to GrokClient methods)
// ---------------------------------------------------------------------------

/** Context passed to `analyzeIntent`. */
export interface IntentContext {
  /** Raw source code of the component. */
  code: string;
  /** Application-level context. */
  appContext: AppContext;
}

/** Context passed to `mapComponent`. */
export interface ComponentMapping {
  /** Extracted component information. */
  component: ExtractedComponentInfo;
  /** Target platform — currently only 'ios'. */
  targetPlatform?: "ios";
}

/** Prompt passed to `generateSwiftCode`. */
export type CodeGenPrompt = ScreenGenContext;

/** Web navigation context passed to `adaptNavigation`. */
export interface NavigationContext {
  /** All routes in the web app. */
  routes: Array<{
    path: string;
    componentName: string;
    isLayout?: boolean;
    isProtected?: boolean;
  }>;
  /** Current navigation patterns detected (e.g. sidebar, top-nav, breadcrumbs). */
  webPatterns: string[];
  /** App domain description. */
  domain: string;
}

/** Web state context passed to `suggestStateArchitecture`. */
export interface StateContext {
  /** State management libraries / patterns detected (e.g. "zustand", "redux", "react-query"). */
  stateLibraries: string[];
  /** Global stores / contexts found. */
  stores: Array<{
    name: string;
    shape: string;
    usedBy: string[];
  }>;
  /** Data fetching patterns (e.g. "SWR", "React Query", "fetch in useEffect"). */
  fetchingPatterns: string[];
  /** App domain description. */
  domain: string;
}

/** Configuration for the Grok client. */
export interface GrokClientConfig {
  /** xAI API key. Defaults to `process.env.XAI_API_KEY`. */
  apiKey?: string;
  /** Model to use. Defaults to `grok-4-1-fast-reasoning`. */
  model?: string;
  /** Maximum retries on transient failures. Defaults to 3. */
  maxRetries?: number;
}

/** Token usage statistics for cost estimation. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUSD: number;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

const DEFAULT_MODEL = "grok-4-1-fast-reasoning";
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

/** Approximate pricing per 1M tokens (Grok). */
const PRICING = {
  inputPer1M: 3.0,
  outputPer1M: 15.0,
};

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// GrokClient
// ---------------------------------------------------------------------------

/**
 * xAI Grok client tailored for Morphkit's TS-to-SwiftUI pipeline.
 *
 * Uses the OpenAI SDK pointed at xAI's OpenAI-compatible endpoint.
 *
 * @example
 * ```ts
 * const client = new GrokClient({ apiKey: "xai-..." });
 * const intent = await client.analyzeIntent({ code, appContext });
 * ```
 */
export class GrokClient {
  private client: OpenAI;
  private model: string;
  private maxRetries: number;

  /** Cumulative token usage across all calls in this client instance. */
  private _usage: TokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedCostUSD: 0,
  };

  constructor(config: GrokClientConfig = {}) {
    const apiKey = config.apiKey ?? process.env.XAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "xAI API key is required. Pass it via config.apiKey or set the XAI_API_KEY environment variable."
      );
    }

    this.client = new OpenAI({
      apiKey,
      baseURL: "https://api.x.ai/v1",
    });
    this.model = config.model ?? DEFAULT_MODEL;
    this.maxRetries = config.maxRetries ?? MAX_RETRIES;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Analyze the intent behind a React component — what it does and WHY.
   *
   * @param context - Component code and application context.
   * @returns Structured intent analysis.
   */
  async analyzeIntent(context: IntentContext): Promise<IntentAnalysis> {
    const userPrompt = buildIntentExtractionPrompt(
      context.code,
      context.appContext
    );
    const raw = await this.callGrok(
      INTENT_EXTRACTION_SYSTEM_PROMPT,
      userPrompt
    );
    return IntentAnalysisSchema.parse(raw);
  }

  /**
   * Map a React component to its SwiftUI equivalent.
   *
   * @param mapping - Extracted component info and target platform.
   * @returns Structured SwiftUI mapping with reasoning.
   */
  async mapComponent(mapping: ComponentMapping): Promise<SwiftUIMapping> {
    const userPrompt = buildComponentMappingPrompt(
      mapping.component,
      mapping.targetPlatform ?? "ios"
    );
    const raw = await this.callGrok(
      COMPONENT_MAPPING_SYSTEM_PROMPT,
      userPrompt
    );
    return SwiftUIMappingSchema.parse(raw);
  }

  /**
   * Generate complete SwiftUI code from a structured prompt.
   *
   * @param prompt - Full screen generation context.
   * @returns Generated SwiftUI code with metadata.
   */
  async generateSwiftCode(prompt: CodeGenPrompt): Promise<GeneratedCode> {
    const userPrompt = buildCodeGenerationPrompt(prompt);
    const raw = await this.callGrok(
      CODE_GENERATION_SYSTEM_PROMPT,
      userPrompt
    );
    return GeneratedCodeSchema.parse(raw);
  }

  /**
   * Decide how web navigation should map to iOS patterns.
   *
   * @param webNav - Web navigation routes and patterns.
   * @returns iOS navigation architecture plan.
   */
  async adaptNavigation(
    webNav: NavigationContext
  ): Promise<iOSNavigationPlan> {
    const systemPrompt = `You are a senior iOS architect specializing in navigation design. Given a web application's routing structure, determine the most idiomatic iOS navigation pattern.

Key principles:
- Use TabView for 2-5 top-level sections that users switch between frequently.
- Use NavigationStack for hierarchical drill-down flows.
- Use "mixed" when the app has both tab-level sections AND deep navigation within each.
- .sheet for creation flows, settings, or modal contexts.
- .fullScreenCover only for immersive experiences (onboarding, media viewers).
- Protected routes map to authentication guards, not separate navigation structures.

Respond with valid JSON matching the specified schema. Respond with a single JSON object matching the NavigationPlan schema.`;

    const userPrompt = this.buildNavigationPrompt(webNav);
    const raw = await this.callGrok(systemPrompt, userPrompt);
    return NavigationPlanSchema.parse(raw);
  }

  /**
   * Recommend an iOS state management architecture based on web state patterns.
   *
   * @param webState - Web state management context.
   * @returns iOS state architecture recommendation.
   */
  async suggestStateArchitecture(
    webState: StateContext
  ): Promise<iOSStateArchitecture> {
    const systemPrompt = `You are a senior iOS architect specializing in state management. Given a web application's state management patterns, recommend the most idiomatic iOS/SwiftUI approach.

Key principles:
- Use @Observable classes (iOS 17+) as the primary state container — NOT ObservableObject.
- Use @Environment for dependency injection of shared stores.
- Keep view-local state in @State.
- Map React Query / SWR patterns to async/await with .task { } — no third-party reactive libraries needed.
- Redux-style global stores → a small number of @Observable singletons injected via @Environment.
- Zustand stores → @Observable classes, one per feature domain.
- React Context → @Environment with custom EnvironmentKey.
- Prefer fewer, well-scoped stores over many fine-grained ones.

Respond with valid JSON matching the specified schema. Respond with a single JSON object matching the StateArchitecture schema.`;

    const userPrompt = this.buildStatePrompt(webState);
    const raw = await this.callGrok(systemPrompt, userPrompt);
    return StateArchitectureSchema.parse(raw);
  }

  /**
   * Get cumulative token usage and estimated cost for this client instance.
   */
  get usage(): Readonly<TokenUsage> {
    return { ...this._usage };
  }

  /**
   * Reset the cumulative token usage counter.
   */
  resetUsage(): void {
    this._usage = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCostUSD: 0,
    };
  }

  // -----------------------------------------------------------------------
  // Private Helpers
  // -----------------------------------------------------------------------

  /**
   * Core method: call Grok with retry logic, rate-limit handling,
   * and token tracking. Expects JSON responses.
   */
  private async callGrok(
    systemPrompt: string,
    userPrompt: string
  ): Promise<unknown> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const response = await this.client.chat.completions.create({
          model: this.model,
          max_tokens: 8192,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: systemPrompt + "\n\nRespond with valid JSON matching the specified schema.",
            },
            { role: "user", content: userPrompt },
          ],
        });

        // Track token usage
        if (response.usage) {
          this.trackUsage(response.usage);
        }

        // Extract text content
        const content = response.choices[0]?.message?.content;
        if (!content) {
          throw new Error("No content in Grok response");
        }

        // Parse JSON from response — handle markdown code fences
        const jsonStr = this.extractJSON(content);
        return JSON.parse(jsonStr);
      } catch (error: unknown) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Rate limit: respect Retry-After header if available (check before generic retryable)
        if (this.isRateLimited(error) && attempt < this.maxRetries - 1) {
          const retryAfter = this.getRetryAfter(error);
          if (retryAfter) {
            await sleep(retryAfter * 1000);
            continue;
          }
        }

        // Determine if retryable (transient server errors)
        if (this.isRetryable(error) && attempt < this.maxRetries - 1) {
          const delay = BASE_DELAY_MS * Math.pow(2, attempt);
          const jitter = Math.random() * delay * 0.1;
          await sleep(delay + jitter);
          continue;
        }

        throw lastError;
      }
    }

    throw lastError ?? new Error("Max retries exceeded");
  }

  /** Track token usage from a response. */
  private trackUsage(usage: {
    prompt_tokens?: number | null;
    completion_tokens?: number | null;
  }): void {
    const input = usage.prompt_tokens ?? 0;
    const output = usage.completion_tokens ?? 0;
    this._usage.inputTokens += input;
    this._usage.outputTokens += output;
    this._usage.totalTokens += input + output;
    this._usage.estimatedCostUSD =
      (this._usage.inputTokens / 1_000_000) * PRICING.inputPer1M +
      (this._usage.outputTokens / 1_000_000) * PRICING.outputPer1M;
  }

  /** Extract JSON from a response that may be wrapped in markdown fences. */
  private extractJSON(text: string): string {
    const trimmed = text.trim();

    // Try to extract from ```json ... ``` fences
    const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (fenceMatch) {
      return fenceMatch[1].trim();
    }

    // If it starts with { or [, assume raw JSON
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      return trimmed;
    }

    // Last resort: find the first { and last }
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      return trimmed.slice(start, end + 1);
    }

    throw new Error(`Failed to extract JSON from response: ${trimmed.slice(0, 200)}...`);
  }

  /** Check if an error is retryable (transient server errors). */
  private isRetryable(error: unknown): boolean {
    if (error instanceof OpenAI.APIError) {
      return (
        error.status === 429 ||
        error.status === 500 ||
        error.status === 502 ||
        error.status === 503
      );
    }
    // Network errors
    if (error instanceof Error) {
      return (
        error.message.includes("ECONNRESET") ||
        error.message.includes("ETIMEDOUT") ||
        error.message.includes("fetch failed")
      );
    }
    return false;
  }

  /** Check if the error is specifically a rate limit (429). */
  private isRateLimited(error: unknown): boolean {
    return error instanceof OpenAI.APIError && error.status === 429;
  }

  /** Extract Retry-After value from a rate limit error (seconds). */
  private getRetryAfter(error: unknown): number | null {
    if (error instanceof OpenAI.APIError) {
      const headers = error.headers;
      if (headers) {
        const retryAfter =
          (headers as Record<string, string>)["retry-after"];
        if (retryAfter) {
          const parsed = parseInt(retryAfter, 10);
          return isNaN(parsed) ? null : parsed;
        }
      }
    }
    return null;
  }

  /** Build the user prompt for navigation adaptation. */
  private buildNavigationPrompt(webNav: NavigationContext): string {
    const parts: string[] = [];

    parts.push(`# Navigation Adaptation Task`);
    parts.push(``);
    parts.push(
      `Map the following web application's navigation to an idiomatic iOS navigation architecture. The app is a **${webNav.domain}** application.`
    );

    parts.push(``);
    parts.push(`## Web Routes`);
    for (const route of webNav.routes) {
      const flags = [
        route.isLayout ? "layout" : null,
        route.isProtected ? "protected" : null,
      ]
        .filter(Boolean)
        .join(", ");
      parts.push(
        `- \`${route.path}\` → \`${route.componentName}\`${flags ? ` (${flags})` : ""}`
      );
    }

    parts.push(``);
    parts.push(`## Detected Web Navigation Patterns`);
    parts.push(webNav.webPatterns.map((p) => `- ${p}`).join("\n"));

    parts.push(``);
    parts.push(
      `Respond with a single JSON object matching the NavigationPlan schema.`
    );

    return parts.join("\n");
  }

  /** Build the user prompt for state architecture suggestion. */
  private buildStatePrompt(webState: StateContext): string {
    const parts: string[] = [];

    parts.push(`# State Architecture Recommendation Task`);
    parts.push(``);
    parts.push(
      `Recommend an iOS state management architecture for a **${webState.domain}** application, based on its current web state patterns.`
    );

    parts.push(``);
    parts.push(`## State Libraries Used`);
    parts.push(webState.stateLibraries.map((l) => `- ${l}`).join("\n"));

    parts.push(``);
    parts.push(`## Stores / Contexts`);
    for (const store of webState.stores) {
      parts.push(`### ${store.name}`);
      parts.push("```");
      parts.push(store.shape);
      parts.push("```");
      parts.push(`Used by: ${store.usedBy.join(", ")}`);
      parts.push(``);
    }

    parts.push(`## Data Fetching Patterns`);
    parts.push(webState.fetchingPatterns.map((p) => `- ${p}`).join("\n"));

    parts.push(``);
    parts.push(
      `Respond with a single JSON object matching the StateArchitecture schema.`
    );

    return parts.join("\n");
  }
}

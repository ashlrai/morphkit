/**
 * @module ai/providers/grok
 *
 * xAI Grok implementation of the AIProvider interface.
 * Uses the OpenAI SDK pointed at xAI's OpenAI-compatible endpoint.
 * Reuses existing prompt modules from src/ai/prompts/.
 */

import OpenAI from 'openai';
import type {
  AIProvider,
  AIComponentInput,
  AIMapComponentInput,
  AIEntityContext,
  AIIntentResult,
  AIComponentMapResult,
  AIStateArchitectureResult,
  AIEntityFieldsResult,
} from '../provider.js';
import {
  AIIntentResultSchema,
  AIComponentMapResultSchema,
  AIStateArchitectureResultSchema,
  AIEntityFieldsResultSchema,
} from '../provider.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MODEL = 'grok-4-1-fast-reasoning';
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Extract JSON from a response that may be wrapped in markdown fences. */
function extractJSON(text: string): string {
  const trimmed = text.trim();

  const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return trimmed;
  }

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    return trimmed.slice(start, end + 1);
  }

  throw new Error(`Failed to extract JSON from Grok response: ${trimmed.slice(0, 200)}...`);
}

// ---------------------------------------------------------------------------
// GrokProvider
// ---------------------------------------------------------------------------

export class GrokProvider implements AIProvider {
  readonly name = 'grok';
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model?: string) {
    this.client = new OpenAI({
      apiKey,
      baseURL: 'https://api.x.ai/v1',
    });
    this.model = model ?? DEFAULT_MODEL;
  }

  async analyzeIntent(
    component: AIComponentInput,
    context: string,
  ): Promise<AIIntentResult> {
    const systemPrompt = `You are a senior iOS + React engineer. Analyze the intent of a React component and determine its purpose, user goals, and data needs. Respond with valid JSON matching the schema: { purpose: string, userGoals: string[], dataNeeds: string[] }`;

    const userPrompt = [
      `Component: ${component.name}`,
      `Props: ${component.props.join(', ') || 'none'}`,
      `Children: ${component.children.join(', ') || 'none'}`,
      `Hooks: ${component.hooks.join(', ') || 'none'}`,
      `Context: ${context}`,
    ].join('\n');

    const raw = await this.callGrok(systemPrompt, userPrompt);
    return AIIntentResultSchema.parse(raw);
  }

  async mapComponent(
    component: AIMapComponentInput,
    targetPlatform: 'ios',
  ): Promise<AIComponentMapResult> {
    const systemPrompt = `You are a principal-level cross-platform engineer. Map a React component to its most idiomatic SwiftUI (iOS 17+) equivalent. Respond with valid JSON matching the schema: { swiftUIView: string, layout: string, modifiers: string[] }`;

    const userPrompt = [
      `Component: ${component.name}`,
      `JSX Elements: ${component.jsxElements.join(', ') || 'none'}`,
      `Props: ${component.props.join(', ') || 'none'}`,
      `Target: ${targetPlatform}`,
    ].join('\n');

    const raw = await this.callGrok(systemPrompt, userPrompt);
    return AIComponentMapResultSchema.parse(raw);
  }

  async suggestStateArchitecture(
    statePatterns: any[],
    screens: string[],
  ): Promise<AIStateArchitectureResult> {
    const systemPrompt = `You are a senior iOS architect. Recommend an iOS state management architecture using @Observable (iOS 17+), @Environment for DI, and @State for view-local state. Respond with valid JSON matching the schema: { stores: [{ name, responsibilities, scope }], bindings: [{ screen, store, properties }] }`;

    const patternsDesc = statePatterns.map((sp: any) =>
      `- ${sp.name || 'unnamed'} (${sp.kind || sp.type || 'unknown'}, scope: ${sp.scope || 'local'})`,
    ).join('\n');

    const userPrompt = [
      `Screens: ${screens.join(', ')}`,
      `Web state patterns:`,
      patternsDesc || '- none',
    ].join('\n');

    const raw = await this.callGrok(systemPrompt, userPrompt);
    return AIStateArchitectureResultSchema.parse(raw);
  }

  async enhanceEntityFields(
    entityName: string,
    context: AIEntityContext,
  ): Promise<AIEntityFieldsResult> {
    const systemPrompt = `You are a data modeling expert. Infer the fields for a data entity based on how it's used in a codebase. Return Swift-compatible types. Respond with valid JSON matching the schema: { fields: [{ name: string, type: string, optional: boolean }] }`;

    const userPrompt = [
      `Entity: ${entityName}`,
      `Usages: ${context.usages.join(', ') || 'none'}`,
      `API endpoints: ${context.apiEndpoints.join(', ') || 'none'}`,
      `State shapes: ${context.stateShapes.join(', ') || 'none'}`,
    ].join('\n');

    const raw = await this.callGrok(systemPrompt, userPrompt);
    return AIEntityFieldsResultSchema.parse(raw);
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private async callGrok(
    systemPrompt: string,
    userPrompt: string,
  ): Promise<unknown> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const response = await Promise.race([
          this.client.chat.completions.create({
            model: this.model,
            max_tokens: 4096,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: systemPrompt + '\n\nRespond with valid JSON.' },
              { role: 'user', content: userPrompt },
            ],
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Grok API call timed out')), TIMEOUT_MS),
          ),
        ]);

        const content = response.choices[0]?.message?.content;
        if (!content) {
          throw new Error('No content in Grok response');
        }

        return JSON.parse(extractJSON(content));
      } catch (error: unknown) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < MAX_RETRIES - 1 && this.isRetryable(error)) {
          const delay = BASE_DELAY_MS * Math.pow(2, attempt);
          const jitter = Math.random() * delay * 0.1;
          await sleep(delay + jitter);
          continue;
        }

        throw lastError;
      }
    }

    throw lastError ?? new Error('Max retries exceeded');
  }

  private isRetryable(error: unknown): boolean {
    if (error instanceof OpenAI.APIError) {
      return (
        error.status === 429 ||
        error.status === 500 ||
        error.status === 502 ||
        error.status === 503
      );
    }
    if (error instanceof Error) {
      return (
        error.message.includes('ECONNRESET') ||
        error.message.includes('ETIMEDOUT') ||
        error.message.includes('fetch failed') ||
        error.message.includes('timed out')
      );
    }
    return false;
  }
}

/**
 * @module ai/providers/claude
 *
 * Claude (Anthropic) implementation of the AIProvider interface.
 * Uses tool_use for structured output to get typed JSON responses.
 */

import Anthropic from '@anthropic-ai/sdk';

import type {
  AIProvider,
  AIComponentInput,
  AIMapComponentInput,
  AIEntityContext,
  AIIntentResult,
  AIComponentMapResult,
  AIStateArchitectureResult,
  AIEntityFieldsResult,
  AIViewGenerationInput,
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

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Tool Definitions (for structured output via tool_use)
// ---------------------------------------------------------------------------

const ANALYZE_INTENT_TOOL: Anthropic.Tool = {
  name: 'analyze_intent_result',
  description: 'Return the structured intent analysis result.',
  input_schema: {
    type: 'object' as const,
    properties: {
      purpose: { type: 'string', description: 'High-level description of what this component accomplishes' },
      userGoals: { type: 'array', items: { type: 'string' }, description: 'End-user goals this screen serves' },
      dataNeeds: { type: 'array', items: { type: 'string' }, description: 'Data entities or API calls this component requires' },
    },
    required: ['purpose', 'userGoals', 'dataNeeds'],
  },
};

const MAP_COMPONENT_TOOL: Anthropic.Tool = {
  name: 'map_component_result',
  description: 'Return the structured SwiftUI component mapping result.',
  input_schema: {
    type: 'object' as const,
    properties: {
      swiftUIView: { type: 'string', description: 'Primary SwiftUI view type' },
      layout: { type: 'string', description: 'Layout strategy' },
      modifiers: { type: 'array', items: { type: 'string' }, description: 'SwiftUI modifiers to apply' },
    },
    required: ['swiftUIView', 'layout', 'modifiers'],
  },
};

const STATE_ARCHITECTURE_TOOL: Anthropic.Tool = {
  name: 'state_architecture_result',
  description: 'Return the structured state architecture recommendation.',
  input_schema: {
    type: 'object' as const,
    properties: {
      stores: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            responsibilities: { type: 'array', items: { type: 'string' } },
            scope: { type: 'string', enum: ['app', 'feature', 'view'] },
          },
          required: ['name', 'responsibilities', 'scope'],
        },
      },
      bindings: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            screen: { type: 'string' },
            store: { type: 'string' },
            properties: { type: 'array', items: { type: 'string' } },
          },
          required: ['screen', 'store', 'properties'],
        },
      },
    },
    required: ['stores', 'bindings'],
  },
};

const ENTITY_FIELDS_TOOL: Anthropic.Tool = {
  name: 'entity_fields_result',
  description: 'Return the inferred entity fields.',
  input_schema: {
    type: 'object' as const,
    properties: {
      fields: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            type: { type: 'string', description: 'Swift-compatible type' },
            optional: { type: 'boolean' },
          },
          required: ['name', 'type', 'optional'],
        },
      },
    },
    required: ['fields'],
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Extract tool_use input from a Claude response.
 * Looks for the first tool_use content block and returns its input.
 */
function extractToolInput(response: Anthropic.Message): unknown {
  for (const block of response.content) {
    if (block.type === 'tool_use') {
      return block.input;
    }
  }
  throw new Error('No tool_use block found in Claude response');
}

// ---------------------------------------------------------------------------
// ClaudeProvider
// ---------------------------------------------------------------------------

export class ClaudeProvider implements AIProvider {
  readonly name = 'claude';
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model?: string) {
    this.client = new Anthropic({ apiKey });
    this.model = model ?? DEFAULT_MODEL;
  }

  async analyzeIntent(
    component: AIComponentInput,
    context: string,
  ): Promise<AIIntentResult> {
    const userPrompt = [
      `Analyze the intent of this React component:`,
      ``,
      `Component: ${component.name}`,
      `Props: ${component.props.join(', ') || 'none'}`,
      `Children: ${component.children.join(', ') || 'none'}`,
      `Hooks: ${component.hooks.join(', ') || 'none'}`,
      ``,
      `Context: ${context}`,
      ``,
      `Determine the component's purpose, user goals, and data needs. Use the analyze_intent_result tool to return your analysis.`,
    ].join('\n');

    const raw = await this.callWithTool(userPrompt, ANALYZE_INTENT_TOOL);
    return AIIntentResultSchema.parse(raw);
  }

  async mapComponent(
    component: AIMapComponentInput,
    targetPlatform: 'ios',
  ): Promise<AIComponentMapResult> {
    const userPrompt = [
      `Map this React component to SwiftUI (${targetPlatform}, iOS 17+):`,
      ``,
      `Component: ${component.name}`,
      `JSX Elements: ${component.jsxElements.join(', ') || 'none'}`,
      `Props: ${component.props.join(', ') || 'none'}`,
      ``,
      `Choose the most idiomatic SwiftUI view, layout, and modifiers. Use the map_component_result tool to return your mapping.`,
    ].join('\n');

    const raw = await this.callWithTool(userPrompt, MAP_COMPONENT_TOOL);
    return AIComponentMapResultSchema.parse(raw);
  }

  async suggestStateArchitecture(
    statePatterns: any[],
    screens: string[],
  ): Promise<AIStateArchitectureResult> {
    const patternsDesc = statePatterns.map((sp: any) =>
      `- ${sp.name || 'unnamed'} (${sp.kind || sp.type || 'unknown'}, scope: ${sp.scope || 'local'})`,
    ).join('\n');

    const userPrompt = [
      `Recommend an iOS state management architecture for a SwiftUI app with these screens:`,
      screens.map((s) => `- ${s}`).join('\n'),
      ``,
      `Current web state patterns:`,
      patternsDesc || '- none detected',
      ``,
      `Use @Observable classes (iOS 17+), @Environment for DI, @State for view-local state.`,
      `Use the state_architecture_result tool to return your recommendation.`,
    ].join('\n');

    const raw = await this.callWithTool(userPrompt, STATE_ARCHITECTURE_TOOL);
    return AIStateArchitectureResultSchema.parse(raw);
  }

  async enhanceEntityFields(
    entityName: string,
    context: AIEntityContext,
  ): Promise<AIEntityFieldsResult> {
    const userPrompt = [
      `Infer the fields for a data entity named "${entityName}" based on how it's used in the codebase:`,
      ``,
      `Usages: ${context.usages.join(', ') || 'none found'}`,
      `API endpoints: ${context.apiEndpoints.join(', ') || 'none found'}`,
      `State shapes: ${context.stateShapes.join(', ') || 'none found'}`,
      ``,
      `Infer realistic fields (name, Swift-compatible type, optional) for this entity.`,
      `Include an "id" field if it looks like a database entity.`,
      `Use the entity_fields_result tool to return the fields.`,
    ].join('\n');

    const raw = await this.callWithTool(userPrompt, ENTITY_FIELDS_TOOL);
    return AIEntityFieldsResultSchema.parse(raw);
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  /**
   * Call Claude with a forced tool_use for structured output.
   * Includes retry logic with exponential backoff.
   */
  private async callWithTool(
    userPrompt: string,
    tool: Anthropic.Tool,
  ): Promise<unknown> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const response = await Promise.race([
          this.client.messages.create({
            model: this.model,
            max_tokens: 4096,
            tools: [tool],
            tool_choice: { type: 'tool', name: tool.name },
            messages: [{ role: 'user', content: userPrompt }],
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Claude API call timed out')), TIMEOUT_MS),
          ),
        ]);

        return extractToolInput(response);
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

  /** Check if an error is retryable (rate limits, server errors, network). */
  private isRetryable(error: unknown): boolean {
    if (error instanceof Anthropic.APIError) {
      return (
        error.status === 429 ||
        error.status === 500 ||
        error.status === 502 ||
        error.status === 503 ||
        error.status === 529
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

  async generateViewCode(input: AIViewGenerationInput): Promise<string | null> {
    const systemPrompt = `You are an expert at converting React/Next.js components to native SwiftUI for iOS 17+.

Given a React component's source code, generate the equivalent SwiftUI view body.

Rules:
${input.rules.map(r => `- ${r}`).join('\n')}

Available model types:
${input.entityTypes}

Data fetching pattern: ${input.fetchPattern}

IMPORTANT:
- Return ONLY the Swift code for the complete struct (import, struct declaration, body, and any helper methods)
- Do NOT include markdown code fences or explanations
- The view must be a valid SwiftUI View struct
- Include @State properties for any local state
- Include a loadData() async function if the component fetches data
- Use .task { await loadData() } for initial data loading
- Handle loading and error states`;

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: `Convert this React component "${input.screenName}" to SwiftUI:\n\n${input.reactSource}`,
        }],
      });

      const text = response.content
        .filter(block => block.type === 'text')
        .map(block => (block as { type: 'text'; text: string }).text)
        .join('');

      if (!text || text.length < 30) return null;

      // Strip markdown code fences if present
      const cleaned = text.replace(/^```swift\n?/, '').replace(/\n?```$/, '').trim();
      return cleaned;
    } catch (error) {
      console.log(`[morphkit] AI view generation failed for ${input.screenName}: ${(error as Error).message}`);
      return null;
    }
  }
}

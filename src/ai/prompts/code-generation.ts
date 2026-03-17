/**
 * @module prompts/code-generation
 *
 * Prompt templates for generating complete, production-ready SwiftUI code.
 * Includes best-practice guidelines for iOS 17+ and a structured output
 * schema that the model must follow.
 */

import type { IntentAnalysis, SwiftUIMapping, PropertyDef } from "../structured-output.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Full context needed to generate a SwiftUI screen. */
export interface ScreenGenContext {
  /** Name for the generated SwiftUI View. */
  viewName: string;
  /** Intent analysis from the earlier phase. */
  intent: IntentAnalysis;
  /** Component mapping from the earlier phase. */
  mapping: SwiftUIMapping;
  /** Additional state properties beyond what mapping detected. */
  additionalState?: PropertyDef[];
  /** Navigation context — how this view is reached and where it can go. */
  navigation?: {
    presentedAs: "push" | "sheet" | "fullScreenCover" | "root";
    canNavigateTo: string[];
  };
  /** Data models / types this view needs (Swift struct definitions or names). */
  dataModels?: string[];
  /** Any API service methods the view should call. */
  apiMethods?: Array<{ name: string; signature: string; description: string }>;
  /** Original React source code for reference. */
  originalSource?: string;
}

// ---------------------------------------------------------------------------
// System Prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a world-class SwiftUI engineer generating production-quality iOS 17+ code. You follow Apple's Human Interface Guidelines and modern SwiftUI best practices.

## Mandatory SwiftUI Conventions (iOS 17+)

### State Management
- Use \`@Observable\` macro (from Observation framework), NOT \`ObservableObject\` / \`@Published\`.
- Use \`@State\` for view-local state.
- Use \`@Binding\` for child views that mutate parent state.
- Use \`@Environment\` for dependency injection.
- Use \`@Bindable\` when you need bindings from an \`@Observable\` object.

### Navigation
- Use \`NavigationStack\` with \`NavigationLink(value:)\` + \`.navigationDestination(for:)\`, NOT \`NavigationView\`.
- Use \`.sheet(item:)\` or \`.sheet(isPresented:)\` for modals.
- Use \`.fullScreenCover\` sparingly, only for immersive flows.

### Async Work
- Use \`.task { }\` for async work on view appear — NOT \`.onAppear\` with Task { }.
- Use \`.task(id: value) { }\` to re-run when a dependency changes.
- Use \`async let\` for parallel fetches.

### Previews
- Use \`#Preview { }\` macro, NOT \`PreviewProvider\` structs.
- Provide meaningful preview data.

### Code Style
- Keep \`body\` focused — extract complex subviews into computed properties or private methods returning \`some View\`.
- Use \`ViewThatFits\` for adaptive layouts where appropriate.
- Use \`.contentTransition(.numericText())\` for animating number changes.
- Prefer \`.foregroundStyle\` over deprecated \`.foregroundColor\`.
- Group related modifiers logically.
- Add brief doc comments on the main struct and any non-obvious helpers.

### Accessibility
- Always provide labels for interactive elements.
- Use \`.accessibilityLabel\` and \`.accessibilityHint\` where needed.
- Support Dynamic Type — avoid hardcoded font sizes.

## Output Requirements
Respond with a single JSON object matching the GeneratedCode schema:
- \`code\`: Complete, compilable SwiftUI source file content.
- \`imports\`: Array of import statements needed (e.g. ["SwiftUI", "Observation"]).
- \`dependencies\`: External SPM packages needed (empty array if none).
- \`confidence\`: 0-1 score of how well the generated code matches the original intent.
- \`notes\`: Array of caveats, TODOs, or things the developer should review.

Do not include any text outside the JSON object.`;

// ---------------------------------------------------------------------------
// JSON Schema (for structured output / tool_use)
// ---------------------------------------------------------------------------

/**
 * JSON schema describing the expected response shape.
 * Used with response_format to enforce structured output.
 */
export const CODE_GENERATION_RESPONSE_SCHEMA = {
  type: "object" as const,
  required: ["code", "imports", "dependencies", "confidence", "notes"],
  properties: {
    code: {
      type: "string",
      description: "Complete SwiftUI source file content",
    },
    imports: {
      type: "array",
      items: { type: "string" },
      description: "Required import statements",
    },
    dependencies: {
      type: "array",
      items: { type: "string" },
      description: "External SPM package dependencies",
    },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
      description: "Confidence score for code quality",
    },
    notes: {
      type: "array",
      items: { type: "string" },
      description: "Caveats or TODOs for the developer",
    },
  },
  additionalProperties: false,
};

// ---------------------------------------------------------------------------
// Prompt Builder
// ---------------------------------------------------------------------------

/**
 * Build the prompt for generating a complete SwiftUI view.
 *
 * @param screen - Full context for the screen to generate.
 * @returns The assembled user prompt string.
 */
export function buildCodeGenerationPrompt(screen: ScreenGenContext): string {
  const parts: string[] = [];

  parts.push(`# SwiftUI Code Generation Task`);
  parts.push(``);
  parts.push(
    `Generate a complete, production-ready SwiftUI View named **\`${screen.viewName}\`**.`
  );

  // Intent summary
  parts.push(``);
  parts.push(`## Intent`);
  parts.push(`- **Purpose:** ${screen.intent.purpose}`);
  parts.push(`- **User Goals:** ${screen.intent.userGoals.join("; ")}`);
  if (screen.intent.businessLogic.length > 0) {
    parts.push(`- **Business Logic:** ${screen.intent.businessLogic.join("; ")}`);
  }
  if (screen.intent.uxPatterns.length > 0) {
    parts.push(`- **UX Patterns:** ${screen.intent.uxPatterns.join("; ")}`);
  }
  parts.push(
    `- **Suggested iOS Pattern:** ${screen.intent.suggestedIOSPattern}`
  );

  // Mapping
  parts.push(``);
  parts.push(`## Component Mapping`);
  parts.push(`- **Primary SwiftUI Component:** ${screen.mapping.swiftUIComponent}`);
  parts.push(`- **Modifiers:** ${screen.mapping.modifiers.join(", ") || "(none)"}`);
  parts.push(`- **Mapping Reasoning:** ${screen.mapping.reasoning}`);

  // State
  parts.push(``);
  parts.push(`## State Properties`);
  const allState = [
    ...screen.mapping.stateProperties,
    ...(screen.additionalState ?? []),
  ];
  if (allState.length > 0) {
    for (const prop of allState) {
      parts.push(
        `- \`${prop.wrapper} ${prop.name}: ${prop.type}\`${prop.defaultValue ? ` = ${prop.defaultValue}` : ""}`
      );
    }
  } else {
    parts.push("- (to be determined — infer from intent and mapping)");
  }

  // Navigation
  if (screen.navigation) {
    parts.push(``);
    parts.push(`## Navigation Context`);
    parts.push(`- **Presented as:** ${screen.navigation.presentedAs}`);
    if (screen.navigation.canNavigateTo.length > 0) {
      parts.push(
        `- **Can navigate to:** ${screen.navigation.canNavigateTo.join(", ")}`
      );
    }
  }

  // Data models
  if (screen.dataModels?.length) {
    parts.push(``);
    parts.push(`## Data Models`);
    parts.push(
      `The following Swift types are available (define stubs if body is unknown):`
    );
    for (const model of screen.dataModels) {
      parts.push(`- \`${model}\``);
    }
  }

  // API methods
  if (screen.apiMethods?.length) {
    parts.push(``);
    parts.push(`## API Methods Available`);
    for (const method of screen.apiMethods) {
      parts.push(`- \`${method.signature}\` — ${method.description}`);
    }
  }

  // Original source for reference
  if (screen.originalSource) {
    parts.push(``);
    parts.push(`## Original React Source (for reference)`);
    parts.push("```tsx");
    parts.push(screen.originalSource);
    parts.push("```");
  }

  // Requirements
  parts.push(``);
  parts.push(`## Requirements`);
  parts.push(`1. Generate a COMPLETE SwiftUI source file — it must compile.`);
  parts.push(`2. Include a \`#Preview\` block with meaningful sample data.`);
  parts.push(`3. Extract complex subviews into private computed properties or methods.`);
  parts.push(`4. Follow ALL conventions from the system prompt (iOS 17+ APIs only).`);
  parts.push(`5. Add brief doc comments on the main struct.`);
  parts.push(`6. Include proper accessibility labels on interactive elements.`);
  parts.push(``);
  parts.push(
    `Respond with a single JSON object matching the GeneratedCode schema.`
  );

  return parts.join("\n");
}

/**
 * System prompt for code generation calls.
 */
export const CODE_GENERATION_SYSTEM_PROMPT = SYSTEM_PROMPT;

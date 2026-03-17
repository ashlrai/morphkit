/**
 * @module structured-output
 *
 * Zod schemas and inferred types for all Grok API structured responses.
 * Every AI method in GrokClient returns data validated against these schemas,
 * ensuring type-safe, predictable outputs.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared / Reusable Definitions
// ---------------------------------------------------------------------------

/** A single property definition used across multiple schemas. */
const PropertyDefSchema = z.object({
  name: z.string().describe("Swift property name"),
  type: z.string().describe("Swift type, e.g. String, Int, [Item]"),
  wrapper: z
    .enum(["@State", "@Binding", "@Environment", "@Observable", "let", "var"])
    .describe("SwiftUI property wrapper or declaration keyword"),
  defaultValue: z.string().optional().describe("Default value expression, if any"),
});

/** Tab definition for tab-based navigation. */
const TabDefSchema = z.object({
  label: z.string(),
  systemImage: z.string().describe("SF Symbol name"),
  destination: z.string().describe("SwiftUI View type name"),
});

/** Route definition for stack-based navigation. */
const RouteDefSchema = z.object({
  path: z.string().describe("Original web route path, e.g. /products/:id"),
  viewName: z.string().describe("Target SwiftUI View type"),
  presentation: z
    .enum(["push", "sheet", "fullScreenCover", "alert"])
    .describe("How the route is presented in iOS"),
  parameters: z.array(z.string()).optional().describe("Route parameters"),
});

/** Store definition for state architecture recommendations. */
const StoreDefSchema = z.object({
  name: z.string().describe("Observable class name"),
  responsibilities: z
    .array(z.string())
    .describe("What this store is responsible for"),
  properties: z.array(PropertyDefSchema),
  scope: z
    .enum(["app", "feature", "view"])
    .describe("Lifetime / scope of the store"),
});

// ---------------------------------------------------------------------------
// Intent Analysis
// ---------------------------------------------------------------------------

/** Schema for what Grok returns when analyzing component intent. */
export const IntentAnalysisSchema = z.object({
  purpose: z
    .string()
    .describe(
      "High-level description of what this component accomplishes, e.g. 'Product listing with category filters and infinite scroll'"
    ),
  userGoals: z
    .array(z.string())
    .describe(
      "End-user goals this screen serves, e.g. 'Browse products', 'Filter by category'"
    ),
  businessLogic: z
    .array(z.string())
    .describe(
      "Business rules embedded in the UI, e.g. 'Only shows in-stock items by default'"
    ),
  uxPatterns: z
    .array(z.string())
    .describe(
      "Implicit UX patterns detected, e.g. 'infinite scroll', 'optimistic update', 'skeleton loading'"
    ),
  suggestedIOSPattern: z
    .string()
    .describe(
      "Recommended iOS UI pattern, e.g. 'List with searchable modifier and pull-to-refresh'"
    ),
});

export type IntentAnalysis = z.infer<typeof IntentAnalysisSchema>;

// ---------------------------------------------------------------------------
// SwiftUI Component Mapping
// ---------------------------------------------------------------------------

/** Schema for what Grok returns when mapping a web component to SwiftUI. */
export const SwiftUIMappingSchema = z.object({
  swiftUIComponent: z
    .string()
    .describe("Primary SwiftUI component to use, e.g. 'List', 'NavigationStack'"),
  modifiers: z
    .array(z.string())
    .describe(
      "SwiftUI modifiers to apply, e.g. ['.padding()', '.font(.headline)', '.foregroundStyle(.secondary)']"
    ),
  stateProperties: z
    .array(PropertyDefSchema)
    .describe("State properties the SwiftUI view needs"),
  reasoning: z
    .string()
    .describe("Explanation of why this mapping was chosen over alternatives"),
});

export type SwiftUIMapping = z.infer<typeof SwiftUIMappingSchema>;

// ---------------------------------------------------------------------------
// Generated Code
// ---------------------------------------------------------------------------

/** Schema for code generation responses. */
export const GeneratedCodeSchema = z.object({
  code: z.string().describe("Complete SwiftUI source code for the view"),
  imports: z
    .array(z.string())
    .describe("Required import statements, e.g. ['SwiftUI', 'Observation']"),
  dependencies: z
    .array(z.string())
    .describe(
      "External SPM dependencies needed, e.g. ['SDWebImageSwiftUI', 'Alamofire']"
    ),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("0-1 confidence score for the generated code quality"),
  notes: z
    .array(z.string())
    .describe(
      "Caveats, TODOs, or manual steps the developer should be aware of"
    ),
});

export type GeneratedCode = z.infer<typeof GeneratedCodeSchema>;

// ---------------------------------------------------------------------------
// Navigation Plan
// ---------------------------------------------------------------------------

/** Schema for iOS navigation architecture recommendations. */
export const NavigationPlanSchema = z.object({
  pattern: z
    .enum(["tab", "stack", "mixed"])
    .describe("Top-level navigation pattern"),
  tabs: z
    .array(TabDefSchema)
    .optional()
    .describe("Tab definitions if pattern is 'tab' or 'mixed'"),
  routes: z.array(RouteDefSchema).describe("All navigable routes"),
  reasoning: z
    .string()
    .describe("Explanation of the chosen navigation architecture"),
});

export type iOSNavigationPlan = z.infer<typeof NavigationPlanSchema>;

// ---------------------------------------------------------------------------
// State Architecture
// ---------------------------------------------------------------------------

/** Schema for state management architecture recommendations. */
export const StateArchitectureSchema = z.object({
  approach: z
    .string()
    .describe(
      "High-level approach name, e.g. '@Observable stores with Environment injection'"
    ),
  stores: z.array(StoreDefSchema).describe("Recommended observable stores"),
  reasoning: z
    .string()
    .describe("Explanation of why this state architecture was chosen"),
});

export type iOSStateArchitecture = z.infer<typeof StateArchitectureSchema>;

// ---------------------------------------------------------------------------
// Re-exported sub-types
// ---------------------------------------------------------------------------

export type PropertyDef = z.infer<typeof PropertyDefSchema>;
export type TabDef = z.infer<typeof TabDefSchema>;
export type RouteDef = z.infer<typeof RouteDefSchema>;
export type StoreDef = z.infer<typeof StoreDefSchema>;

export {
  PropertyDefSchema,
  TabDefSchema,
  RouteDefSchema,
  StoreDefSchema,
};

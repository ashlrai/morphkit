/**
 * @module prompts/component-mapping
 *
 * Prompt templates for mapping extracted React / web components to their
 * SwiftUI equivalents. Includes comprehensive mapping rules, Tailwind-to-SwiftUI
 * modifier translations, and guidance for complex interaction patterns.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Information extracted from a React component during the analysis phase. */
export interface ExtractedComponentInfo {
  /** The component's display name / export name. */
  name: string;
  /** JSX element types used, e.g. ["div", "button", "input", "img"]. */
  jsxElements: string[];
  /** CSS / Tailwind classes detected. */
  cssClasses: string[];
  /** React hooks used, e.g. ["useState", "useEffect", "useRef"]. */
  hooks: string[];
  /** Event handlers, e.g. ["onClick", "onChange", "onSubmit"]. */
  eventHandlers: string[];
  /** Props the component accepts (name + type). */
  props: Array<{ name: string; type: string }>;
  /** State variables (name + initial value description). */
  stateVariables: Array<{ name: string; initialValue: string }>;
  /** Any detected interaction patterns (from intent analysis). */
  uxPatterns: string[];
  /** Raw source code for reference. */
  sourceCode: string;
}

// ---------------------------------------------------------------------------
// Mapping Reference (embedded in prompt)
// ---------------------------------------------------------------------------

const ELEMENT_MAPPING_REFERENCE = `
## Core Element Mapping Reference

| Web / React                        | SwiftUI Equivalent                                   |
|------------------------------------|------------------------------------------------------|
| \`<div className="flex flex-row">\`  | \`HStack { }\`                                         |
| \`<div className="flex flex-col">\`  | \`VStack { }\`                                         |
| \`<div className="grid grid-cols-N">\` | \`LazyVGrid(columns: Array(repeating: .flexible(), count: N))\` |
| \`<div>\` (generic container)        | \`VStack\` or \`Group\` depending on context              |
| \`<button onClick={fn}>\`           | \`Button(action: fn) { Label(...) }\`                  |
| \`<a href="...">\`                  | \`NavigationLink(destination:) { }\` or \`Link(url:)\`  |
| \`<input type="text">\`             | \`TextField("placeholder", text: $binding)\`           |
| \`<input type="password">\`         | \`SecureField("placeholder", text: $binding)\`         |
| \`<input type="number">\`           | \`TextField("", value: $binding, format: .number)\`    |
| \`<textarea>\`                      | \`TextEditor(text: $binding)\`                         |
| \`<input type="checkbox">\`         | \`Toggle(isOn: $binding) { Text("label") }\`           |
| \`<input type="range">\`            | \`Slider(value: $binding, in: range)\`                 |
| \`<select>\` / \`<option>\`           | \`Picker("label", selection: $binding) { ForEach }\`   |
| \`<img src={url}>\`                 | \`AsyncImage(url: URL(string: url))\`                  |
| \`<ul><li>\` / mapped arrays        | \`List { ForEach(items) { item in ... } }\`            |
| \`<form onSubmit>\`                 | \`Form { } + Button for submit\`                       |
| \`<dialog>\` / modal                | \`.sheet(isPresented:) { }\`                           |
| \`<div role="alert">\` / toast      | \`.alert(isPresented:) { }\` or custom overlay         |
| \`<nav>\` with links                | \`TabView\` or \`NavigationStack\`                       |
| \`<header>\`                        | \`.toolbar { ToolbarItem(.principal) { } }\`           |
| \`<footer>\`                        | \`.safeAreaInset(edge: .bottom) { }\`                  |

## Tailwind → SwiftUI Modifier Mapping

| Tailwind Class         | SwiftUI Modifier                                      |
|------------------------|-------------------------------------------------------|
| \`p-{n}\`               | \`.padding(.all, CGFloat(n * 4))\`                     |
| \`px-{n}\`, \`py-{n}\`    | \`.padding(.horizontal, ...)\`, \`.padding(.vertical, ...)\` |
| \`m-{n}\`               | \`.padding(.all, ...)\` on parent or Spacer             |
| \`rounded-lg\`          | \`.clipShape(RoundedRectangle(cornerRadius: 12))\`     |
| \`rounded-full\`        | \`.clipShape(Circle())\`                               |
| \`shadow-md\`           | \`.shadow(radius: 4)\`                                 |
| \`bg-{color}-{shade}\`  | \`.background(Color.{mapped})\`                        |
| \`text-{color}-{shade}\`| \`.foregroundStyle(Color.{mapped})\`                   |
| \`text-sm\`             | \`.font(.subheadline)\`                                |
| \`text-base\`           | \`.font(.body)\`                                       |
| \`text-lg\`             | \`.font(.title3)\`                                     |
| \`text-xl\`             | \`.font(.title2)\`                                     |
| \`text-2xl\`            | \`.font(.title)\`                                      |
| \`text-3xl\`            | \`.font(.largeTitle)\`                                 |
| \`font-bold\`           | \`.fontWeight(.bold)\`                                 |
| \`font-semibold\`       | \`.fontWeight(.semibold)\`                             |
| \`opacity-{n}\`         | \`.opacity(Double(n) / 100)\`                          |
| \`hidden\`              | Conditional rendering or \`.hidden()\`                  |
| \`w-full\`              | \`.frame(maxWidth: .infinity)\`                        |
| \`h-full\`              | \`.frame(maxHeight: .infinity)\`                       |
| \`space-x-{n}\`         | \`HStack(spacing: CGFloat(n * 4))\`                    |
| \`space-y-{n}\`         | \`VStack(spacing: CGFloat(n * 4))\`                    |
| \`overflow-y-scroll\`   | \`ScrollView(.vertical)\`                              |
| \`border\`              | \`.overlay(RoundedRectangle(...).stroke(...))\`        |

## Complex Pattern Mapping

| Web Pattern                  | SwiftUI Implementation                                              |
|------------------------------|---------------------------------------------------------------------|
| Infinite scroll              | \`LazyVStack\` + \`.onAppear\` on last item to fetch next page         |
| Pull to refresh              | \`List { }.refreshable { await reload() }\`                          |
| Drag and drop                | \`.draggable(item)\` + \`.dropDestination(for:action:)\`               |
| Skeleton loading             | \`RedactedShimmer()\` custom view with \`.redacted(reason: .placeholder)\` |
| Optimistic update            | Update \`@State\` immediately, revert on API failure                  |
| Debounced search             | \`.searchable(text:)\` + \`.task(id: searchText) { try await Task.sleep; fetch() }\` |
| Tabs                         | \`TabView { }.tabItem { }\`                                          |
| Accordion / collapsible      | \`DisclosureGroup("title") { content }\`                             |
| Swipe actions on list items  | \`.swipeActions(edge:) { Button { } }\`                              |
| Context menu                 | \`.contextMenu { Button { } }\`                                      |
| Animations / transitions     | \`.animation(.default, value: trigger)\` + \`withAnimation { }\`      |
| Popover                      | \`.popover(isPresented:) { }\`                                       |
| Date picker                  | \`DatePicker("label", selection: $date)\`                            |
| Step indicator / progress    | \`ProgressView(value:total:)\` or custom \`Stepper\`                   |
`;

// ---------------------------------------------------------------------------
// System Prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a principal-level engineer specializing in cross-platform UI architecture, with deep expertise in both React/Next.js (including Tailwind CSS) and SwiftUI (iOS 17+).

Your task is to map a web component to its most idiomatic SwiftUI equivalent. You must:

1. Choose the **best-fit SwiftUI component**, not just a literal translation. Prefer native iOS patterns that feel natural to iOS users.
2. List all **SwiftUI modifiers** needed to replicate the styling and behavior.
3. Define the **state properties** the SwiftUI view will need, including the appropriate property wrapper.
4. Provide clear **reasoning** for your choices, especially when the mapping is non-obvious.

Key principles:
- Prefer SwiftUI-native patterns over porting web patterns directly.
- Use iOS 17+ APIs: @Observable (not ObservableObject), NavigationStack (not NavigationView), #Preview (not PreviewProvider).
- When a web pattern has no direct SwiftUI equivalent, recommend the closest idiomatic approach and note the tradeoff.
- Consider accessibility: if the web component uses aria attributes, ensure the SwiftUI equivalent uses proper accessibility modifiers.

Respond with valid JSON matching the SwiftUIMapping schema.`;

// ---------------------------------------------------------------------------
// Prompt Builder
// ---------------------------------------------------------------------------

/**
 * Build the prompt for mapping a web component to SwiftUI.
 *
 * @param component - Extracted information about the React component.
 * @param targetPlatform - Target platform (currently only 'ios').
 * @returns The assembled user prompt string.
 */
export function buildComponentMappingPrompt(
  component: ExtractedComponentInfo,
  targetPlatform: "ios" = "ios"
): string {
  const parts: string[] = [];

  parts.push(`# Component Mapping Task`);
  parts.push(``);
  parts.push(
    `Map the following React component to its idiomatic SwiftUI (${targetPlatform === "ios" ? "iOS 17+" : targetPlatform}) equivalent.`
  );

  parts.push(``);
  parts.push(`## Component: \`${component.name}\``);

  parts.push(``);
  parts.push(`### Props`);
  if (component.props.length > 0) {
    parts.push(
      component.props.map((p) => `- \`${p.name}: ${p.type}\``).join("\n")
    );
  } else {
    parts.push("- (none)");
  }

  parts.push(``);
  parts.push(`### JSX Elements Used`);
  parts.push(component.jsxElements.map((el) => `- \`<${el}>\``).join("\n"));

  parts.push(``);
  parts.push(`### CSS / Tailwind Classes`);
  if (component.cssClasses.length > 0) {
    parts.push(component.cssClasses.map((c) => `- \`${c}\``).join("\n"));
  } else {
    parts.push("- (none detected)");
  }

  parts.push(``);
  parts.push(`### React Hooks`);
  parts.push(component.hooks.map((h) => `- \`${h}\``).join("\n"));

  parts.push(``);
  parts.push(`### Event Handlers`);
  if (component.eventHandlers.length > 0) {
    parts.push(component.eventHandlers.map((e) => `- \`${e}\``).join("\n"));
  } else {
    parts.push("- (none)");
  }

  parts.push(``);
  parts.push(`### State Variables`);
  if (component.stateVariables.length > 0) {
    parts.push(
      component.stateVariables
        .map((s) => `- \`${s.name}\` (initial: \`${s.initialValue}\`)`)
        .join("\n")
    );
  } else {
    parts.push("- (none)");
  }

  parts.push(``);
  parts.push(`### Detected UX Patterns`);
  if (component.uxPatterns.length > 0) {
    parts.push(component.uxPatterns.map((p) => `- ${p}`).join("\n"));
  } else {
    parts.push("- (none detected)");
  }

  parts.push(``);
  parts.push(`### Source Code`);
  parts.push("```tsx");
  parts.push(component.sourceCode);
  parts.push("```");

  parts.push(``);
  parts.push(ELEMENT_MAPPING_REFERENCE);

  parts.push(``);
  parts.push(
    `Using the reference tables above and your expertise, provide the optimal SwiftUI mapping. Respond with a single JSON object matching the SwiftUIMapping schema. Do not include text outside the JSON.`
  );

  return parts.join("\n");
}

/**
 * System prompt for component mapping calls.
 */
export const COMPONENT_MAPPING_SYSTEM_PROMPT = SYSTEM_PROMPT;

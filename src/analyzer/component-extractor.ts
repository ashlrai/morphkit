/**
 * Component Extractor — deep analysis of React components.
 *
 * Builds on the AST parser to produce rich `ExtractedComponent` records that
 * capture props, hooks, event handlers, conditional rendering, and
 * component classification (layout / feature / UI primitive).
 */

import {
  Project,
  SourceFile,
  Node,
  SyntaxKind,
  type CallExpression,
} from 'ts-morph';

import {
  extractFunctionComponents,
  extractHookUsage,
  type ComponentDefinition,
  type HookUsage,
  type PropDefinition,
} from './ast-parser.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ComponentCategory =
  | 'layout'
  | 'page'
  | 'feature'
  | 'ui-primitive'
  | 'provider'
  | 'hoc'
  | 'unknown';

export interface EventHandlerInfo {
  /** Handler function name, e.g. "handleClick" */
  name: string;
  /** Event type, e.g. "onClick", "onSubmit" */
  eventType: string;
  /** Line number of the handler definition */
  line: number;
}

export interface ConditionalRender {
  /** 'ternary' | 'logical-and' | 'if-statement' */
  kind: 'ternary' | 'logical-and' | 'if-statement';
  /** The condition expression text */
  condition: string;
  /** Line number */
  line: number;
}

export interface ChildComponent {
  /** Name of the child component used in JSX */
  name: string;
  /** Number of times it appears */
  count: number;
}

export interface UiLibraryMapping {
  /** Original component name, e.g. "Dialog" */
  componentName: string;
  /** Library it comes from, e.g. "radix-ui" */
  library: string;
  /** High-level category, e.g. "modal", "dropdown", "button" */
  category: string;
}

export interface ExtractedComponent {
  /** Component name */
  name: string;
  /** Absolute file path */
  filePath: string;
  /** Arrow function, function declaration, etc. */
  kind: ComponentDefinition['kind'];
  /** Classified category */
  category: ComponentCategory;
  /** Whether this is a default export */
  isDefaultExport: boolean;
  /** Props with types */
  props: PropDefinition[];
  /** Raw props type string */
  propsType: string | undefined;
  /** All hook usages inside this component */
  hooks: HookUsage[];
  /** Event handlers defined or referenced */
  eventHandlers: EventHandlerInfo[];
  /** Conditional rendering patterns detected */
  conditionalRenders: ConditionalRender[];
  /** Child components used in JSX */
  children: ChildComponent[];
  /** Mapped UI library components */
  uiLibraryMappings: UiLibraryMapping[];
  /** Line number of component start */
  line: number;
}

// ---------------------------------------------------------------------------
// Known UI library component mappings
// ---------------------------------------------------------------------------

const UI_LIBRARY_MAP: Record<string, { library: string; category: string }> = {
  // Radix UI
  'Dialog': { library: 'radix-ui', category: 'modal' },
  'DialogTrigger': { library: 'radix-ui', category: 'modal' },
  'DialogContent': { library: 'radix-ui', category: 'modal' },
  'AlertDialog': { library: 'radix-ui', category: 'alert' },
  'DropdownMenu': { library: 'radix-ui', category: 'dropdown' },
  'DropdownMenuTrigger': { library: 'radix-ui', category: 'dropdown' },
  'DropdownMenuContent': { library: 'radix-ui', category: 'dropdown' },
  'Popover': { library: 'radix-ui', category: 'popover' },
  'Select': { library: 'radix-ui', category: 'select' },
  'Tabs': { library: 'radix-ui', category: 'tabs' },
  'Toast': { library: 'radix-ui', category: 'toast' },
  'Tooltip': { library: 'radix-ui', category: 'tooltip' },
  'Sheet': { library: 'shadcn', category: 'bottom-sheet' },
  'SheetTrigger': { library: 'shadcn', category: 'bottom-sheet' },
  'SheetContent': { library: 'shadcn', category: 'bottom-sheet' },
  'Card': { library: 'shadcn', category: 'card' },
  'Button': { library: 'shadcn', category: 'button' },
  'Input': { library: 'shadcn', category: 'text-input' },
  'Badge': { library: 'shadcn', category: 'badge' },
  'Avatar': { library: 'shadcn', category: 'avatar' },
  'Skeleton': { library: 'shadcn', category: 'skeleton' },
  'Switch': { library: 'shadcn', category: 'toggle' },
  'Separator': { library: 'shadcn', category: 'divider' },

  // Headless UI
  'Listbox': { library: 'headless-ui', category: 'select' },
  'Combobox': { library: 'headless-ui', category: 'combobox' },
  'Menu': { library: 'headless-ui', category: 'dropdown' },
  'Transition': { library: 'headless-ui', category: 'transition' },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Detect event handler patterns in a component's source text.
 */
function findEventHandlers(sourceFile: SourceFile, componentNode: Node): EventHandlerInfo[] {
  const handlers: EventHandlerInfo[] = [];
  const seen = new Set<string>();

  try {
    componentNode.forEachDescendant((child) => {
      // Look for JSX attributes like onClick={handleClick} or onClick={() => ...}
      if (Node.isJsxAttribute(child)) {
        const attrName = child.getNameNode().getText();
        if (/^on[A-Z]/.test(attrName)) {
          const init = child.getInitializer();
          let handlerName = 'anonymous';

          if (init && Node.isJsxExpression(init)) {
            const expr = init.getExpression();
            if (expr) {
              handlerName = Node.isIdentifier(expr) ? expr.getText() : 'inline';
            }
          }

          const key = `${attrName}:${handlerName}`;
          if (!seen.has(key)) {
            seen.add(key);
            handlers.push({
              name: handlerName,
              eventType: attrName,
              line: child.getStartLineNumber(),
            });
          }
        }
      }
    });
  } catch {
    // JSX traversal can fail on malformed files
  }

  return handlers;
}

/**
 * Detect conditional rendering patterns.
 */
function findConditionalRenders(componentNode: Node): ConditionalRender[] {
  const results: ConditionalRender[] = [];

  try {
    componentNode.forEachDescendant((child) => {
      // Ternary in JSX: {condition ? <A/> : <B/>}
      if (Node.isConditionalExpression(child)) {
        const condition = child.getCondition().getText();
        // Only include if the branches look like they contain JSX
        const whenTrue = child.getWhenTrue().getText();
        const whenFalse = child.getWhenFalse().getText();
        if (/<[A-Za-z]/.test(whenTrue) || /<[A-Za-z]/.test(whenFalse) || whenFalse === 'null') {
          results.push({
            kind: 'ternary',
            condition: condition.substring(0, 120),
            line: child.getStartLineNumber(),
          });
        }
      }

      // Logical AND: {condition && <Component/>}
      if (
        Node.isBinaryExpression(child) &&
        child.getOperatorToken().getKind() === SyntaxKind.AmpersandAmpersandToken
      ) {
        const right = child.getRight().getText();
        if (/<[A-Za-z]/.test(right)) {
          results.push({
            kind: 'logical-and',
            condition: child.getLeft().getText().substring(0, 120),
            line: child.getStartLineNumber(),
          });
        }
      }

      // If statements in function body that return JSX
      if (Node.isIfStatement(child)) {
        const thenBlock = child.getThenStatement().getText();
        if (/return\s/.test(thenBlock) && /<[A-Za-z]/.test(thenBlock)) {
          results.push({
            kind: 'if-statement',
            condition: child.getExpression().getText().substring(0, 120),
            line: child.getStartLineNumber(),
          });
        }
      }
    });
  } catch {
    // ignore traversal errors
  }

  return results;
}

/**
 * Find child component references in JSX.
 */
function findChildComponents(componentNode: Node): ChildComponent[] {
  const counts = new Map<string, number>();

  try {
    componentNode.forEachDescendant((child) => {
      // JsxSelfClosingElement or JsxOpeningElement with a PascalCase tag
      if (Node.isJsxSelfClosingElement(child) || Node.isJsxOpeningElement(child)) {
        const tagName = child.getTagNameNode().getText();
        if (/^[A-Z]/.test(tagName)) {
          counts.set(tagName, (counts.get(tagName) ?? 0) + 1);
        }
      }
    });
  } catch {
    // ignore
  }

  return Array.from(counts.entries()).map(([name, count]) => ({ name, count }));
}

/**
 * Map child components to known UI library components.
 */
function mapUiLibraryComponents(children: ChildComponent[]): UiLibraryMapping[] {
  const mappings: UiLibraryMapping[] = [];
  for (const child of children) {
    const mapping = UI_LIBRARY_MAP[child.name];
    if (mapping) {
      mappings.push({
        componentName: child.name,
        library: mapping.library,
        category: mapping.category,
      });
    }
  }
  return mappings;
}

/**
 * Classify a component into a category based on heuristics.
 */
function classifyComponent(
  name: string,
  filePath: string,
  hooks: HookUsage[],
  children: ChildComponent[],
  props: PropDefinition[],
): ComponentCategory {
  const lowerName = name.toLowerCase();
  const lowerPath = filePath.toLowerCase();

  // Layout indicators
  if (
    lowerName.includes('layout') ||
    lowerPath.includes('/layout.') ||
    lowerName.includes('shell') ||
    lowerName.includes('scaffold')
  ) {
    return 'layout';
  }

  // Page indicators
  if (lowerPath.includes('/page.') || lowerName.includes('page') || lowerName.includes('screen')) {
    return 'page';
  }

  // Provider
  if (lowerName.includes('provider') || lowerName.includes('context')) {
    return 'provider';
  }

  // HOC
  if (lowerName.startsWith('with')) {
    return 'hoc';
  }

  // UI primitive: small, few hooks, common UI names
  const primitiveNames = [
    'button', 'input', 'card', 'badge', 'avatar', 'icon', 'spinner',
    'loader', 'skeleton', 'divider', 'separator', 'chip', 'tag', 'label',
    'text', 'heading', 'title', 'image', 'link',
  ];
  if (primitiveNames.some((p) => lowerName.includes(p))) {
    return 'ui-primitive';
  }

  // If it has children prop and few hooks, likely a UI component
  const hasChildrenProp = props.some((p) => p.name === 'children');
  if (hasChildrenProp && hooks.length <= 1 && children.length <= 3) {
    return 'ui-primitive';
  }

  // Feature: has significant state / effects
  if (hooks.length >= 2) {
    return 'feature';
  }

  return 'unknown';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract detailed component information from a set of component files.
 */
export function extractComponents(
  project: Project,
  componentFiles: string[],
): ExtractedComponent[] {
  console.log(`[morphkit] Extracting components from ${componentFiles.length} files`);

  const results: ExtractedComponent[] = [];

  for (const filePath of componentFiles) {
    let sourceFile: SourceFile | undefined;
    try {
      sourceFile = project.getSourceFile(filePath);
    } catch {
      console.log(`[morphkit] Warning: could not get source file ${filePath}`);
      continue;
    }
    if (!sourceFile) continue;

    try {
      const components = extractFunctionComponents(sourceFile);

      for (const comp of components) {
        // Find the actual node for deeper analysis
        let componentNode: Node = sourceFile;
        try {
          if (comp.kind === 'function-declaration') {
            const fn = sourceFile.getFunction(comp.name);
            if (fn) componentNode = fn;
          } else {
            const varDecl = sourceFile.getVariableDeclaration(comp.name);
            if (varDecl) componentNode = varDecl;
          }
        } catch {
          // fall back to source file
        }

        const hooks = extractHookUsage(componentNode);
        const eventHandlers = findEventHandlers(sourceFile, componentNode);
        const conditionalRenders = findConditionalRenders(componentNode);
        const children = findChildComponents(componentNode);
        const uiLibraryMappings = mapUiLibraryComponents(children);

        const category = classifyComponent(
          comp.name,
          filePath,
          hooks,
          children,
          comp.props,
        );

        results.push({
          name: comp.name,
          filePath: comp.filePath,
          kind: comp.kind,
          category,
          isDefaultExport: comp.isDefaultExport,
          props: comp.props,
          propsType: comp.propsType,
          hooks,
          eventHandlers,
          conditionalRenders,
          children,
          uiLibraryMappings,
          line: comp.line,
        });
      }
    } catch (err) {
      console.log(`[morphkit] Warning: error processing ${filePath}: ${(err as Error).message}`);
    }
  }

  console.log(`[morphkit] Extracted ${results.length} components`);
  return results;
}

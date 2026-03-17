/**
 * AST Parser — wraps ts-morph to parse TypeScript files and extract
 * structural information (imports, exports, components, hooks, types).
 */

import {
  Project,
  SourceFile,
  Node,
  SyntaxKind,
  FunctionDeclaration,
  VariableDeclaration,
  ArrowFunction,
  FunctionExpression,
  type ImportDeclaration,
} from 'ts-morph';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ImportInfo {
  moduleSpecifier: string;
  defaultImport: string | undefined;
  namedImports: string[];
  isTypeOnly: boolean;
}

export interface ExportInfo {
  name: string;
  kind: 'function' | 'variable' | 'type' | 'interface' | 'enum' | 'class' | 'default' | 'other';
  isDefault: boolean;
}

export interface TypeDefinition {
  name: string;
  kind: 'interface' | 'type-alias';
  /** Raw source text of the type */
  text: string;
  /** Property names (for interfaces / object type aliases) */
  properties: TypeProperty[];
  /** Whether the type is exported */
  isExported: boolean;
}

export interface TypeProperty {
  name: string;
  type: string;
  isOptional: boolean;
}

export interface ComponentDefinition {
  name: string;
  filePath: string;
  /** 'arrow' | 'function-declaration' | 'function-expression' */
  kind: 'arrow' | 'function-declaration' | 'function-expression';
  /** Props type name or inline shape */
  propsType: string | undefined;
  /** Individual prop entries (parsed when possible) */
  props: PropDefinition[];
  /** Whether this is a default export */
  isDefaultExport: boolean;
  /** Starting line number */
  line: number;
}

export interface PropDefinition {
  name: string;
  type: string;
  isOptional: boolean;
  defaultValue: string | undefined;
}

export interface HookUsage {
  hookName: string;
  /** Full call expression text (trimmed) */
  callText: string;
  /** For useState: variable name */
  stateName: string | undefined;
  /** For useState: setter name */
  setterName: string | undefined;
  /** For useState: initial value expression */
  initialValue: string | undefined;
  /** For useEffect: dependency array text */
  dependencies: string | undefined;
  /** Line number */
  line: number;
}

export interface ParsedFile {
  filePath: string;
  imports: ImportInfo[];
  exports: ExportInfo[];
  types: TypeDefinition[];
  components: ComponentDefinition[];
  hooks: HookUsage[];
}

// ---------------------------------------------------------------------------
// Project creation
// ---------------------------------------------------------------------------

/**
 * Create a ts-morph `Project` pre-loaded with the given source files.
 * The project uses an in-memory file system overlay so it never writes to disk.
 */
export function createProject(repoPath: string, files: string[]): Project {
  console.log(`[morphkit] Creating ts-morph project with ${files.length} files`);

  const project = new Project({
    tsConfigFilePath: undefined,
    skipAddingFilesFromTsConfig: true,
    compilerOptions: {
      target: 99 /* ESNext */,
      module: 99 /* ESNext */,
      jsx: 4 /* ReactJSX */,
      moduleResolution: 100 /* Bundler */,
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      allowJs: true,
    },
  });

  for (const file of files) {
    try {
      project.addSourceFileAtPath(file);
    } catch (err) {
      console.log(`[morphkit] Warning: could not add file ${file}: ${(err as Error).message}`);
    }
  }

  console.log(`[morphkit] Project initialized with ${project.getSourceFiles().length} source files`);
  return project;
}

// ---------------------------------------------------------------------------
// Import extraction
// ---------------------------------------------------------------------------

function extractImports(sourceFile: SourceFile): ImportInfo[] {
  return sourceFile.getImportDeclarations().map((decl: ImportDeclaration) => {
    const namedImports = decl
      .getNamedImports()
      .map((n) => n.getName());
    return {
      moduleSpecifier: decl.getModuleSpecifierValue(),
      defaultImport: decl.getDefaultImport()?.getText(),
      namedImports,
      isTypeOnly: decl.isTypeOnly(),
    };
  });
}

// ---------------------------------------------------------------------------
// Export extraction
// ---------------------------------------------------------------------------

function extractExports(sourceFile: SourceFile): ExportInfo[] {
  const results: ExportInfo[] = [];

  for (const exp of sourceFile.getExportedDeclarations()) {
    const [name, declarations] = exp;
    for (const decl of declarations) {
      let kind: ExportInfo['kind'] = 'other';
      if (Node.isFunctionDeclaration(decl)) kind = 'function';
      else if (Node.isVariableDeclaration(decl)) kind = 'variable';
      else if (Node.isTypeAliasDeclaration(decl)) kind = 'type';
      else if (Node.isInterfaceDeclaration(decl)) kind = 'interface';
      else if (Node.isEnumDeclaration(decl)) kind = 'enum';
      else if (Node.isClassDeclaration(decl)) kind = 'class';

      results.push({
        name: name === 'default' ? 'default' : name,
        kind: name === 'default' && kind === 'other' ? 'default' : kind,
        isDefault: name === 'default',
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Type extraction
// ---------------------------------------------------------------------------

/**
 * Extract all interface declarations and type aliases from a source file.
 */
export function extractTypeDefinitions(sourceFile: SourceFile): TypeDefinition[] {
  const results: TypeDefinition[] = [];

  try {
    // Interfaces
    for (const iface of sourceFile.getInterfaces()) {
      const properties: TypeProperty[] = iface.getProperties().map((p) => ({
        name: p.getName(),
        type: p.getType().getText(p),
        isOptional: p.hasQuestionToken(),
      }));

      results.push({
        name: iface.getName(),
        kind: 'interface',
        text: iface.getText(),
        properties,
        isExported: iface.isExported(),
      });
    }

    // Type aliases
    for (const alias of sourceFile.getTypeAliases()) {
      const properties: TypeProperty[] = [];
      try {
        const type = alias.getType();
        for (const prop of type.getProperties()) {
          const declarations = prop.getDeclarations();
          const decl = declarations[0];
          properties.push({
            name: prop.getName(),
            type: decl ? prop.getTypeAtLocation(decl).getText(decl) : 'unknown',
            isOptional: prop.isOptional(),
          });
        }
      } catch {
        // type may not have enumerable properties (union, primitive, etc.)
      }

      results.push({
        name: alias.getName(),
        kind: 'type-alias',
        text: alias.getText(),
        properties,
        isExported: alias.isExported(),
      });
    }
  } catch (err) {
    console.log(`[morphkit] Warning: error extracting types from ${sourceFile.getFilePath()}: ${(err as Error).message}`);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Component extraction
// ---------------------------------------------------------------------------

/** Heuristic: does the node's return type / body contain JSX? */
function returnsJsx(node: Node): boolean {
  const text = node.getText();
  // Quick heuristic — look for JSX-like patterns in the body
  return /<[A-Z]/.test(text) || /<[a-z]+[\s>]/.test(text) || /React\.createElement/.test(text);
}

function extractPropsFromParams(
  params: Node[],
  parentNode: Node,
): { propsType: string | undefined; props: PropDefinition[] } {
  if (params.length === 0) return { propsType: undefined, props: [] };

  const first = params[0];
  if (!first) return { propsType: undefined, props: [] };

  let propsType: string | undefined;
  const props: PropDefinition[] = [];

  try {
    const firstType = first.getType();
    propsType = firstType.getText(parentNode);

    // Try to resolve individual properties from the type
    for (const prop of firstType.getProperties()) {
      const declarations = prop.getDeclarations();
      const decl = declarations[0];
      props.push({
        name: prop.getName(),
        type: decl ? prop.getTypeAtLocation(decl).getText(decl) : 'unknown',
        isOptional: prop.isOptional(),
        defaultValue: undefined,
      });
    }
  } catch {
    // props may be destructured or complex — skip detailed extraction
  }

  return { propsType, props };
}

/**
 * Extract React function components from a source file.
 * Detects both `function Foo()` declarations and `const Foo = () => ...` arrow functions
 * that return JSX.
 */
export function extractFunctionComponents(sourceFile: SourceFile): ComponentDefinition[] {
  const results: ComponentDefinition[] = [];
  const filePath = sourceFile.getFilePath();

  try {
    // --- Function declarations ---
    for (const fn of sourceFile.getFunctions()) {
      const name = fn.getName();
      if (!name || !/^[A-Z]/.test(name)) continue;
      if (!returnsJsx(fn)) continue;

      const { propsType, props } = extractPropsFromParams(fn.getParameters(), fn);
      const isDefaultExport = fn.isDefaultExport();

      results.push({
        name,
        filePath,
        kind: 'function-declaration',
        propsType,
        props,
        isDefaultExport,
        line: fn.getStartLineNumber(),
      });
    }

    // --- Arrow functions / function expressions assigned to variables ---
    for (const varStatement of sourceFile.getVariableStatements()) {
      for (const decl of varStatement.getDeclarations()) {
        const name = decl.getName();
        if (!/^[A-Z]/.test(name)) continue;

        const initializer = decl.getInitializer();
        if (!initializer) continue;

        const isArrow = Node.isArrowFunction(initializer);
        const isFuncExpr = Node.isFunctionExpression(initializer);
        if (!isArrow && !isFuncExpr) continue;
        if (!returnsJsx(initializer)) continue;

        const fnNode = initializer as ArrowFunction | FunctionExpression;
        const { propsType, props } = extractPropsFromParams(fnNode.getParameters(), fnNode);
        const isDefaultExport = varStatement.isExported() && varStatement.hasModifier(SyntaxKind.DefaultKeyword);

        results.push({
          name,
          filePath,
          kind: isArrow ? 'arrow' : 'function-expression',
          propsType,
          props,
          isDefaultExport,
          line: varStatement.getStartLineNumber(),
        });
      }
    }

    // --- Default exports that are anonymous functions ---
    const defaultExport = sourceFile.getDefaultExportSymbol();
    if (defaultExport && results.every((c) => !c.isDefaultExport)) {
      // Check if the default export is a function that returns JSX
      const declarations = defaultExport.getDeclarations();
      for (const decl of declarations) {
        if (Node.isFunctionDeclaration(decl) && returnsJsx(decl)) {
          const fnDecl = decl as FunctionDeclaration;
          const { propsType, props } = extractPropsFromParams(fnDecl.getParameters(), fnDecl);
          results.push({
            name: fnDecl.getName() ?? 'default',
            filePath,
            kind: 'function-declaration',
            propsType,
            props,
            isDefaultExport: true,
            line: fnDecl.getStartLineNumber(),
          });
        }
      }
    }
  } catch (err) {
    console.log(`[morphkit] Warning: error extracting components from ${filePath}: ${(err as Error).message}`);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Hook extraction
// ---------------------------------------------------------------------------

/**
 * Extract React hook usages from a node (typically a function body / source file).
 */
export function extractHookUsage(node: Node): HookUsage[] {
  const results: HookUsage[] = [];

  try {
    node.forEachDescendant((child) => {
      if (!Node.isCallExpression(child)) return;

      const expr = child.getExpression();
      const name = expr.getText();

      // Only match hooks: use* pattern
      if (!/^use[A-Z]/.test(name)) return;

      const callText = child.getText().substring(0, 200); // cap length
      const line = child.getStartLineNumber();

      let stateName: string | undefined;
      let setterName: string | undefined;
      let initialValue: string | undefined;
      let dependencies: string | undefined;

      // useState — look for `const [foo, setFoo] = useState(init)`
      if (name === 'useState') {
        const parent = child.getParent();
        if (parent && Node.isVariableDeclaration(parent)) {
          const nameNode = parent.getNameNode();
          if (Node.isArrayBindingPattern(nameNode)) {
            const elements = nameNode.getElements();
            if (elements.length >= 1 && Node.isBindingElement(elements[0]!)) {
              stateName = elements[0]!.getName();
            }
            if (elements.length >= 2 && Node.isBindingElement(elements[1]!)) {
              setterName = elements[1]!.getName();
            }
          }
        }
        const args = child.getArguments();
        if (args.length > 0) {
          initialValue = args[0]!.getText();
        }
      }

      // useEffect / useLayoutEffect — extract dependency array
      if (name === 'useEffect' || name === 'useLayoutEffect' || name === 'useCallback' || name === 'useMemo') {
        const args = child.getArguments();
        if (args.length >= 2) {
          dependencies = args[1]!.getText();
        }
      }

      results.push({
        hookName: name,
        callText,
        stateName,
        setterName,
        initialValue,
        dependencies,
        line,
      });
    });
  } catch (err) {
    console.log(`[morphkit] Warning: error extracting hooks: ${(err as Error).message}`);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Full file parse
// ---------------------------------------------------------------------------

/**
 * Parse a source file and extract all structural information.
 */
export function parseFile(sourceFile: SourceFile): ParsedFile {
  return {
    filePath: sourceFile.getFilePath(),
    imports: extractImports(sourceFile),
    exports: extractExports(sourceFile),
    types: extractTypeDefinitions(sourceFile),
    components: extractFunctionComponents(sourceFile),
    hooks: extractHookUsage(sourceFile),
  };
}

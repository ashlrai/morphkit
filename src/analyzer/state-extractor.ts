/**
 * State Extractor — detects and classifies state management patterns
 * in a React / Next.js codebase (useState, useReducer, Context, Zustand,
 * Redux Toolkit, React Query, SWR).
 */

import {
  Project,
  SourceFile,
  Node,
  SyntaxKind,
  type CallExpression,
} from 'ts-morph';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StatePatternKind =
  | 'useState'
  | 'useReducer'
  | 'context'
  | 'zustand'
  | 'redux-slice'
  | 'react-query'
  | 'swr'
  | 'other';

export type StateScope =
  | 'local'        // component-level useState/useReducer
  | 'shared'       // React Context
  | 'global';      // Zustand / Redux

export interface UseStateInfo {
  variableName: string;
  setterName: string;
  type: string;
  initialValue: string;
  line: number;
}

export interface UseReducerInfo {
  stateName: string;
  dispatchName: string;
  reducerName: string;
  /** Extracted action type names if a union/enum is used */
  actionTypes: string[];
  initialState: string;
  line: number;
}

export interface ContextInfo {
  contextName: string;
  /** Name of the provider component */
  providerName: string | undefined;
  /** Shape of the context value (type text) */
  valueShape: string;
  /** File where createContext is called */
  definitionFile: string;
  line: number;
}

export interface ZustandStoreInfo {
  storeName: string;
  /** State property names */
  stateProperties: string[];
  /** Action/method names */
  actions: string[];
  /** Raw store definition text (trimmed) */
  rawText: string;
  line: number;
}

export interface ReduxSliceInfo {
  sliceName: string;
  /** State property names */
  stateProperties: string[];
  /** Reducer/action names */
  actions: string[];
  /** Selector names found in the file */
  selectors: string[];
  line: number;
}

export interface ServerStateInfo {
  /** 'react-query' | 'swr' */
  library: 'react-query' | 'swr';
  hookName: string;
  /** Query key expression */
  queryKey: string;
  /** Fetch function text (trimmed) */
  fetchFn: string;
  line: number;
}

export interface ExtractedState {
  kind: StatePatternKind;
  scope: StateScope;
  filePath: string;
  /** Component or module name where this state is declared */
  ownerName: string;
  /** Specific details depending on kind */
  useState: UseStateInfo | undefined;
  useReducer: UseReducerInfo | undefined;
  context: ContextInfo | undefined;
  zustand: ZustandStoreInfo | undefined;
  redux: ReduxSliceInfo | undefined;
  serverState: ServerStateInfo | undefined;
}

// ---------------------------------------------------------------------------
// useState
// ---------------------------------------------------------------------------

function extractUseStateCalls(sourceFile: SourceFile, filePath: string): ExtractedState[] {
  const results: ExtractedState[] = [];

  try {
    sourceFile.forEachDescendant((node) => {
      if (!Node.isCallExpression(node)) return;
      const exprText = node.getExpression().getText();
      if (exprText !== 'useState') return;

      const parent = node.getParent();
      if (!parent || !Node.isVariableDeclaration(parent)) return;

      let variableName = 'unknown';
      let setterName = 'unknown';

      const nameNode = parent.getNameNode();
      if (Node.isArrayBindingPattern(nameNode)) {
        const elements = nameNode.getElements();
        if (elements.length >= 1 && Node.isBindingElement(elements[0]!)) {
          variableName = elements[0]!.getName();
        }
        if (elements.length >= 2 && Node.isBindingElement(elements[1]!)) {
          setterName = elements[1]!.getName();
        }
      }

      const args = node.getArguments();
      const initialValue = args.length > 0 ? args[0]!.getText() : 'undefined';

      // Try to get the type
      let type = 'unknown';
      try {
        const typeArgs = node.getTypeArguments();
        if (typeArgs.length > 0) {
          type = typeArgs[0]!.getText();
        } else {
          type = parent.getType().getText(parent);
        }
      } catch {
        // ignore type resolution errors
      }

      // Determine owner component
      const ownerName = findOwnerComponent(node) ?? path.basename(filePath).replace(/\.(tsx?|jsx?)$/, '');

      results.push({
        kind: 'useState',
        scope: 'local',
        filePath,
        ownerName,
        useState: {
          variableName,
          setterName,
          type,
          initialValue,
          line: node.getStartLineNumber(),
        },
        useReducer: undefined,
        context: undefined,
        zustand: undefined,
        redux: undefined,
        serverState: undefined,
      });
    });
  } catch (err) {
    console.log(`[morphkit] Warning: useState extraction error in ${filePath}: ${(err as Error).message}`);
  }

  return results;
}

// ---------------------------------------------------------------------------
// useReducer
// ---------------------------------------------------------------------------

function extractUseReducerCalls(sourceFile: SourceFile, filePath: string): ExtractedState[] {
  const results: ExtractedState[] = [];

  try {
    sourceFile.forEachDescendant((node) => {
      if (!Node.isCallExpression(node)) return;
      if (node.getExpression().getText() !== 'useReducer') return;

      const parent = node.getParent();
      let stateName = 'state';
      let dispatchName = 'dispatch';

      if (parent && Node.isVariableDeclaration(parent)) {
        const nameNode = parent.getNameNode();
        if (Node.isArrayBindingPattern(nameNode)) {
          const elements = nameNode.getElements();
          if (elements.length >= 1 && Node.isBindingElement(elements[0]!)) {
            stateName = elements[0]!.getName();
          }
          if (elements.length >= 2 && Node.isBindingElement(elements[1]!)) {
            dispatchName = elements[1]!.getName();
          }
        }
      }

      const args = node.getArguments();
      const reducerName = args.length > 0 ? args[0]!.getText() : 'unknown';
      const initialState = args.length > 1 ? args[1]!.getText() : 'undefined';

      // Try to extract action types from the reducer function
      const actionTypes: string[] = [];
      try {
        if (args.length > 0) {
          const reducerRef = args[0]!;
          if (Node.isIdentifier(reducerRef)) {
            // Find the reducer function and look for switch cases
            const reducerDecl = reducerRef.getDefinitions();
            // This is a best-effort extraction — action types are often
            // in switch statements inside the reducer
          }
        }
      } catch {
        // ignore
      }

      const ownerName = findOwnerComponent(node) ?? path.basename(filePath).replace(/\.(tsx?|jsx?)$/, '');

      results.push({
        kind: 'useReducer',
        scope: 'local',
        filePath,
        ownerName,
        useState: undefined,
        useReducer: {
          stateName,
          dispatchName,
          reducerName,
          actionTypes,
          initialState,
          line: node.getStartLineNumber(),
        },
        context: undefined,
        zustand: undefined,
        redux: undefined,
        serverState: undefined,
      });
    });
  } catch (err) {
    console.log(`[morphkit] Warning: useReducer extraction error in ${filePath}: ${(err as Error).message}`);
  }

  return results;
}

// ---------------------------------------------------------------------------
// React Context
// ---------------------------------------------------------------------------

function extractContextDefinitions(sourceFile: SourceFile, filePath: string): ExtractedState[] {
  const results: ExtractedState[] = [];

  try {
    sourceFile.forEachDescendant((node) => {
      if (!Node.isCallExpression(node)) return;

      const exprText = node.getExpression().getText();
      if (exprText !== 'createContext' && exprText !== 'React.createContext') return;

      const parent = node.getParent();
      let contextName = 'UnknownContext';
      if (parent && Node.isVariableDeclaration(parent)) {
        contextName = parent.getName();
      }

      // Extract value shape from type argument
      let valueShape = 'unknown';
      try {
        const typeArgs = node.getTypeArguments();
        if (typeArgs.length > 0) {
          valueShape = typeArgs[0]!.getText();
        }
      } catch {
        // ignore
      }

      // Try to find a provider component in the same file
      let providerName: string | undefined;
      try {
        for (const fn of sourceFile.getFunctions()) {
          const name = fn.getName();
          if (name && name.includes('Provider')) {
            providerName = name;
            break;
          }
        }
        if (!providerName) {
          for (const varDecl of sourceFile.getVariableDeclarations()) {
            const name = varDecl.getName();
            if (name.includes('Provider')) {
              providerName = name;
              break;
            }
          }
        }
      } catch {
        // ignore
      }

      results.push({
        kind: 'context',
        scope: 'shared',
        filePath,
        ownerName: contextName,
        useState: undefined,
        useReducer: undefined,
        context: {
          contextName,
          providerName,
          valueShape,
          definitionFile: filePath,
          line: node.getStartLineNumber(),
        },
        zustand: undefined,
        redux: undefined,
        serverState: undefined,
      });
    });
  } catch (err) {
    console.log(`[morphkit] Warning: context extraction error in ${filePath}: ${(err as Error).message}`);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Zustand
// ---------------------------------------------------------------------------

function extractZustandStores(sourceFile: SourceFile, filePath: string): ExtractedState[] {
  const results: ExtractedState[] = [];

  try {
    // Look for imports from 'zustand'
    const hasZustand = sourceFile
      .getImportDeclarations()
      .some((imp) => imp.getModuleSpecifierValue() === 'zustand');
    if (!hasZustand) return results;

    sourceFile.forEachDescendant((node) => {
      if (!Node.isCallExpression(node)) return;

      const exprText = node.getExpression().getText();
      if (exprText !== 'create' && !exprText.endsWith('.create')) return;

      const parent = node.getParent();
      let storeName = 'unknownStore';
      if (parent && Node.isVariableDeclaration(parent)) {
        storeName = parent.getName();
      }

      // Extract state properties and actions from the callback
      const stateProperties: string[] = [];
      const actions: string[] = [];
      const rawText = node.getText().substring(0, 1000);

      try {
        const args = node.getArguments();
        if (args.length > 0) {
          const callback = args[0]!;
          // Look for the return object properties
          callback.forEachDescendant((child) => {
            if (Node.isPropertyAssignment(child)) {
              const propName = child.getName();
              const init = child.getInitializer();
              if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) {
                actions.push(propName);
              } else {
                stateProperties.push(propName);
              }
            }
          });
        }
      } catch {
        // ignore parse errors
      }

      results.push({
        kind: 'zustand',
        scope: 'global',
        filePath,
        ownerName: storeName,
        useState: undefined,
        useReducer: undefined,
        context: undefined,
        zustand: {
          storeName,
          stateProperties,
          actions,
          rawText,
          line: node.getStartLineNumber(),
        },
        redux: undefined,
        serverState: undefined,
      });
    });
  } catch (err) {
    console.log(`[morphkit] Warning: Zustand extraction error in ${filePath}: ${(err as Error).message}`);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Redux Toolkit
// ---------------------------------------------------------------------------

function extractReduxSlices(sourceFile: SourceFile, filePath: string): ExtractedState[] {
  const results: ExtractedState[] = [];

  try {
    const hasRedux = sourceFile
      .getImportDeclarations()
      .some((imp) => imp.getModuleSpecifierValue() === '@reduxjs/toolkit');
    if (!hasRedux) return results;

    sourceFile.forEachDescendant((node) => {
      if (!Node.isCallExpression(node)) return;
      if (node.getExpression().getText() !== 'createSlice') return;

      const args = node.getArguments();
      if (args.length === 0) return;

      const configArg = args[0]!;
      let sliceName = 'unknownSlice';
      const stateProperties: string[] = [];
      const actions: string[] = [];
      const selectors: string[] = [];

      try {
        configArg.forEachDescendant((child) => {
          if (Node.isPropertyAssignment(child)) {
            const name = child.getName();
            if (name === 'name') {
              const init = child.getInitializer();
              if (init) sliceName = init.getText().replace(/['"]/g, '');
            }
            if (name === 'initialState') {
              const init = child.getInitializer();
              if (init && Node.isObjectLiteralExpression(init)) {
                for (const prop of init.getProperties()) {
                  if (Node.isPropertyAssignment(prop)) {
                    stateProperties.push(prop.getName());
                  }
                }
              }
            }
            if (name === 'reducers') {
              const init = child.getInitializer();
              if (init && Node.isObjectLiteralExpression(init)) {
                for (const prop of init.getProperties()) {
                  if (Node.isPropertyAssignment(prop) || Node.isMethodDeclaration(prop)) {
                    actions.push(prop.getName());
                  }
                }
              }
            }
          }
        });
      } catch {
        // ignore
      }

      // Look for selectors in the same file
      try {
        for (const varDecl of sourceFile.getVariableDeclarations()) {
          const name = varDecl.getName();
          if (name.startsWith('select') || name.startsWith('get')) {
            selectors.push(name);
          }
        }
      } catch {
        // ignore
      }

      const parentDecl = node.getParent();
      const ownerName = parentDecl && Node.isVariableDeclaration(parentDecl)
        ? parentDecl.getName()
        : sliceName;

      results.push({
        kind: 'redux-slice',
        scope: 'global',
        filePath,
        ownerName,
        useState: undefined,
        useReducer: undefined,
        context: undefined,
        zustand: undefined,
        redux: {
          sliceName,
          stateProperties,
          actions,
          selectors,
          line: node.getStartLineNumber(),
        },
        serverState: undefined,
      });
    });
  } catch (err) {
    console.log(`[morphkit] Warning: Redux extraction error in ${filePath}: ${(err as Error).message}`);
  }

  return results;
}

// ---------------------------------------------------------------------------
// React Query / SWR
// ---------------------------------------------------------------------------

function extractServerState(sourceFile: SourceFile, filePath: string): ExtractedState[] {
  const results: ExtractedState[] = [];

  try {
    sourceFile.forEachDescendant((node) => {
      if (!Node.isCallExpression(node)) return;

      const exprText = node.getExpression().getText();
      let library: 'react-query' | 'swr' | undefined;
      let hookName = exprText;

      if (
        exprText === 'useQuery' ||
        exprText === 'useMutation' ||
        exprText === 'useInfiniteQuery' ||
        exprText === 'useSuspenseQuery'
      ) {
        library = 'react-query';
      } else if (exprText === 'useSWR' || exprText === 'useSWRInfinite' || exprText === 'useSWRMutation') {
        library = 'swr';
      }

      if (!library) return;

      const args = node.getArguments();
      let queryKey = '';
      let fetchFn = '';

      if (library === 'react-query' && args.length > 0) {
        // React Query v5: useQuery({ queryKey, queryFn })
        const firstArg = args[0]!;
        if (Node.isObjectLiteralExpression(firstArg)) {
          for (const prop of firstArg.getProperties()) {
            if (Node.isPropertyAssignment(prop)) {
              if (prop.getName() === 'queryKey') {
                queryKey = prop.getInitializer()?.getText() ?? '';
              }
              if (prop.getName() === 'queryFn') {
                fetchFn = prop.getInitializer()?.getText().substring(0, 300) ?? '';
              }
            }
          }
        } else {
          // React Query v3/v4: useQuery(key, fn)
          queryKey = firstArg.getText();
          if (args.length > 1) {
            fetchFn = args[1]!.getText().substring(0, 300);
          }
        }
      }

      if (library === 'swr' && args.length > 0) {
        queryKey = args[0]!.getText();
        if (args.length > 1) {
          fetchFn = args[1]!.getText().substring(0, 300);
        }
      }

      const ownerName = findOwnerComponent(node) ?? path.basename(filePath).replace(/\.(tsx?|jsx?)$/, '');

      results.push({
        kind: library === 'swr' ? 'swr' : 'react-query',
        scope: 'local',
        filePath,
        ownerName,
        useState: undefined,
        useReducer: undefined,
        context: undefined,
        zustand: undefined,
        redux: undefined,
        serverState: {
          library,
          hookName,
          queryKey,
          fetchFn,
          line: node.getStartLineNumber(),
        },
      });
    });
  } catch (err) {
    console.log(`[morphkit] Warning: server state extraction error in ${filePath}: ${(err as Error).message}`);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

import * as path from 'path';

/**
 * Walk up the AST to find the enclosing function component name.
 */
function findOwnerComponent(node: Node): string | undefined {
  let current: Node | undefined = node.getParent();
  while (current) {
    if (Node.isFunctionDeclaration(current)) {
      const name = current.getName();
      if (name && /^[A-Z]/.test(name)) return name;
    }
    if (Node.isVariableDeclaration(current)) {
      const name = current.getName();
      if (/^[A-Z]/.test(name)) return name;
    }
    current = current.getParent();
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detect and extract all state management patterns from the given files.
 */
export function extractStatePatterns(
  project: Project,
  files: string[],
): ExtractedState[] {
  console.log(`[morphkit] Extracting state patterns from ${files.length} files`);

  const results: ExtractedState[] = [];

  for (const filePath of files) {
    let sourceFile: SourceFile | undefined;
    try {
      sourceFile = project.getSourceFile(filePath);
    } catch {
      continue;
    }
    if (!sourceFile) continue;

    try {
      results.push(...extractUseStateCalls(sourceFile, filePath));
      results.push(...extractUseReducerCalls(sourceFile, filePath));
      results.push(...extractContextDefinitions(sourceFile, filePath));
      results.push(...extractZustandStores(sourceFile, filePath));
      results.push(...extractReduxSlices(sourceFile, filePath));
      results.push(...extractServerState(sourceFile, filePath));
    } catch (err) {
      console.log(`[morphkit] Warning: state extraction error in ${filePath}: ${(err as Error).message}`);
    }
  }

  console.log(`[morphkit] Found ${results.length} state patterns`);
  return results;
}

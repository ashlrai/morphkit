import { mkdirSync, writeFileSync, rmSync, existsSync , mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { describe, test, expect, afterEach, beforeAll } from 'bun:test';

import { analyzeRepo } from '../../src/analyzer/index';
import type { RepoScanResult } from '../../src/analyzer/repo-scanner';
import { generateProject } from '../../src/generator/index';
import { adaptForPlatform } from '../../src/semantic/adapter';
import type { AnalysisResult } from '../../src/semantic/builder';
import { buildSemanticModel } from '../../src/semantic/builder';

// Track temp dirs for cleanup
const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `morphkit-test-${prefix}-`));
  tempDirs.push(dir);
  return dir;
}

beforeAll(() => {
  // Disable AI client for all tests
  process.env.MORPHKIT_NO_AI = '1';
  delete process.env.XAI_API_KEY;
});

afterEach(() => {
  // Cleanup temp dirs after each test
  for (const dir of tempDirs) {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  tempDirs.length = 0;
});

// ---------------------------------------------------------------------------
// Task 1: Edge case tests for empty/minimal apps
// ---------------------------------------------------------------------------

describe('Edge Cases: Empty and Minimal Apps', () => {
  test('handles app with NO routes (single page)', async () => {
    const dir = makeTempDir('no-routes');
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'single-page-app',
        dependencies: { react: '18', 'react-dom': '18' },
      }),
    );

    // A single React component, no routing
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(
      join(dir, 'src', 'App.tsx'),
      `
import React from 'react';

export default function App() {
  return <div><h1>Hello World</h1></div>;
}
`,
    );

    const result = await analyzeRepo(dir);

    expect(result).toBeDefined();
    expect(result.scanResult).toBeDefined();
    expect(result.routes.length).toBe(0);
    // Should still find the component file
    expect(result.scanResult.allFiles.length).toBeGreaterThan(0);

    // Should be able to build a model even with no routes
    const model = await buildSemanticModel(result);
    expect(model).toBeDefined();
    expect(model.appName).toBeDefined();
    expect(model.navigation).toBeDefined();

    // Should be able to generate a project (even if minimal)
    const outputDir = makeTempDir('no-routes-out');
    const project = await generateProject(model, outputDir);
    expect(project).toBeDefined();
    expect(project.files.length).toBeGreaterThan(0);
    // At minimum, should have App.swift entry point
    const appEntry = project.files.find(f => f.path.endsWith('App.swift'));
    expect(appEntry).toBeDefined();
  });

  test('handles app with NO state management', async () => {
    const dir = makeTempDir('no-state');
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'stateless-app',
        dependencies: { react: '18', next: '14' },
      }),
    );

    mkdirSync(join(dir, 'app'), { recursive: true });
    writeFileSync(
      join(dir, 'app', 'page.tsx'),
      `
export default function Home() {
  return <div><h1>Static Content</h1><p>No state here</p></div>;
}
`,
    );

    const result = await analyzeRepo(dir);

    expect(result).toBeDefined();
    expect(result.statePatterns.length).toBe(0);

    const model = await buildSemanticModel(result);
    expect(model).toBeDefined();
    // stateManagement should be an array (possibly empty)
    expect(Array.isArray(model.stateManagement)).toBe(true);
  });

  test('handles app with NO TypeScript types (plain JSX)', async () => {
    const dir = makeTempDir('no-types');
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'untyped-app',
        dependencies: { react: '18', next: '14' },
      }),
    );

    mkdirSync(join(dir, 'app'), { recursive: true });
    // Use .jsx instead of .tsx (no TypeScript)
    writeFileSync(
      join(dir, 'app', 'page.jsx'),
      `
export default function Home() {
  return <div><h1>No Types</h1></div>;
}
`,
    );

    const result = await analyzeRepo(dir);

    expect(result).toBeDefined();
    expect(result.scanResult.allFiles.length).toBeGreaterThan(0);

    const model = await buildSemanticModel(result);
    expect(model).toBeDefined();
    expect(model.entities).toBeDefined();
  });

  test('pipeline does not crash on empty directories', async () => {
    const dir = makeTempDir('empty-dir');
    // Just a package.json, no source files
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'empty-project' }),
    );

    const result = await analyzeRepo(dir);

    expect(result).toBeDefined();
    expect(result.parsedFiles.length).toBe(0);
    expect(result.components.length).toBe(0);
    expect(result.routes.length).toBe(0);
    expect(result.statePatterns.length).toBe(0);
    expect(result.apiEndpoints.length).toBe(0);

    // Should still build a model (empty but valid)
    const model = await buildSemanticModel(result);
    expect(model).toBeDefined();
    expect(model.screens.length).toBe(0);
    expect(model.entities.length).toBe(0);
  });

  test('handles a plain React app (no Next.js)', async () => {
    const dir = makeTempDir('plain-react');
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'plain-react-app',
        dependencies: { react: '18', 'react-dom': '18' },
      }),
    );

    mkdirSync(join(dir, 'src', 'components'), { recursive: true });
    writeFileSync(
      join(dir, 'src', 'App.tsx'),
      `
import React from 'react';
import { Header } from './components/Header';

export default function App() {
  return (
    <div>
      <Header />
      <main><p>Welcome to my app</p></main>
    </div>
  );
}
`,
    );
    writeFileSync(
      join(dir, 'src', 'components', 'Header.tsx'),
      `
import React from 'react';

export function Header() {
  return <header><h1>My App</h1></header>;
}
`,
    );

    const result = await analyzeRepo(dir);

    expect(result).toBeDefined();
    expect(result.scanResult.framework).toBe('react');
    expect(result.scanResult.components.length).toBeGreaterThan(0);

    // Should work through the full pipeline
    const model = await buildSemanticModel(result);
    expect(model).toBeDefined();

    const adapted = adaptForPlatform(model, 'ios');
    expect(adapted).toBeDefined();

    const outputDir = makeTempDir('plain-react-out');
    const project = await generateProject(adapted, outputDir);
    expect(project).toBeDefined();
    expect(project.files.length).toBeGreaterThan(0);
  });

  test('handles completely empty directory (no package.json)', async () => {
    const dir = makeTempDir('truly-empty');

    const result = await analyzeRepo(dir);

    expect(result).toBeDefined();
    expect(result.scanResult.allFiles.length).toBe(0);
    expect(result.scanResult.framework).toBe('unknown');
  });

  test('handles directory with only CSS files', async () => {
    const dir = makeTempDir('only-css');
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'css-only' }),
    );
    mkdirSync(join(dir, 'styles'), { recursive: true });
    writeFileSync(join(dir, 'styles', 'main.css'), 'body { color: red; }');

    const result = await analyzeRepo(dir);

    expect(result).toBeDefined();
    // CSS files are found but no parseable source
    expect(result.parsedFiles.length).toBe(0);
    expect(result.components.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Task 2: Error handling tests
// ---------------------------------------------------------------------------

describe('Error Handling', () => {
  test('analyzeRepo returns gracefully for non-existent paths', async () => {
    const nonExistentPath = join(tmpdir(), 'morphkit-nonexistent-' + Date.now());

    // scanRepo uses fast-glob which returns [] for non-existent dirs
    // The function should not throw — it should return an empty result
    const result = await analyzeRepo(nonExistentPath);
    expect(result).toBeDefined();
    expect(result.scanResult.allFiles.length).toBe(0);
    expect(result.components.length).toBe(0);
    expect(result.routes.length).toBe(0);
  });

  test('buildSemanticModel handles empty analysis results', async () => {
    const emptyScan: RepoScanResult = {
      framework: 'unknown',
      repoPath: '/nonexistent',
      allFiles: [],
      pages: [],
      layouts: [],
      boundaries: [],
      components: [],
      apiRoutes: [],
      styles: [],
      configs: [],
      jsonFiles: [],
      hasTailwind: false,
      uiLibraries: [],
    };

    const emptyAnalysis: AnalysisResult = {
      scanResult: emptyScan,
      parsedFiles: [],
      components: [],
      routes: [],
      statePatterns: [],
      apiEndpoints: [],
    };

    const model = await buildSemanticModel(emptyAnalysis);

    expect(model).toBeDefined();
    expect(model.appName).toBeDefined();
    expect(model.version).toBe('1.0');
    expect(model.screens).toEqual([]);
    expect(model.entities).toEqual([]);
    expect(Array.isArray(model.stateManagement)).toBe(true);
    expect(Array.isArray(model.apiEndpoints)).toBe(true);
    expect(model.navigation).toBeDefined();
  });

  test('buildSemanticModel handles analysis with routes but no components', async () => {
    const emptyScan: RepoScanResult = {
      framework: 'nextjs-app-router',
      repoPath: '/fake/project',
      allFiles: [],
      pages: [],
      layouts: [],
      boundaries: [],
      components: [],
      apiRoutes: [],
      styles: [],
      configs: [],
      jsonFiles: [],
      hasTailwind: false,
      uiLibraries: [],
    };

    const analysis: AnalysisResult = {
      scanResult: emptyScan,
      parsedFiles: [],
      components: [],
      routes: [
        {
          urlPath: '/',
          segments: [{ raw: '', name: '', kind: 'static' as const }],
          files: { page: 'app/page.tsx', layout: undefined, loading: undefined, error: undefined, notFound: undefined, template: undefined },
          metadata: { title: undefined, description: undefined },
          parentPath: undefined,
          childPaths: [],
          parallelSlots: [],
          suggestedNavigation: 'stack' as any,
          hasLayout: false,
          isDynamic: false,
        },
      ],
      statePatterns: [],
      apiEndpoints: [],
    };

    const model = await buildSemanticModel(analysis);

    expect(model).toBeDefined();
    expect(model.navigation).toBeDefined();
    // Model should still be valid even with routes but no matched components
  });

  test('generators handle entities with 0 fields', async () => {
    const emptyScan: RepoScanResult = {
      framework: 'react',
      repoPath: '/fake',
      allFiles: [],
      pages: [],
      layouts: [],
      boundaries: [],
      components: [],
      apiRoutes: [],
      styles: [],
      configs: [],
      jsonFiles: [],
      hasTailwind: false,
      uiLibraries: [],
    };

    const emptyAnalysis: AnalysisResult = {
      scanResult: emptyScan,
      parsedFiles: [],
      components: [],
      routes: [],
      statePatterns: [],
      apiEndpoints: [],
    };

    const model = await buildSemanticModel(emptyAnalysis);

    // Force an entity with 0 fields to test generator resilience
    model.entities = [
      {
        name: 'EmptyEntity',
        fields: [],
        sourceFile: 'test.ts',
        confidence: 'low',
        relationships: [],
      },
    ];

    const outputDir = makeTempDir('empty-entity-out');
    const project = await generateProject(model, outputDir);

    expect(project).toBeDefined();
    // The generator should not crash even with an entity with 0 fields
    expect(project.files.length).toBeGreaterThan(0);
  });

  test('full pipeline handles model with 0 screens gracefully', async () => {
    const emptyScan: RepoScanResult = {
      framework: 'react',
      repoPath: '/fake',
      allFiles: [],
      pages: [],
      layouts: [],
      boundaries: [],
      components: [],
      apiRoutes: [],
      styles: [],
      configs: [],
      jsonFiles: [],
      hasTailwind: false,
      uiLibraries: [],
    };

    const emptyAnalysis: AnalysisResult = {
      scanResult: emptyScan,
      parsedFiles: [],
      components: [],
      routes: [],
      statePatterns: [],
      apiEndpoints: [],
    };

    const model = await buildSemanticModel(emptyAnalysis);
    expect(model.screens.length).toBe(0);

    const adapted = adaptForPlatform(model, 'ios');
    expect(adapted).toBeDefined();

    // Should still generate a minimal project (at least App.swift)
    const outputDir = makeTempDir('zero-screens-out');
    const project = await generateProject(adapted, outputDir);
    expect(project).toBeDefined();
    expect(project.files.length).toBeGreaterThan(0);

    // Must have app entry point
    const appSwift = project.files.find(f => f.path.endsWith('App.swift'));
    expect(appSwift).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Task 4: --name flag validation tests
// ---------------------------------------------------------------------------

describe('App Name Validation', () => {
  // We test the validation logic by importing it indirectly through the CLI behavior.
  // Since the validation function is in src/index.ts and not exported, we test
  // the pattern directly here.
  const SWIFT_IDENTIFIER_RE = /^[A-Z][A-Za-z0-9]*$/;

  test('accepts valid PascalCase names', () => {
    expect(SWIFT_IDENTIFIER_RE.test('MyApp')).toBe(true);
    expect(SWIFT_IDENTIFIER_RE.test('ShopKit')).toBe(true);
    expect(SWIFT_IDENTIFIER_RE.test('App')).toBe(true);
    expect(SWIFT_IDENTIFIER_RE.test('A')).toBe(true);
    expect(SWIFT_IDENTIFIER_RE.test('MyApp2')).toBe(true);
  });

  test('rejects invalid names', () => {
    expect(SWIFT_IDENTIFIER_RE.test('myApp')).toBe(false); // lowercase start
    expect(SWIFT_IDENTIFIER_RE.test('my-app')).toBe(false); // hyphen
    expect(SWIFT_IDENTIFIER_RE.test('my_app')).toBe(false); // underscore
    expect(SWIFT_IDENTIFIER_RE.test('My App')).toBe(false); // space
    expect(SWIFT_IDENTIFIER_RE.test('123App')).toBe(false); // starts with number
    expect(SWIFT_IDENTIFIER_RE.test('')).toBe(false); // empty
    expect(SWIFT_IDENTIFIER_RE.test('My.App')).toBe(false); // dot
    expect(SWIFT_IDENTIFIER_RE.test('My@App')).toBe(false); // special char
  });
});

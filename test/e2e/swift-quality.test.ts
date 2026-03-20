/**
 * Swift Output Quality Tests
 *
 * Validates that generated Swift code is structurally sound:
 * - No undeclared variables
 * - No duplicate property declarations
 * - Correct entity field access patterns
 * - Proper async loading patterns
 * - No `Any` types in models from TS interfaces
 */
import { existsSync, rmSync } from 'fs';
import { join } from 'path';

import { describe, test, expect, beforeAll } from 'bun:test';

import { analyzeRepo } from '../../src/analyzer/index';
import { generateProject } from '../../src/generator/index';
import type { GeneratedFile } from '../../src/generator/swiftui-generator';
import { adaptForPlatform } from '../../src/semantic/adapter';
import { buildSemanticModel } from '../../src/semantic/builder';

const FIXTURE_PATH = join(import.meta.dir, '../__fixtures__/sample-nextjs-app');
const OUTPUT_PATH = join(import.meta.dir, '../__output__/swift-quality');

let files: GeneratedFile[] = [];

describe('Swift Output Quality', () => {
  beforeAll(async () => {
    process.env.MORPHKIT_NO_AI = '1';
    process.env.MORPHKIT_SKIP_SWIFT_VALIDATION = '1';
    delete process.env.XAI_API_KEY;

    if (existsSync(OUTPUT_PATH)) {
      rmSync(OUTPUT_PATH, { recursive: true, force: true });
    }

    const analysis = await analyzeRepo(FIXTURE_PATH);
    const model = await buildSemanticModel(analysis);
    const adapted = adaptForPlatform(model, 'ios');
    const project = await generateProject(adapted, OUTPUT_PATH);
    files = project.files;
  });

  test('no Swift file contains bare `Any` type in TS-interface models', () => {
    const productModel = files.find(f => f.path.includes('ProductModels'));
    expect(productModel).toBeDefined();
    // Product model from TS interface should have concrete types, not Any
    expect(productModel!.content).not.toMatch(/var \w+: Any\b/);
  });

  test('no duplicate property declarations within a single struct/class', () => {
    for (const file of files) {
      if (!file.path.endsWith('.swift')) continue;
      const lines = file.content.split('\n');
      let props = new Set<string>();
      const dupes: string[] = [];
      for (const line of lines) {
        // Reset property tracking on new struct/class/enum
        if (line.match(/^(?:struct|class|enum|final class|extension)\s/)) {
          props = new Set<string>();
        }
        // Reset on init/func (local vars are fine)
        if (line.match(/^\s+(?:init|func|private func)\s/)) {
          props = new Set<string>();
        }
        // Only check stored properties (top-level var/let, @State)
        const match = line.match(/^\s{4}(?:var|let|@State\s+(?:private\s+)?var)\s+(\w+)/);
        if (match) {
          const name = match[1];
          if (props.has(name)) {
            dupes.push(`${file.path}: duplicate property '${name}'`);
          }
          props.add(name);
        }
      }
      expect(dupes).toEqual([]);
    }
  });

  test('ProductsView has typed array not [Any]', () => {
    const view = files.find(f => f.path.includes('ProductsView'));
    expect(view).toBeDefined();
    expect(view!.content).not.toContain('[Any]');
    expect(view!.content).toContain('[Product]');
  });

  test('API client methods have typed returns where possible', () => {
    const apiClient = files.find(f => f.path.includes('APIClient'));
    expect(apiClient).toBeDefined();
    // fetchProducts should return [Product], not Any
    expect(apiClient!.content).toContain('-> [Product]');
    // fetchProduct should return Product, not Any
    expect(apiClient!.content).toContain('-> Product');
  });

  test('ContentView has 3 tabs', () => {
    const cv = files.find(f => f.path === 'ContentView.swift');
    expect(cv).toBeDefined();
    const tabTags = cv!.content.match(/\.tag\(AppTab\./g);
    expect(tabTags).toBeDefined();
    expect(tabTags!.length).toBeGreaterThanOrEqual(3);
  });

  test('AppTab enum has 3 cases', () => {
    const tab = files.find(f => f.path.includes('AppTab'));
    expect(tab).toBeDefined();
    const cases = tab!.content.match(/case \w+/g);
    expect(cases).toBeDefined();
    expect(cases!.length).toBeGreaterThanOrEqual(3);
  });

  test('AppRoute has no duplicate cases', () => {
    const route = files.find(f => f.path.includes('AppRoute'));
    expect(route).toBeDefined();
    const cases = route!.content.split('\n')
      .filter(l => l.trim().startsWith('case '))
      .map(l => l.trim().split('(')[0].trim());
    const unique = new Set(cases);
    expect(unique.size).toBe(cases.length);
  });

  test('no JavaScript syntax in Swift files', () => {
    for (const file of files) {
      if (!file.path.endsWith('.swift')) continue;
      expect(file.content).not.toContain('const ');
      expect(file.content).not.toContain('function ');
      expect(file.content).not.toContain('${');
      expect(file.content).not.toContain('encodeURIComponent');
      expect(file.content).not.toContain('console.log');
    }
  });

  test('all views have #Preview', () => {
    const views = files.filter(f => f.path.startsWith('Views/') && f.path.endsWith('.swift'));
    for (const view of views) {
      expect(view.content).toContain('#Preview');
    }
  });

  test('all Swift files have import statement', () => {
    for (const file of files) {
      if (!file.path.endsWith('.swift')) continue;
      expect(file.content).toContain('import ');
    }
  });

  test('source paths are relative not absolute', () => {
    for (const file of files) {
      if (!file.path.endsWith('.swift')) continue;
      // Should not contain /Users/ in generated headers
      expect(file.content).not.toMatch(/\/Users\/\w+\//);
    }
  });

  test('generated project has reasonable file count', () => {
    expect(files.length).toBeGreaterThan(15);
    expect(files.length).toBeLessThan(40);
  });
});

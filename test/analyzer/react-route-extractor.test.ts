import { join } from 'path';

import { describe, test, expect, beforeAll } from 'bun:test';

import { createProject } from '../../src/analyzer/ast-parser';
import { extractReactRoutes } from '../../src/analyzer/react-route-extractor';
import { scanRepo } from '../../src/analyzer/repo-scanner';
import type { RepoScanResult } from '../../src/analyzer/repo-scanner';

const FIXTURE_PATH = join(import.meta.dir, '../__fixtures__/react-vite-app');

describe('React Route Extractor', () => {
  let scanResult: RepoScanResult;

  beforeAll(async () => {
    scanResult = await scanRepo(FIXTURE_PATH);
  });

  test('detects react framework from package.json', () => {
    expect(scanResult.framework).toBe('react');
  });

  test('extracts routes from createBrowserRouter config', () => {
    const sourceFilePaths = scanResult.allFiles
      .filter((f) => ['ts', 'tsx', 'js', 'jsx'].includes(f.extension))
      .map((f) => f.absolutePath);
    const project = createProject(scanResult.repoPath, sourceFilePaths);

    const routes = extractReactRoutes(FIXTURE_PATH, scanResult, project);

    expect(routes.length).toBeGreaterThanOrEqual(5);

    // Root route
    const root = routes.find((r) => r.urlPath === '/');
    expect(root).toBeDefined();
    expect(root!.childPaths.length).toBeGreaterThanOrEqual(3);

    // Static routes
    const productsRoute = routes.find((r) => r.urlPath === '/products');
    expect(productsRoute).toBeDefined();
    expect(productsRoute!.isDynamic).toBe(false);

    const aboutRoute = routes.find((r) => r.urlPath === '/about');
    expect(aboutRoute).toBeDefined();

    const settingsRoute = routes.find((r) => r.urlPath === '/settings');
    expect(settingsRoute).toBeDefined();
  });

  test('handles dynamic segments (:id → dynamic route segment)', () => {
    const sourceFilePaths = scanResult.allFiles
      .filter((f) => ['ts', 'tsx', 'js', 'jsx'].includes(f.extension))
      .map((f) => f.absolutePath);
    const project = createProject(scanResult.repoPath, sourceFilePaths);

    const routes = extractReactRoutes(FIXTURE_PATH, scanResult, project);

    const productDetail = routes.find((r) => r.urlPath === '/products/:id');
    expect(productDetail).toBeDefined();
    expect(productDetail!.isDynamic).toBe(true);
    expect(productDetail!.segments.some((s) => s.kind === 'dynamic' && s.paramName === 'id')).toBe(true);
  });

  test('handles nested routes (children array)', () => {
    const sourceFilePaths = scanResult.allFiles
      .filter((f) => ['ts', 'tsx', 'js', 'jsx'].includes(f.extension))
      .map((f) => f.absolutePath);
    const project = createProject(scanResult.repoPath, sourceFilePaths);

    const routes = extractReactRoutes(FIXTURE_PATH, scanResult, project);

    // All child routes should have parentPath set to "/"
    const childRoutes = routes.filter((r) => r.urlPath !== '/');
    for (const child of childRoutes) {
      expect(child.parentPath).toBe('/');
    }
  });

  test('suggests appropriate navigation kinds', () => {
    const sourceFilePaths = scanResult.allFiles
      .filter((f) => ['ts', 'tsx', 'js', 'jsx'].includes(f.extension))
      .map((f) => f.absolutePath);
    const project = createProject(scanResult.repoPath, sourceFilePaths);

    const routes = extractReactRoutes(FIXTURE_PATH, scanResult, project);

    // Root with multiple children should suggest tabs
    const root = routes.find((r) => r.urlPath === '/');
    expect(root!.suggestedNavigation).toBe('tab');

    // Dynamic detail route at depth 2 should suggest stack
    const productDetail = routes.find((r) => r.urlPath === '/products/:id');
    expect(productDetail!.suggestedNavigation).toBe('stack');
  });

  test('sets files.page to the source file path', () => {
    const sourceFilePaths = scanResult.allFiles
      .filter((f) => ['ts', 'tsx', 'js', 'jsx'].includes(f.extension))
      .map((f) => f.absolutePath);
    const project = createProject(scanResult.repoPath, sourceFilePaths);

    const routes = extractReactRoutes(FIXTURE_PATH, scanResult, project);

    for (const route of routes) {
      expect(route.files.page).toBeDefined();
      expect(route.files.page!.endsWith('.tsx')).toBe(true);
    }
  });

  test('produces ExtractedRoute with all required fields', () => {
    const sourceFilePaths = scanResult.allFiles
      .filter((f) => ['ts', 'tsx', 'js', 'jsx'].includes(f.extension))
      .map((f) => f.absolutePath);
    const project = createProject(scanResult.repoPath, sourceFilePaths);

    const routes = extractReactRoutes(FIXTURE_PATH, scanResult, project);

    for (const route of routes) {
      // All required fields of ExtractedRoute should be present
      expect(route.urlPath).toBeDefined();
      expect(route.segments).toBeInstanceOf(Array);
      expect(route.files).toBeDefined();
      expect(route.metadata).toBeDefined();
      expect(route.childPaths).toBeInstanceOf(Array);
      expect(route.parallelSlots).toBeInstanceOf(Array);
      expect(typeof route.suggestedNavigation).toBe('string');
      expect(typeof route.hasLayout).toBe('boolean');
      expect(typeof route.isDynamic).toBe('boolean');
    }
  });
});

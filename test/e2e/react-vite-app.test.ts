import { join } from 'path';

import { describe, test, expect, beforeAll } from 'bun:test';

import { analyzeRepo } from '../../src/analyzer/index';
import { buildSemanticModel } from '../../src/semantic/builder';

const FIXTURE_PATH = join(import.meta.dir, '../__fixtures__/react-vite-app');

describe('React + Vite App E2E', { timeout: 30_000 }, () => {
  beforeAll(() => {
    // Disable AI client for tests to avoid real API call timeouts
    process.env.MORPHKIT_NO_AI = '1';
    delete process.env.XAI_API_KEY;
  });

  test('detects react framework', async () => {
    const result = await analyzeRepo(FIXTURE_PATH);
    expect(result.scanResult.framework).toBe('react');
  });

  test('extracts routes from react-router-dom', async () => {
    const result = await analyzeRepo(FIXTURE_PATH);

    expect(result.routes.length).toBeGreaterThanOrEqual(5);

    const routePaths = result.routes.map((r) => r.urlPath);
    expect(routePaths).toContain('/');
    expect(routePaths).toContain('/products');
    expect(routePaths).toContain('/products/:id');
    expect(routePaths).toContain('/about');
    expect(routePaths).toContain('/settings');
  });

  test('extracts components from page files', async () => {
    const result = await analyzeRepo(FIXTURE_PATH);
    expect(result.components.length).toBeGreaterThan(0);

    const componentNames = result.components.map((c) => c.name);
    // At least some of the page components should be extracted
    expect(
      componentNames.some(
        (n) => n === 'Home' || n === 'Products' || n === 'About' || n === 'Settings' || n === 'ProductDetail',
      ),
    ).toBe(true);
  });

  test('builds semantic model from analysis', async () => {
    const result = await analyzeRepo(FIXTURE_PATH);
    const model = await buildSemanticModel(result);

    expect(model.appName).toBeDefined();
    expect(model.version).toBe('1.0');
    expect(model.screens.length).toBeGreaterThan(0);
    expect(model.navigation).toBeDefined();
  });

  test('semantic model has routes mapping to screens', async () => {
    const result = await analyzeRepo(FIXTURE_PATH);
    const model = await buildSemanticModel(result);

    // Navigation should have routes
    expect(model.navigation.routes.length).toBeGreaterThan(0);

    // Each route should reference a screen
    for (const route of model.navigation.routes) {
      expect(route.screen).toBeDefined();
      expect(route.path).toBeDefined();
    }
  });
});

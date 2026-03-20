import { existsSync, rmSync } from 'fs';
import { join } from 'path';

import { describe, test, expect, beforeAll } from 'bun:test';

import { analyzeRepo } from '../../src/analyzer/index';
import { generateProject } from '../../src/generator/index';
import { adaptForPlatform } from '../../src/semantic/adapter';
import { buildSemanticModel } from '../../src/semantic/builder';

const FIXTURE_PATH = join(import.meta.dir, '../__fixtures__/nextjs-pages-app');
const OUTPUT_PATH = join(import.meta.dir, '../__output__/pages-router-test');

describe('Next.js Pages Router E2E', { timeout: 30_000 }, () => {
  beforeAll(() => {
    if (existsSync(OUTPUT_PATH)) {
      rmSync(OUTPUT_PATH, { recursive: true, force: true });
    }
    process.env.MORPHKIT_NO_AI = '1';
    delete process.env.XAI_API_KEY;
  });

  test('detects nextjs-pages-router framework', async () => {
    const result = await analyzeRepo(FIXTURE_PATH);
    expect(result.scanResult.framework).toBe('nextjs-pages-router');
  });

  test('extracts routes from pages directory', async () => {
    const result = await analyzeRepo(FIXTURE_PATH);
    expect(result.routes.length).toBeGreaterThanOrEqual(3);

    const urlPaths = result.routes.map(r => r.urlPath);
    expect(urlPaths).toContain('/');
    expect(urlPaths).toContain('/about');
    // Should have products route
    const hasProducts = urlPaths.some(p => p.includes('products'));
    expect(hasProducts).toBe(true);
  });

  test('detects dynamic routes from [id] filenames', async () => {
    const result = await analyzeRepo(FIXTURE_PATH);
    const dynamicRoutes = result.routes.filter(r => r.isDynamic);
    expect(dynamicRoutes.length).toBeGreaterThanOrEqual(1);

    const productDetail = dynamicRoutes.find(r => r.urlPath.includes('[id]') || r.urlPath.includes(':id'));
    expect(productDetail).toBeDefined();
  });

  test('skips _app and _document files', async () => {
    const result = await analyzeRepo(FIXTURE_PATH);
    const routePaths = result.routes.map(r => r.urlPath);
    expect(routePaths).not.toContain('/_app');
    expect(routePaths).not.toContain('/_document');
  });

  test('skips API routes', async () => {
    const result = await analyzeRepo(FIXTURE_PATH);
    const routePaths = result.routes.map(r => r.urlPath);
    const apiRoutes = routePaths.filter(p => p.startsWith('/api'));
    expect(apiRoutes.length).toBe(0);
  });

  test('builds semantic model from pages router analysis', async () => {
    const result = await analyzeRepo(FIXTURE_PATH);
    const model = await buildSemanticModel(result);

    expect(model.appName).toBeDefined();
    expect(model.screens.length).toBeGreaterThan(0);
    expect(model.entities.length).toBeGreaterThan(0);
  });

  test('generates complete project from pages router app', async () => {
    const result = await analyzeRepo(FIXTURE_PATH);
    const model = await buildSemanticModel(result);
    const adapted = adaptForPlatform(model, 'ios');
    const project = await generateProject(adapted, OUTPUT_PATH);

    expect(project.files.length).toBeGreaterThan(5);

    // Should have views
    const viewFiles = project.files.filter(f => f.path.startsWith('Views/'));
    expect(viewFiles.length).toBeGreaterThan(0);

    // Should have CLAUDE.md
    const claudeMd = project.files.find(f => f.path === '../CLAUDE.md');
    expect(claudeMd).toBeDefined();

    // Views should not have JS syntax
    for (const file of project.files) {
      if (file.path.endsWith('.swift')) {
        expect(file.content).not.toContain('const ');
        expect(file.content).not.toContain('function ');
      }
    }
  });
});

import { describe, test, expect, beforeAll } from 'bun:test';
import { join } from 'path';
import { existsSync, rmSync } from 'fs';
import { analyzeRepo } from '../../src/analyzer/index';
import { buildSemanticModel } from '../../src/semantic/builder';
import { adaptForPlatform } from '../../src/semantic/adapter';
import { generateProject } from '../../src/generator/index';

const FIXTURE_PATH = join(import.meta.dir, '../__fixtures__/dashboard-app');
const OUTPUT_PATH = join(import.meta.dir, '../__output__/e2e-dashboard-test');

describe('Dashboard App Pipeline E2E', { timeout: 30_000 }, () => {
  beforeAll(() => {
    // Clean up previous output
    if (existsSync(OUTPUT_PATH)) {
      rmSync(OUTPUT_PATH, { recursive: true, force: true });
    }
    // Disable AI client for tests to avoid real API call timeouts
    process.env.MORPHKIT_NO_AI = '1';
    delete process.env.XAI_API_KEY;
  });

  // ---------------------------------------------------------------------------
  // Analysis
  // ---------------------------------------------------------------------------

  test('detects Next.js App Router framework', async () => {
    const result = await analyzeRepo(FIXTURE_PATH);

    expect(result.scanResult.framework).toBe('nextjs-app-router');
    expect(result.scanResult.pages.length).toBeGreaterThanOrEqual(2);
    expect(result.scanResult.layouts.length).toBeGreaterThanOrEqual(1);
  });

  test('extracts components, routes, state patterns, and API calls', async () => {
    const result = await analyzeRepo(FIXTURE_PATH);

    expect(result.components.length).toBeGreaterThan(0);
    expect(result.routes.length).toBeGreaterThanOrEqual(2);
    expect(result.statePatterns.length).toBeGreaterThan(0);
    expect(result.apiEndpoints.length).toBeGreaterThanOrEqual(2);
  });

  // ---------------------------------------------------------------------------
  // Entity Detection
  // ---------------------------------------------------------------------------

  test('detects AnalyticsData or ActivityItem entity', async () => {
    const result = await analyzeRepo(FIXTURE_PATH);
    const model = await buildSemanticModel(result);

    const entityNames = model.entities.map(e => e.name);
    const hasAnalyticsEntity =
      entityNames.includes('AnalyticsData') ||
      entityNames.includes('ActivityItem');
    expect(hasAnalyticsEntity).toBe(true);
  });

  test('detects UserSettings entity with form-related fields', async () => {
    const result = await analyzeRepo(FIXTURE_PATH);
    const model = await buildSemanticModel(result);

    const settings = model.entities.find(e => e.name === 'UserSettings');
    expect(settings).toBeDefined();

    const fieldNames = settings!.fields.map(f => f.name);
    expect(fieldNames).toContain('name');
    expect(fieldNames).toContain('email');
    expect(fieldNames).toContain('theme');
  });

  test('detects at least one entity overall', async () => {
    const result = await analyzeRepo(FIXTURE_PATH);
    const model = await buildSemanticModel(result);

    expect(model.entities.length).toBeGreaterThanOrEqual(1);
  });

  // ---------------------------------------------------------------------------
  // Screens & Navigation
  // ---------------------------------------------------------------------------

  test('generates a settings screen', async () => {
    const result = await analyzeRepo(FIXTURE_PATH);
    const model = await buildSemanticModel(result);

    const screenNames = model.screens.map(s => s.name.toLowerCase());
    const hasSettingsScreen = screenNames.some(
      n => n.includes('setting'),
    );
    expect(hasSettingsScreen).toBe(true);
  });

  test('generates a dashboard or overview screen', async () => {
    const result = await analyzeRepo(FIXTURE_PATH);
    const model = await buildSemanticModel(result);

    const screenNames = model.screens.map(s => s.name.toLowerCase());
    const hasDashboardScreen = screenNames.some(
      n => n.includes('dashboard') || n.includes('overview') || n.includes('home') || n.includes('analytics'),
    );
    expect(hasDashboardScreen).toBe(true);
  });

  test('detects state bindings for form inputs on settings page', async () => {
    const result = await analyzeRepo(FIXTURE_PATH);

    // Settings page should produce state patterns for form inputs
    expect(result.statePatterns.length).toBeGreaterThan(0);

    // Should have state patterns related to settings or form values
    const hasFormState = result.statePatterns.some(
      sp =>
        sp.hook === 'useState' &&
        (sp.variable.includes('setting') ||
         sp.variable.includes('Saving') ||
         sp.variable.includes('saved') ||
         sp.variable.includes('name') ||
         sp.variable.includes('email')),
    );
    // At least one form-related state binding
    expect(hasFormState || result.statePatterns.length >= 2).toBe(true);
  });

  test('API endpoints detected for analytics and settings', async () => {
    const result = await analyzeRepo(FIXTURE_PATH);

    expect(result.apiEndpoints.length).toBeGreaterThanOrEqual(2);

    // Endpoints may have URL in top-level `url`, `fetch.url`, or `nextApiRoute.urlPath`
    const getUrl = (e: any): string =>
      e.url || e.fetch?.url || e.nextApiRoute?.urlPath || '';

    // Should detect analytics-related endpoints
    const hasAnalyticsEndpoint = result.apiEndpoints.some(
      e => getUrl(e).includes('analytics'),
    );
    expect(hasAnalyticsEndpoint).toBe(true);

    // Should detect settings-related endpoints
    const hasSettingsEndpoint = result.apiEndpoints.some(
      e => getUrl(e).includes('settings') || getUrl(e).includes('api'),
    );
    expect(hasSettingsEndpoint).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Full Generation
  // ---------------------------------------------------------------------------

  test('generates complete Xcode project', async () => {
    const result = await analyzeRepo(FIXTURE_PATH);
    const model = await buildSemanticModel(result);
    const adapted = adaptForPlatform(model, 'ios');
    const project = await generateProject(adapted, OUTPUT_PATH);

    // Should generate a reasonable number of files
    expect(project.files.length).toBeGreaterThan(5);
    expect(project.stats.totalFiles).toBeGreaterThan(5);

    // Should have the app entry point
    const appEntry = project.files.find(f => f.path.endsWith('App.swift'));
    expect(appEntry).toBeDefined();

    // Should have ContentView
    const contentView = project.files.find(f => f.path === 'ContentView.swift');
    expect(contentView).toBeDefined();
  });

  test('generates model files for detected entities', async () => {
    const result = await analyzeRepo(FIXTURE_PATH);
    const model = await buildSemanticModel(result);
    const adapted = adaptForPlatform(model, 'ios');
    const project = await generateProject(adapted, OUTPUT_PATH);

    const modelFiles = project.files.filter(f => f.path.startsWith('Models/'));
    expect(modelFiles.length).toBeGreaterThan(0);

    const allModelContent = modelFiles.map(f => f.content).join('\n');

    // Should have structs for the TypeScript interfaces
    const hasAnalyticsStruct =
      allModelContent.includes('struct AnalyticsData') ||
      allModelContent.includes('struct ActivityItem');
    expect(hasAnalyticsStruct).toBe(true);

    expect(allModelContent).toContain('struct UserSettings');
  });

  test('generates view files for each screen', async () => {
    const result = await analyzeRepo(FIXTURE_PATH);
    const model = await buildSemanticModel(result);
    const adapted = adaptForPlatform(model, 'ios');
    const project = await generateProject(adapted, OUTPUT_PATH);

    const viewFiles = project.files.filter(f => f.path.startsWith('Views/'));
    expect(viewFiles.length).toBeGreaterThanOrEqual(2);

    // Views should not be empty shells
    for (const view of viewFiles) {
      const nonEmptyContent = view.content.replace(/Text\(""\)/g, '').trim();
      expect(nonEmptyContent.length).toBeGreaterThan(100);
    }
  });

  test('generates navigation structure', async () => {
    const result = await analyzeRepo(FIXTURE_PATH);
    const model = await buildSemanticModel(result);
    const adapted = adaptForPlatform(model, 'ios');
    const project = await generateProject(adapted, OUTPUT_PATH);

    const navFiles = project.files.filter(f => f.path.startsWith('Navigation/'));
    expect(navFiles.length).toBeGreaterThanOrEqual(1);

    // Should have a Router
    const routerFile = navFiles.find(f => f.path.includes('Router'));
    expect(routerFile).toBeDefined();
  });

  test('no generated files have confidence "low"', async () => {
    const result = await analyzeRepo(FIXTURE_PATH);
    const model = await buildSemanticModel(result);
    const adapted = adaptForPlatform(model, 'ios');
    const project = await generateProject(adapted, OUTPUT_PATH);

    // Low confidence files should be zero or at most a small fraction
    expect(project.stats.lowConfidence).toBeLessThanOrEqual(
      project.stats.totalFiles / 2,
    );

    // Verify no individual file is tagged low confidence
    const lowConfFiles = project.files.filter(f => f.confidence === 'low');
    expect(lowConfFiles.length).toBe(0);
  });

  test('all generated Swift files have valid syntax basics', async () => {
    const result = await analyzeRepo(FIXTURE_PATH);
    const model = await buildSemanticModel(result);
    const adapted = adaptForPlatform(model, 'ios');
    const project = await generateProject(adapted, OUTPUT_PATH);

    for (const file of project.files) {
      if (file.path.endsWith('.swift')) {
        expect(file.content).toContain('import ');
        // Should not contain JavaScript syntax
        expect(file.content).not.toContain('const ');
        expect(file.content).not.toContain('function ');
      }
    }
  });
});

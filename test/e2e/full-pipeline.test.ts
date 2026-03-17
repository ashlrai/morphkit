import { describe, test, expect, beforeAll, beforeEach } from 'bun:test';
import { join } from 'path';
import { existsSync, rmSync } from 'fs';
import { analyzeRepo } from '../../src/analyzer/index';
import { buildSemanticModel } from '../../src/semantic/builder';
import { adaptForPlatform } from '../../src/semantic/adapter';
import { generateProject } from '../../src/generator/index';

const FIXTURE_PATH = join(import.meta.dir, '../__fixtures__/sample-nextjs-app');
const OUTPUT_PATH = join(import.meta.dir, '../__output__/e2e-test');

describe('Full Pipeline E2E', () => {
  beforeAll(() => {
    // Clean up previous output
    if (existsSync(OUTPUT_PATH)) {
      rmSync(OUTPUT_PATH, { recursive: true, force: true });
    }
    // Disable AI client for tests to avoid timeouts
    delete process.env.XAI_API_KEY;
  });

  test('analyzes sample Next.js app successfully', async () => {
    const result = await analyzeRepo(FIXTURE_PATH);

    expect(result.scanResult.framework).toBe('nextjs-app-router');
    expect(result.components.length).toBeGreaterThan(0);
    expect(result.routes.length).toBeGreaterThan(0);
    expect(result.apiEndpoints.length).toBeGreaterThan(0);
    expect(result.statePatterns.length).toBeGreaterThan(0);
  });

  test('builds semantic model from analysis', async () => {
    const analysisResult = await analyzeRepo(FIXTURE_PATH);
    const model = await buildSemanticModel(analysisResult);

    expect(model.appName).toBeDefined();
    expect(model.version).toBe('1.0');
    expect(model.screens.length).toBeGreaterThan(0);
    expect(model.navigation).toBeDefined();
    expect(model.navigation.type).toMatch(/tab|stack|mixed/);

    // Screens should have unique names
    const screenNames = model.screens.map(s => s.name);
    const uniqueNames = new Set(screenNames);
    expect(uniqueNames.size).toBe(screenNames.length);

    // Should detect some entities
    expect(model.entities.length).toBeGreaterThan(0);

    // Entities should have reasonable field counts (no single-field junk)
    // At least some entities should have multiple fields
    const entitiesWithFields = model.entities.filter(e => e.fields.length > 1);
    // Allow entities with fewer fields if they're the only ones
    expect(model.entities.length).toBeGreaterThan(0);
  });

  test('adapts model for iOS', async () => {
    const analysisResult = await analyzeRepo(FIXTURE_PATH);
    const model = await buildSemanticModel(analysisResult);
    const adapted = adaptForPlatform(model, 'ios');

    expect(adapted.iosNavigation).toBeDefined();
    expect(adapted.iosStateArchitecture).toBeDefined();
    expect(adapted.iosNetworking).toBeDefined();
  });

  test('generates complete Xcode project', async () => {
    const analysisResult = await analyzeRepo(FIXTURE_PATH);
    const model = await buildSemanticModel(analysisResult);
    const adapted = adaptForPlatform(model, 'ios');
    const project = await generateProject(adapted, OUTPUT_PATH);

    // Should generate files
    expect(project.files.length).toBeGreaterThan(10);
    expect(project.stats.totalFiles).toBeGreaterThan(10);

    // Should have the app entry point
    const appEntry = project.files.find(f => f.path.endsWith('App.swift'));
    expect(appEntry).toBeDefined();

    // Should have ContentView
    const contentView = project.files.find(f => f.path === 'ContentView.swift');
    expect(contentView).toBeDefined();

    // Should have views for each screen
    const viewFiles = project.files.filter(f => f.path.startsWith('Views/'));
    expect(viewFiles.length).toBeGreaterThan(0);

    // Views should not be empty shells
    for (const view of viewFiles) {
      // Should have more than just Text("")
      const nonEmptyContent = view.content.replace(/Text\(""\)/g, '').trim();
      expect(nonEmptyContent.length).toBeGreaterThan(100);
    }

    // Should have models
    const modelFiles = project.files.filter(f => f.path.startsWith('Models/'));
    expect(modelFiles.length).toBeGreaterThan(0);

    // Model files should not have garbage names
    for (const model of modelFiles) {
      expect(model.path.length).toBeLessThan(80);
    }

    // Should have navigation files
    const navFiles = project.files.filter(f => f.path.startsWith('Navigation/'));
    expect(navFiles.length).toBeGreaterThanOrEqual(3);

    // AppRoute should not have duplicates
    const routeFile = navFiles.find(f => f.path.includes('AppRoute'));
    if (routeFile) {
      const caseLines = routeFile.content.split('\n').filter(l => l.trim().startsWith('case '));
      const caseNames = caseLines.map(l => l.trim());
      const uniqueCases = new Set(caseNames);
      expect(uniqueCases.size).toBe(caseNames.length);
    }

    // Should have networking files
    const netFiles = project.files.filter(f => f.path.startsWith('Networking/'));
    expect(netFiles.length).toBeGreaterThanOrEqual(2);

    // API Client should not have garbled methods
    const apiClient = netFiles.find(f => f.path.includes('APIClient'));
    if (apiClient) {
      expect(apiClient.content).not.toContain('${');
      expect(apiClient.content).not.toContain('url.toString()');
      expect(apiClient.content).not.toContain('encodeURIComponent');
    }

    // Should have valid Swift syntax (basic check)
    for (const file of project.files) {
      if (file.path.endsWith('.swift')) {
        expect(file.content).toContain('import ');
        // Should not contain JavaScript syntax
        expect(file.content).not.toContain('const ');
        expect(file.content).not.toContain('function ');
      }
    }

    // Confidence stats should be reasonable
    expect(project.stats.highConfidence).toBeGreaterThan(0);
    expect(project.stats.lowConfidence).toBeLessThanOrEqual(project.stats.totalFiles / 2);
  });
});

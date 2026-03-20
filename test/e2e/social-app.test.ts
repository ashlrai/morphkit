import { existsSync, rmSync } from 'fs';
import { join } from 'path';

import { describe, test, expect, beforeAll } from 'bun:test';

import { analyzeRepo } from '../../src/analyzer/index';
import { generateProject } from '../../src/generator/index';
import { adaptForPlatform } from '../../src/semantic/adapter';
import { buildSemanticModel } from '../../src/semantic/builder';

const FIXTURE_PATH = join(import.meta.dir, '../__fixtures__/social-app');
const OUTPUT_PATH = join(import.meta.dir, '../__output__/e2e-social-test');

describe('Social App Pipeline E2E', { timeout: 30_000 }, () => {
  beforeAll(() => {
    // Clean up previous output
    if (existsSync(OUTPUT_PATH)) {
      rmSync(OUTPUT_PATH, { recursive: true, force: true });
    }
    // Disable AI client for tests to avoid real API call timeouts
    process.env.MORPHKIT_NO_AI = '1';
    process.env.MORPHKIT_SKIP_SWIFT_VALIDATION = '1';
    delete process.env.XAI_API_KEY;
  });

  // ---------------------------------------------------------------------------
  // Analysis
  // ---------------------------------------------------------------------------

  test('detects Next.js App Router framework', async () => {
    const result = await analyzeRepo(FIXTURE_PATH);

    expect(result.scanResult.framework).toBe('nextjs-app-router');
    expect(result.scanResult.pages.length).toBeGreaterThanOrEqual(3);
    expect(result.scanResult.layouts.length).toBeGreaterThanOrEqual(1);
  });

  test('extracts components, routes, state patterns, and API calls', async () => {
    const result = await analyzeRepo(FIXTURE_PATH);

    expect(result.components.length).toBeGreaterThan(0);
    expect(result.routes.length).toBeGreaterThanOrEqual(3);
    expect(result.statePatterns.length).toBeGreaterThan(0);
    expect(result.apiEndpoints.length).toBeGreaterThanOrEqual(3);
  });

  // ---------------------------------------------------------------------------
  // Entity Detection
  // ---------------------------------------------------------------------------

  test('detects User entity with profile fields', async () => {
    const result = await analyzeRepo(FIXTURE_PATH);
    const model = await buildSemanticModel(result);

    const user = model.entities.find(e => e.name === 'User');
    expect(user).toBeDefined();
    expect(user!.fields.length).toBeGreaterThanOrEqual(5);

    const fieldNames = user!.fields.map(f => f.name);
    expect(fieldNames).toContain('id');
    expect(fieldNames).toContain('username');
    expect(fieldNames).toContain('displayName');
    expect(fieldNames).toContain('avatar');

    // bio should be optional
    const bio = user!.fields.find(f => f.name === 'bio');
    expect(bio).toBeDefined();
    expect(bio!.optional).toBe(true);
  });

  test('detects Post entity with social fields', async () => {
    const result = await analyzeRepo(FIXTURE_PATH);
    const model = await buildSemanticModel(result);

    const post = model.entities.find(e => e.name === 'Post');
    expect(post).toBeDefined();
    expect(post!.fields.length).toBeGreaterThanOrEqual(5);

    const fieldNames = post!.fields.map(f => f.name);
    expect(fieldNames).toContain('id');
    expect(fieldNames).toContain('content');
    expect(fieldNames).toContain('author');
    expect(fieldNames).toContain('likesCount');
    expect(fieldNames).toContain('createdAt');

    // images should be optional
    const images = post!.fields.find(f => f.name === 'images');
    expect(images).toBeDefined();
    expect(images!.optional).toBe(true);
  });

  test('detects Message or Conversation entity', async () => {
    const result = await analyzeRepo(FIXTURE_PATH);
    const model = await buildSemanticModel(result);

    const entityNames = model.entities.map(e => e.name);
    const hasMessageEntity =
      entityNames.includes('Message') ||
      entityNames.includes('Conversation');
    expect(hasMessageEntity).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Screens & Navigation
  // ---------------------------------------------------------------------------

  test('generates a feed/home screen with list layout', async () => {
    const result = await analyzeRepo(FIXTURE_PATH);
    const model = await buildSemanticModel(result);

    const screenNames = model.screens.map(s => s.name.toLowerCase());
    const hasFeedScreen = screenNames.some(
      n => n.includes('feed') || n.includes('home'),
    );
    expect(hasFeedScreen).toBe(true);

    // The feed screen should use a list-type layout
    const feedScreen = model.screens.find(
      s => s.name.toLowerCase().includes('feed') || s.name.toLowerCase().includes('home'),
    );
    expect(feedScreen).toBeDefined();
    expect(feedScreen!.layout).toMatch(/list|scroll|feed|dashboard|custom|grid/);
  });

  test('generates a profile detail screen', async () => {
    const result = await analyzeRepo(FIXTURE_PATH);
    const model = await buildSemanticModel(result);

    const screenNames = model.screens.map(s => s.name.toLowerCase());
    const hasProfileScreen = screenNames.some(
      n => n.includes('profile'),
    );
    expect(hasProfileScreen).toBe(true);
  });

  test('generates a messages screen', async () => {
    const result = await analyzeRepo(FIXTURE_PATH);
    const model = await buildSemanticModel(result);

    const screenNames = model.screens.map(s => s.name.toLowerCase());
    const hasMessagesScreen = screenNames.some(
      n => n.includes('message'),
    );
    expect(hasMessagesScreen).toBe(true);
  });

  test('has at least 3 API endpoints', async () => {
    const result = await analyzeRepo(FIXTURE_PATH);

    expect(result.apiEndpoints.length).toBeGreaterThanOrEqual(3);

    // Endpoints may have URL in top-level `url`, `fetch.url`, or `nextApiRoute.urlPath`
    const getUrl = (e: any): string =>
      e.url || e.fetch?.url || e.nextApiRoute?.urlPath || '';

    const hasPostsEndpoint = result.apiEndpoints.some(e => getUrl(e).includes('posts'));
    const hasUsersEndpoint = result.apiEndpoints.some(e => getUrl(e).includes('users'));
    const hasMessagesEndpoint = result.apiEndpoints.some(e => getUrl(e).includes('messages'));

    expect(hasPostsEndpoint).toBe(true);
    expect(hasUsersEndpoint).toBe(true);
    expect(hasMessagesEndpoint).toBe(true);
  });

  test('detects dynamic route for profile [username]', async () => {
    const result = await analyzeRepo(FIXTURE_PATH);
    const model = await buildSemanticModel(result);

    // The semantic model should have a parameterized route for profile
    const hasDynamicRoute = model.navigation.routes.some(
      r => r.path.includes(':') || r.params.length > 0,
    );
    // Or the profile screen should exist as a detail screen
    const hasProfileDetail = model.screens.some(
      s => s.name.toLowerCase().includes('profile') && (s.layout === 'detail' || s.name.includes('Detail')),
    );
    expect(hasDynamicRoute || hasProfileDetail).toBe(true);
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
    expect(project.files.length).toBeGreaterThan(8);
    expect(project.stats.totalFiles).toBeGreaterThan(8);

    // Should have the app entry point
    const appEntry = project.files.find(f => f.path.endsWith('App.swift'));
    expect(appEntry).toBeDefined();

    // Should have ContentView
    const contentView = project.files.find(f => f.path === 'ContentView.swift');
    expect(contentView).toBeDefined();
  });

  test('generates Post and User model structs', async () => {
    const result = await analyzeRepo(FIXTURE_PATH);
    const model = await buildSemanticModel(result);
    const adapted = adaptForPlatform(model, 'ios');
    const project = await generateProject(adapted, OUTPUT_PATH);

    const modelFiles = project.files.filter(f => f.path.startsWith('Models/'));
    expect(modelFiles.length).toBeGreaterThan(0);

    const allModelContent = modelFiles.map(f => f.content).join('\n');
    expect(allModelContent).toContain('struct Post');
    expect(allModelContent).toContain('struct User');
  });

  test('generates views for feed, profile, and messages', async () => {
    const result = await analyzeRepo(FIXTURE_PATH);
    const model = await buildSemanticModel(result);
    const adapted = adaptForPlatform(model, 'ios');
    const project = await generateProject(adapted, OUTPUT_PATH);

    const viewFiles = project.files.filter(f => f.path.startsWith('Views/'));
    expect(viewFiles.length).toBeGreaterThanOrEqual(3);

    const viewNames = viewFiles.map(f => f.path.toLowerCase());

    // Should have views corresponding to the main screens
    const hasFeedView = viewNames.some(n => n.includes('feed') || n.includes('home'));
    const hasProfileView = viewNames.some(n => n.includes('profile'));
    const hasMessagesView = viewNames.some(n => n.includes('message'));

    expect(hasFeedView).toBe(true);
    expect(hasProfileView).toBe(true);
    expect(hasMessagesView).toBe(true);

    // Views should not be empty shells
    for (const view of viewFiles) {
      const nonEmptyContent = view.content.replace(/Text\(""\)/g, '').trim();
      expect(nonEmptyContent.length).toBeGreaterThan(100);
    }
  });

  test('generates navigation with routes including a parameterized route', async () => {
    const result = await analyzeRepo(FIXTURE_PATH);
    const model = await buildSemanticModel(result);
    const adapted = adaptForPlatform(model, 'ios');
    const project = await generateProject(adapted, OUTPUT_PATH);

    const navFiles = project.files.filter(f => f.path.startsWith('Navigation/'));
    expect(navFiles.length).toBeGreaterThanOrEqual(1);

    // Should have a Router
    const routerFile = navFiles.find(f => f.path.includes('Router'));
    expect(routerFile).toBeDefined();

    // Navigation model should have routes
    expect(model.navigation).toBeDefined();
    expect(model.navigation.routes.length).toBeGreaterThan(0);

    // Should have a parameterized route for profile/[username]
    const hasParamRoute = model.navigation.routes.some(
      r => r.path.includes(':') || r.path.includes('{'),
    );
    expect(hasParamRoute).toBe(true);
  });

  test('generates API client with fetch methods', async () => {
    const result = await analyzeRepo(FIXTURE_PATH);
    const model = await buildSemanticModel(result);
    const adapted = adaptForPlatform(model, 'ios');
    const project = await generateProject(adapted, OUTPUT_PATH);

    const netFiles = project.files.filter(f => f.path.startsWith('Networking/'));
    expect(netFiles.length).toBeGreaterThanOrEqual(1);

    const apiClient = netFiles.find(f => f.path.includes('APIClient'));
    expect(apiClient).toBeDefined();

    // Should not contain JavaScript syntax
    expect(apiClient!.content).not.toContain('${');
    expect(apiClient!.content).not.toContain('const ');
    expect(apiClient!.content).not.toContain('function ');
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

    // Confidence stats should be reasonable
    expect(project.stats.highConfidence).toBeGreaterThan(0);
    expect(project.stats.lowConfidence).toBeLessThanOrEqual(
      project.stats.totalFiles / 2,
    );
  });

  test('no generated files have confidence "low"', async () => {
    const result = await analyzeRepo(FIXTURE_PATH);
    const model = await buildSemanticModel(result);
    const adapted = adaptForPlatform(model, 'ios');
    const project = await generateProject(adapted, OUTPUT_PATH);

    const lowConfFiles = project.files.filter(f => f.confidence === 'low');
    expect(lowConfFiles.length).toBe(0);
  });
});

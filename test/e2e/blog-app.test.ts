import { describe, test, expect, beforeAll, beforeEach } from 'bun:test';
import { join } from 'path';
import { existsSync, rmSync } from 'fs';
import { analyzeRepo } from '../../src/analyzer/index';
import { buildSemanticModel } from '../../src/semantic/builder';
import { adaptForPlatform } from '../../src/semantic/adapter';
import { generateProject } from '../../src/generator/index';

const FIXTURE_PATH = join(import.meta.dir, '../__fixtures__/blog-app');
const OUTPUT_PATH = join(import.meta.dir, '../__output__/e2e-blog-test');

describe('Blog App Pipeline E2E', () => {
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
    expect(result.scanResult.pages.length).toBeGreaterThanOrEqual(4);
    expect(result.scanResult.layouts.length).toBeGreaterThanOrEqual(1);
  });

  test('extracts components, routes, state patterns, and API calls', async () => {
    const result = await analyzeRepo(FIXTURE_PATH);

    expect(result.components.length).toBeGreaterThan(0);
    expect(result.routes.length).toBeGreaterThanOrEqual(4);
    expect(result.statePatterns.length).toBeGreaterThan(0);
    expect(result.apiEndpoints.length).toBeGreaterThanOrEqual(4);
  });

  // ---------------------------------------------------------------------------
  // Entity Detection
  // ---------------------------------------------------------------------------

  test('detects Post entity with 11+ fields from TypeScript interfaces', async () => {
    const result = await analyzeRepo(FIXTURE_PATH);
    const model = await buildSemanticModel(result);

    const post = model.entities.find(e => e.name === 'Post');
    expect(post).toBeDefined();
    expect(post!.fields.length).toBeGreaterThanOrEqual(11);

    // Verify key fields exist
    const fieldNames = post!.fields.map(f => f.name);
    expect(fieldNames).toContain('id');
    expect(fieldNames).toContain('title');
    expect(fieldNames).toContain('slug');
    expect(fieldNames).toContain('content');
    expect(fieldNames).toContain('excerpt');
    expect(fieldNames).toContain('author');
    expect(fieldNames).toContain('publishedAt');
    expect(fieldNames).toContain('tags');
    expect(fieldNames).toContain('isPublished');

    // coverImage should be optional
    const coverImage = post!.fields.find(f => f.name === 'coverImage');
    expect(coverImage).toBeDefined();
    expect(coverImage!.optional).toBe(true);
  });

  test('detects Author entity with nested object fields', async () => {
    const result = await analyzeRepo(FIXTURE_PATH);
    const model = await buildSemanticModel(result);

    const author = model.entities.find(e => e.name === 'Author');
    expect(author).toBeDefined();
    expect(author!.fields.length).toBeGreaterThanOrEqual(3);

    const fieldNames = author!.fields.map(f => f.name);
    expect(fieldNames).toContain('id');
    expect(fieldNames).toContain('name');
    expect(fieldNames).toContain('avatar');

    // bio should be optional
    const bio = author!.fields.find(f => f.name === 'bio');
    expect(bio).toBeDefined();
    expect(bio!.optional).toBe(true);
  });

  test('detects Comment entity', async () => {
    const result = await analyzeRepo(FIXTURE_PATH);
    const model = await buildSemanticModel(result);

    const comment = model.entities.find(e => e.name === 'Comment');
    expect(comment).toBeDefined();
    expect(comment!.fields.length).toBeGreaterThanOrEqual(5);

    const fieldNames = comment!.fields.map(f => f.name);
    expect(fieldNames).toContain('id');
    expect(fieldNames).toContain('postId');
    expect(fieldNames).toContain('author');
    expect(fieldNames).toContain('content');
    expect(fieldNames).toContain('createdAt');
  });

  // ---------------------------------------------------------------------------
  // Screens & Navigation
  // ---------------------------------------------------------------------------

  test('generates at least 4 screens', async () => {
    const result = await analyzeRepo(FIXTURE_PATH);
    const model = await buildSemanticModel(result);

    expect(model.screens.length).toBeGreaterThanOrEqual(4);

    const screenNames = model.screens.map(s => s.name);
    // Should have screens for the main pages
    expect(screenNames.some(n => n.toLowerCase().includes('home'))).toBe(true);
    expect(screenNames.some(n => n.toLowerCase().includes('blog'))).toBe(true);
    expect(screenNames.some(n => n.toLowerCase().includes('about'))).toBe(true);

    // Screens should have unique names
    const uniqueNames = new Set(screenNames);
    expect(uniqueNames.size).toBe(screenNames.length);
  });

  test('navigation has proper tab structure', async () => {
    const result = await analyzeRepo(FIXTURE_PATH);
    const model = await buildSemanticModel(result);

    expect(model.navigation).toBeDefined();
    // Navigation type should be tab or mixed (tabs + stack for detail views)
    expect(model.navigation.type).toMatch(/tab|mixed/);
    // Should have at least one tab
    expect(model.navigation.tabs.length).toBeGreaterThanOrEqual(1);
    // Should have routes
    expect(model.navigation.routes.length).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // API Client
  // ---------------------------------------------------------------------------

  test('API endpoints include fetch methods for posts and comments', async () => {
    const result = await analyzeRepo(FIXTURE_PATH);
    const model = await buildSemanticModel(result);

    // Should have GET /posts
    const fetchPosts = model.apiEndpoints.find(
      e => e.method === 'GET' && e.url.includes('/posts') && !e.url.includes('/comments'),
    );
    expect(fetchPosts).toBeDefined();

    // Should have GET /posts/:slug (or similar pattern)
    const fetchPost = model.apiEndpoints.find(
      e => e.method === 'GET' && e.url.includes('/posts/') && !e.url.includes('/comments'),
    );
    expect(fetchPost).toBeDefined();

    // Should have GET for comments
    const fetchComments = model.apiEndpoints.find(
      e => e.method === 'GET' && e.url.includes('/comments'),
    );
    expect(fetchComments).toBeDefined();

    // Should have POST for creating comments
    const createComment = model.apiEndpoints.find(
      e => e.method === 'POST' && e.url.includes('/comments'),
    );
    expect(createComment).toBeDefined();
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
    expect(project.files.length).toBeGreaterThan(10);
    expect(project.stats.totalFiles).toBeGreaterThan(10);

    // Should have the app entry point
    const appEntry = project.files.find(f => f.path.endsWith('App.swift'));
    expect(appEntry).toBeDefined();

    // Should have ContentView
    const contentView = project.files.find(f => f.path === 'ContentView.swift');
    expect(contentView).toBeDefined();
  });

  test('generates model files for all entities', async () => {
    const result = await analyzeRepo(FIXTURE_PATH);
    const model = await buildSemanticModel(result);
    const adapted = adaptForPlatform(model, 'ios');
    const project = await generateProject(adapted, OUTPUT_PATH);

    const modelFiles = project.files.filter(f => f.path.startsWith('Models/'));
    expect(modelFiles.length).toBeGreaterThan(0);

    // Model content should contain Post, Author, Comment structs
    const allModelContent = modelFiles.map(f => f.content).join('\n');
    expect(allModelContent).toContain('struct Post');
    expect(allModelContent).toContain('struct Author');
    expect(allModelContent).toContain('struct Comment');
  });

  test('generates view files for each screen', async () => {
    const result = await analyzeRepo(FIXTURE_PATH);
    const model = await buildSemanticModel(result);
    const adapted = adaptForPlatform(model, 'ios');
    const project = await generateProject(adapted, OUTPUT_PATH);

    const viewFiles = project.files.filter(f => f.path.startsWith('Views/'));
    expect(viewFiles.length).toBeGreaterThanOrEqual(4);

    // Views should not be empty shells
    for (const view of viewFiles) {
      const nonEmptyContent = view.content.replace(/Text\(""\)/g, '').trim();
      expect(nonEmptyContent.length).toBeGreaterThan(100);
    }
  });

  test('generates API client with fetchPosts and fetchPost methods', async () => {
    const result = await analyzeRepo(FIXTURE_PATH);
    const model = await buildSemanticModel(result);
    const adapted = adaptForPlatform(model, 'ios');
    const project = await generateProject(adapted, OUTPUT_PATH);

    const netFiles = project.files.filter(f => f.path.startsWith('Networking/'));
    expect(netFiles.length).toBeGreaterThanOrEqual(2);

    const apiClient = netFiles.find(f => f.path.includes('APIClient'));
    expect(apiClient).toBeDefined();

    // Should have fetch methods for the main entities
    expect(apiClient!.content).toContain('fetchPosts');
    expect(apiClient!.content).toContain('fetchPost');

    // Should not contain JavaScript syntax
    expect(apiClient!.content).not.toContain('${');
    expect(apiClient!.content).not.toContain('const ');
    expect(apiClient!.content).not.toContain('function ');
  });

  test('generates navigation with tabs', async () => {
    const result = await analyzeRepo(FIXTURE_PATH);
    const model = await buildSemanticModel(result);
    const adapted = adaptForPlatform(model, 'ios');
    const project = await generateProject(adapted, OUTPUT_PATH);

    const navFiles = project.files.filter(f => f.path.startsWith('Navigation/'));
    expect(navFiles.length).toBeGreaterThanOrEqual(2);

    // Should have AppTab or similar tab definition
    const tabFile = navFiles.find(f => f.path.includes('AppTab'));
    expect(tabFile).toBeDefined();
    expect(tabFile!.content).toContain('enum AppTab');

    // Should have a Router
    const routerFile = navFiles.find(f => f.path.includes('Router'));
    expect(routerFile).toBeDefined();

    // AppRoute should not have duplicate cases
    const routeFile = navFiles.find(f => f.path.includes('AppRoute'));
    if (routeFile) {
      const caseLines = routeFile.content
        .split('\n')
        .filter(l => l.trim().startsWith('case '));
      const caseNames = caseLines.map(l => l.trim());
      const uniqueCases = new Set(caseNames);
      expect(uniqueCases.size).toBe(caseNames.length);
    }
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
});

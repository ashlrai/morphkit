import { describe, test, expect, beforeAll } from 'bun:test';

import type { ExtractedComponent } from '../../src/analyzer/component-extractor';
import type { RepoScanResult, FileEntry } from '../../src/analyzer/repo-scanner';
import type { ExtractedRoute } from '../../src/analyzer/route-extractor';
import { buildSemanticModel } from '../../src/semantic/builder';
import type { AnalysisResult } from '../../src/semantic/builder';

function fe(absPath: string): FileEntry {
  const ext = absPath.split('.').pop() ?? '';
  return { absolutePath: absPath, relativePath: absPath.replace('/fake/project/', ''), extension: ext };
}

function makeRoute(urlPath: string, pagePath: string, opts: Partial<ExtractedRoute> = {}): ExtractedRoute {
  return {
    urlPath,
    segments: urlPath.split('/').filter(Boolean).map(s => ({
      raw: s,
      name: s.replace(/[\[\]\.]/g, ''),
      kind: s.startsWith('[') ? 'dynamic' as const : 'static' as const,
    })),
    files: { page: pagePath, layout: undefined, loading: undefined, error: undefined, notFound: undefined, template: undefined },
    metadata: { title: undefined, description: undefined },
    parentPath: undefined,
    childPaths: [],
    parallelSlots: [],
    suggestedNavigation: 'stack' as any,
    hasLayout: false,
    isDynamic: urlPath.includes('['),
    ...opts,
  };
}

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

describe('Semantic Model Builder', () => {
  beforeAll(() => {
    process.env.MORPHKIT_NO_AI = '1';
    delete process.env.XAI_API_KEY;
  });

  test('builds a basic model from analysis result', async () => {
    const mockAnalysis: AnalysisResult = {
      scanResult: emptyScan,
      parsedFiles: [],
      components: [],
      routes: [
        makeRoute('/', '/fake/project/app/page.tsx'),
        makeRoute('/products', '/fake/project/app/products/page.tsx'),
        makeRoute('/products/[id]', '/fake/project/app/products/[id]/page.tsx'),
      ],
      statePatterns: [],
      apiEndpoints: [],
    };

    const model = await buildSemanticModel(mockAnalysis);

    expect(model.appName).toBeDefined();
    expect(model.navigation).toBeDefined();
    expect(model.navigation.type).toBeDefined();
    // Without components, screens are empty (builder needs component data to create screens)
    expect(model.screens).toBeDefined();
  });

  test('back-fill pass resolves empty entity fields from type definitions', async () => {
    const mockAnalysis: AnalysisResult = {
      scanResult: emptyScan,
      parsedFiles: [{
        filePath: '/fake/project/types.ts',
        types: [{
          name: 'Ticket',
          kind: 'interface',
          isExported: false,  // Not exported — skipped by entitiesFromTypeDefinitions
          text: 'interface Ticket { id: string; title: string; status: string; }',
          properties: [
            { name: 'id', type: 'string', isOptional: false },
            { name: 'title', type: 'string', isOptional: false },
            { name: 'status', type: 'string', isOptional: false },
          ],
        }],
        imports: [],
        exports: [],
      }],
      components: [{
        name: 'TicketList',
        filePath: '/fake/project/app/tickets/page.tsx',
        props: [{ name: 'tickets', type: 'Ticket[]', required: true, defaultValue: null }],
        children: [],
        hooks: [],
        stateVariables: [],
        eventHandlers: [],
        isDefault: true,
        isNamedExport: false,
      }],
      routes: [
        makeRoute('/tickets', '/fake/project/app/tickets/page.tsx'),
      ],
      statePatterns: [],
      apiEndpoints: [],
    };

    const model = await buildSemanticModel(mockAnalysis);

    // The Ticket entity should exist and have been back-filled with fields from the non-exported interface
    const ticket = model.entities.find(e => e.name === 'Ticket');
    expect(ticket).toBeDefined();
    expect(ticket!.fields.length).toBeGreaterThanOrEqual(2);
    // Should have title and status fields (not just synthetic id)
    const fieldNames = ticket!.fields.map(f => f.name);
    expect(fieldNames).toContain('title');
    expect(fieldNames).toContain('status');
  });

  test('Swift stdlib conflict entities are filtered out', async () => {
    const mockAnalysis: AnalysisResult = {
      scanResult: emptyScan,
      parsedFiles: [{
        filePath: '/fake/project/types.ts',
        types: [{
          name: 'Collection',
          kind: 'interface',
          isExported: true,
          text: 'interface Collection { id: string; name: string; items: string[] }',
          properties: [
            { name: 'id', type: 'string', isOptional: false },
            { name: 'name', type: 'string', isOptional: false },
            { name: 'items', type: 'string[]', isOptional: false },
          ],
        }],
        imports: [],
        exports: [],
      }],
      components: [],
      routes: [
        makeRoute('/', '/fake/project/app/page.tsx'),
      ],
      statePatterns: [],
      apiEndpoints: [],
    };

    const model = await buildSemanticModel(mockAnalysis);

    // "Collection" conflicts with Swift stdlib — should be filtered out
    const collection = model.entities.find(e => e.name === 'Collection');
    expect(collection).toBeUndefined();
  });

  test('infers tab navigation for few top-level routes', async () => {
    const mockAnalysis: AnalysisResult = {
      scanResult: emptyScan,
      parsedFiles: [],
      components: [],
      routes: [
        makeRoute('/', 'app/page.tsx'),
        makeRoute('/search', 'app/search/page.tsx'),
        makeRoute('/cart', 'app/cart/page.tsx'),
        makeRoute('/profile', 'app/profile/page.tsx'),
      ],
      statePatterns: [],
      apiEndpoints: [],
    };

    const model = await buildSemanticModel(mockAnalysis);

    // With 4 top-level routes, should suggest tab navigation
    expect(model.navigation.type).toBe('tab');
  });
});

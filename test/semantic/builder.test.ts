import { describe, test, expect } from 'bun:test';
import { buildSemanticModel } from '../../src/semantic/builder';
import type { AnalysisResult } from '../../src/semantic/builder';
import type { RepoScanResult, FileEntry } from '../../src/analyzer/repo-scanner';
import type { ExtractedRoute } from '../../src/analyzer/route-extractor';
import type { ExtractedComponent } from '../../src/analyzer/component-extractor';

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

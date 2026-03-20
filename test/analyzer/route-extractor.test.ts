import { describe, test, expect } from 'bun:test';

import type { RepoScanResult, FileEntry } from '../../src/analyzer/repo-scanner';
import { extractRoutes } from '../../src/analyzer/route-extractor';

function fe(absPath: string): FileEntry {
  const ext = absPath.split('.').pop() ?? '';
  return { absolutePath: absPath, relativePath: absPath.replace('/fake/project/', ''), extension: ext };
}

describe('Route Extractor', () => {
  describe('Next.js App Router', () => {
    test('extracts basic routes from file paths', () => {
      const mockScanResult: RepoScanResult = {
        framework: 'nextjs-app-router',
        repoPath: '/fake/project',
        allFiles: [],
        pages: [
          fe('/fake/project/app/page.tsx'),
          fe('/fake/project/app/about/page.tsx'),
          fe('/fake/project/app/products/page.tsx'),
          fe('/fake/project/app/products/[id]/page.tsx'),
        ],
        layouts: [fe('/fake/project/app/layout.tsx')],
        boundaries: [],
        components: [],
        apiRoutes: [],
        styles: [],
        configs: [],
        jsonFiles: [],
        hasTailwind: false,
        uiLibraries: [],
      };

      const routes = extractRoutes('/fake/project', mockScanResult);

      expect(routes.length).toBeGreaterThanOrEqual(3);

      const homePage = routes.find(r => r.urlPath === '/');
      expect(homePage).toBeDefined();

      const aboutPage = routes.find(r => r.urlPath === '/about');
      expect(aboutPage).toBeDefined();

      // Route extractor converts [id] to :id in URL paths
      const productDetail = routes.find(r => r.urlPath === '/products/:id');
      expect(productDetail).toBeDefined();
      expect(productDetail?.isDynamic).toBe(true);
    });

    test('handles route groups', () => {
      const mockScanResult: RepoScanResult = {
        framework: 'nextjs-app-router',
        repoPath: '/fake/project',
        allFiles: [],
        pages: [
          fe('/fake/project/app/(auth)/login/page.tsx'),
          fe('/fake/project/app/(auth)/register/page.tsx'),
          fe('/fake/project/app/(dashboard)/page.tsx'),
        ],
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

      const routes = extractRoutes('/fake/project', mockScanResult);

      // Route groups should not appear in the path
      const loginRoute = routes.find(r => r.urlPath === '/login');
      expect(loginRoute).toBeDefined();
    });

    test('detects layouts', () => {
      const mockScanResult: RepoScanResult = {
        framework: 'nextjs-app-router',
        repoPath: '/fake/project',
        allFiles: [],
        pages: [
          fe('/fake/project/app/page.tsx'),
          fe('/fake/project/app/dashboard/page.tsx'),
        ],
        layouts: [
          fe('/fake/project/app/layout.tsx'),
          fe('/fake/project/app/dashboard/layout.tsx'),
        ],
        boundaries: [],
        components: [],
        apiRoutes: [],
        styles: [],
        configs: [],
        jsonFiles: [],
        hasTailwind: false,
        uiLibraries: [],
      };

      const routes = extractRoutes('/fake/project', mockScanResult);

      const dashboardRoute = routes.find(r => r.urlPath === '/dashboard');
      expect(dashboardRoute?.hasLayout).toBe(true);
    });
  });
});

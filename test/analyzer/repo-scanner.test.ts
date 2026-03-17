import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { scanRepo } from '../../src/analyzer/repo-scanner';

const TEST_DIR = join(import.meta.dir, '__fixtures__', 'mock-nextjs-app');

describe('Repo Scanner', () => {
  beforeAll(() => {
    // Create a mock Next.js App Router project structure
    const dirs = [
      'app',
      'app/about',
      'app/products',
      'app/products/[id]',
      'app/api/products',
      'app/(auth)/login',
      'components',
      'lib',
    ];

    for (const dir of dirs) {
      mkdirSync(join(TEST_DIR, dir), { recursive: true });
    }

    // Create mock files
    const files: Record<string, string> = {
      'package.json': '{"name": "test-app", "dependencies": {"next": "14.0.0", "react": "18.0.0"}}',
      'next.config.js': 'module.exports = {}',
      'tailwind.config.ts': 'export default { content: [] }',
      'app/layout.tsx': 'export default function Layout({ children }) { return <html><body>{children}</body></html> }',
      'app/page.tsx': 'export default function Home() { return <div>Home</div> }',
      'app/about/page.tsx': 'export default function About() { return <div>About</div> }',
      'app/products/page.tsx': 'export default function Products() { return <div>Products</div> }',
      'app/products/[id]/page.tsx': 'export default function Product({ params }) { return <div>Product</div> }',
      'app/api/products/route.ts': 'export async function GET() { return Response.json([]) }',
      'app/(auth)/login/page.tsx': 'export default function Login() { return <div>Login</div> }',
      'components/Button.tsx': 'export function Button({ children }) { return <button>{children}</button> }',
      'components/Card.tsx': 'export function Card({ title }) { return <div>{title}</div> }',
      'lib/api.ts': 'export async function fetchProducts() { return fetch("/api/products") }',
    };

    for (const [path, content] of Object.entries(files)) {
      writeFileSync(join(TEST_DIR, path), content);
    }
  });

  afterAll(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  test('detects Next.js App Router framework', async () => {
    const result = await scanRepo(TEST_DIR);
    expect(result.framework).toBe('nextjs-app-router');
  });

  test('finds all page files', async () => {
    const result = await scanRepo(TEST_DIR);
    expect(result.pages.length).toBeGreaterThanOrEqual(4);
  });

  test('finds component files', async () => {
    const result = await scanRepo(TEST_DIR);
    expect(result.components.length).toBeGreaterThanOrEqual(2);
  });

  test('finds API routes', async () => {
    const result = await scanRepo(TEST_DIR);
    expect(result.apiRoutes.length).toBeGreaterThanOrEqual(1);
  });

  test('finds config files', async () => {
    const result = await scanRepo(TEST_DIR);
    // RepoScanResult uses 'configs' not 'configFiles'
    expect(result.configs.length).toBeGreaterThanOrEqual(1);
  });
});

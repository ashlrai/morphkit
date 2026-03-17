/**
 * Repo Scanner — discovers and categorizes files in a Next.js / React codebase.
 *
 * Entry point: `scanRepo(repoPath)` returns a `RepoScanResult` with categorized
 * file lists and framework detection metadata.
 */

import fg from 'fast-glob';
import * as path from 'path';
import * as fs from 'fs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FileEntry {
  /** Absolute path */
  absolutePath: string;
  /** Path relative to the repo root */
  relativePath: string;
  /** File extension without the dot, e.g. "tsx" */
  extension: string;
}

export type FrameworkKind =
  | 'nextjs-app-router'
  | 'nextjs-pages-router'
  | 'react'
  | 'unknown';

export interface RepoScanResult {
  /** Root path that was scanned */
  repoPath: string;
  /** Detected framework */
  framework: FrameworkKind;
  /** All discovered source files */
  allFiles: FileEntry[];
  /** Page / route entry-point files (page.tsx, index.tsx, etc.) */
  pages: FileEntry[];
  /** Layout files (layout.tsx) */
  layouts: FileEntry[];
  /** Loading / error / not-found boundary files */
  boundaries: FileEntry[];
  /** React component files (non-page, non-layout .tsx files) */
  components: FileEntry[];
  /** API route files */
  apiRoutes: FileEntry[];
  /** CSS / style files */
  styles: FileEntry[];
  /** Configuration files (next.config.*, tailwind.config.*, tsconfig.json, etc.) */
  configs: FileEntry[];
  /** JSON files that are not configs */
  jsonFiles: FileEntry[];
  /** Whether a Tailwind config was detected */
  hasTailwind: boolean;
  /** Detected UI libraries based on package.json */
  uiLibraries: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toFileEntry(repoPath: string, absolutePath: string): FileEntry {
  return {
    absolutePath,
    relativePath: path.relative(repoPath, absolutePath),
    extension: path.extname(absolutePath).replace('.', ''),
  };
}

function isPageFile(rel: string): boolean {
  const base = path.basename(rel);
  return /^page\.(ts|tsx|js|jsx)$/.test(base);
}

function isLayoutFile(rel: string): boolean {
  const base = path.basename(rel);
  return /^layout\.(ts|tsx|js|jsx)$/.test(base);
}

function isBoundaryFile(rel: string): boolean {
  const base = path.basename(rel);
  return /^(loading|error|not-found|template)\.(ts|tsx|js|jsx)$/.test(base);
}

function isApiRoute(rel: string): boolean {
  return (
    rel.includes('/api/') &&
    /^route\.(ts|tsx|js|jsx)$/.test(path.basename(rel))
  );
}

function isConfigFile(rel: string): boolean {
  const base = path.basename(rel);
  return (
    /^(next|tailwind|postcss|vite|babel|jest)\.config\.(ts|js|mjs|cjs)$/.test(base) ||
    base === 'tsconfig.json' ||
    base === '.eslintrc.json' ||
    base === '.prettierrc'
  );
}

function isStyleFile(rel: string): boolean {
  return /\.(css|scss|sass|less)$/.test(rel);
}

function detectUiLibraries(packageJson: Record<string, unknown>): string[] {
  const deps = {
    ...(packageJson.dependencies as Record<string, string> | undefined),
    ...(packageJson.devDependencies as Record<string, string> | undefined),
  };

  const known: Record<string, string> = {
    '@radix-ui/react-dialog': 'radix-ui',
    '@radix-ui/react-dropdown-menu': 'radix-ui',
    '@headlessui/react': 'headless-ui',
    '@chakra-ui/react': 'chakra-ui',
    '@mui/material': 'material-ui',
    'antd': 'antd',
    'class-variance-authority': 'shadcn',
    'tailwind-merge': 'shadcn',
    '@mantine/core': 'mantine',
  };

  const found = new Set<string>();
  for (const dep of Object.keys(deps)) {
    const lib = known[dep];
    if (lib) found.add(lib);
  }
  return [...found];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scan a repository at `repoPath` and return a categorized inventory of its
 * source files along with framework detection metadata.
 */
export async function scanRepo(repoPath: string): Promise<RepoScanResult> {
  console.log(`[morphkit] Scanning repository at ${repoPath}`);

  const resolvedRoot = path.resolve(repoPath);

  // Discover files --------------------------------------------------------
  const patterns = [
    '**/*.ts',
    '**/*.tsx',
    '**/*.js',
    '**/*.jsx',
    '**/*.css',
    '**/*.scss',
    '**/*.sass',
    '**/*.less',
    '**/*.json',
  ];

  const ignore = [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/.next/**',
    '**/coverage/**',
    '**/.git/**',
  ];

  const rawPaths = await fg(patterns, {
    cwd: resolvedRoot,
    absolute: true,
    ignore,
    dot: false,
  });

  console.log(`[morphkit] Found ${rawPaths.length} files`);

  const allFiles = rawPaths.map((p) => toFileEntry(resolvedRoot, p));

  // Detect framework -------------------------------------------------------
  const hasAppDir = allFiles.some((f) => f.relativePath.startsWith('app/') || f.relativePath.startsWith('src/app/'));
  const hasPagesDir = allFiles.some((f) => f.relativePath.startsWith('pages/') || f.relativePath.startsWith('src/pages/'));
  const hasNextConfig = allFiles.some((f) => /^next\.config\.(ts|js|mjs|cjs)$/.test(path.basename(f.relativePath)));

  let framework: FrameworkKind = 'unknown';
  if (hasNextConfig || hasAppDir || hasPagesDir) {
    framework = hasAppDir ? 'nextjs-app-router' : hasPagesDir ? 'nextjs-pages-router' : 'react';
  } else {
    // Check package.json for next dependency
    const pkgPath = path.join(resolvedRoot, 'package.json');
    try {
      const pkgContent = fs.readFileSync(pkgPath, 'utf-8');
      const pkg = JSON.parse(pkgContent) as Record<string, unknown>;
      const deps = {
        ...(pkg.dependencies as Record<string, string> | undefined),
        ...(pkg.devDependencies as Record<string, string> | undefined),
      };
      if ('next' in deps) {
        framework = hasAppDir ? 'nextjs-app-router' : 'nextjs-pages-router';
      } else if ('react' in deps) {
        framework = 'react';
      }
    } catch {
      // no package.json — leave as unknown
    }
  }

  console.log(`[morphkit] Detected framework: ${framework}`);

  // Categorize files -------------------------------------------------------
  const pages: FileEntry[] = [];
  const layouts: FileEntry[] = [];
  const boundaries: FileEntry[] = [];
  const components: FileEntry[] = [];
  const apiRoutes: FileEntry[] = [];
  const styles: FileEntry[] = [];
  const configs: FileEntry[] = [];
  const jsonFiles: FileEntry[] = [];

  for (const file of allFiles) {
    const rel = file.relativePath;

    if (isConfigFile(rel)) {
      configs.push(file);
    } else if (isStyleFile(rel)) {
      styles.push(file);
    } else if (file.extension === 'json') {
      jsonFiles.push(file);
    } else if (isApiRoute(rel)) {
      apiRoutes.push(file);
    } else if (isPageFile(rel)) {
      pages.push(file);
    } else if (isLayoutFile(rel)) {
      layouts.push(file);
    } else if (isBoundaryFile(rel)) {
      boundaries.push(file);
    } else if (file.extension === 'tsx' || file.extension === 'jsx') {
      components.push(file);
    }
    // .ts / .js utility files are in allFiles but not separately categorized
  }

  // Detect tailwind / UI libs ---------------------------------------------
  const hasTailwind = configs.some((f) =>
    path.basename(f.relativePath).startsWith('tailwind.config'),
  );

  let uiLibraries: string[] = [];
  try {
    const pkgPath = path.join(resolvedRoot, 'package.json');
    const pkgContent = fs.readFileSync(pkgPath, 'utf-8');
    const pkg = JSON.parse(pkgContent) as Record<string, unknown>;
    uiLibraries = detectUiLibraries(pkg);
  } catch {
    // ignore
  }

  console.log(
    `[morphkit] Categorized: ${pages.length} pages, ${layouts.length} layouts, ` +
      `${components.length} components, ${apiRoutes.length} API routes, ` +
      `${styles.length} style files, ${configs.length} configs`,
  );

  return {
    repoPath: resolvedRoot,
    framework,
    allFiles,
    pages,
    layouts,
    boundaries,
    components,
    apiRoutes,
    styles,
    configs,
    jsonFiles,
    hasTailwind,
    uiLibraries,
  };
}

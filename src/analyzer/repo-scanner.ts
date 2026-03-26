/**
 * Repo Scanner — discovers and categorizes files in a Next.js / React codebase.
 *
 * Entry point: `scanRepo(repoPath)` returns a `RepoScanResult` with categorized
 * file lists and framework detection metadata.
 */

import * as fs from 'fs';
import * as path from 'path';

import fg from 'fast-glob';

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
  | 'remix'
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
  /** Detected backend services (Supabase, Stripe, etc.) */
  backendServices: DetectedService[];
  /** Whether react-markdown or similar is used */
  hasMarkdownRendering: boolean;
  /** Detected API base URL from environment files */
  apiBaseURL?: string;
  /** Detected env vars for service configuration (e.g., SUPABASE_URL, SUPABASE_ANON_KEY) */
  detectedEnvVars: Record<string, string>;
}

export interface DetectedService {
  kind: 'supabase' | 'stripe' | 'firebase' | 'clerk' | 'openai' | 'anthropic' | 'other';
  sdkPackage: string;
  version: string;
  features: string[];
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

/**
 * Detect backend services from package.json dependencies.
 * Returns a list of detected services with their SDK package and version.
 */
function detectBackendServices(packageJson: Record<string, unknown>, sourceFiles: FileEntry[]): { services: DetectedService[]; hasMarkdownRendering: boolean } {
  const deps: Record<string, string> = {
    ...(packageJson.dependencies as Record<string, string> | undefined),
    ...(packageJson.devDependencies as Record<string, string> | undefined),
  };

  const services: DetectedService[] = [];

  // Supabase detection
  const supabasePkg = deps['@supabase/supabase-js'] ?? deps['@supabase/ssr'];
  if (supabasePkg) {
    const features: string[] = [];
    // Scan only files that import from Supabase to avoid false positives
    // (.from() is too common in non-Supabase code like Prisma, RxJS, etc.)
    for (const file of sourceFiles) {
      try {
        const content = fs.readFileSync(file.absolutePath, 'utf-8');
        // Only scan files that reference Supabase
        if (!content.includes('supabase') && !content.includes('Supabase')) continue;
        if (content.includes('.auth.') || content.includes('createClient')) features.push('auth');
        if (content.includes('.from(') || content.includes('.rpc(')) features.push('database');
        if (content.includes('.storage.from(')) features.push('storage');
        if (content.includes('.channel(')) features.push('realtime');
      } catch { /* skip unreadable files */ }
    }
    services.push({
      kind: 'supabase',
      sdkPackage: '@supabase/supabase-js',
      version: supabasePkg.replace(/[\^~>=<]/g, '').trim(),
      features: [...new Set(features)],
    });
  }

  // Stripe detection
  const stripePkg = deps['stripe'] ?? deps['@stripe/stripe-js'];
  if (stripePkg) {
    services.push({
      kind: 'stripe',
      sdkPackage: stripePkg === deps['stripe'] ? 'stripe' : '@stripe/stripe-js',
      version: (deps['stripe'] ?? deps['@stripe/stripe-js'] ?? '').replace(/[\^~>=<]/g, '').trim(),
      features: ['payments'],
    });
  }

  // Firebase detection
  const firebasePkg = deps['firebase'] ?? deps['firebase-admin'];
  if (firebasePkg) {
    services.push({
      kind: 'firebase',
      sdkPackage: 'firebase',
      version: firebasePkg.replace(/[\^~>=<]/g, '').trim(),
      features: deps['firebase-admin'] ? ['auth', 'database', 'admin'] : ['auth', 'database'],
    });
  }

  // Clerk detection
  const clerkPkg = deps['@clerk/nextjs'] ?? deps['@clerk/clerk-react'];
  if (clerkPkg) {
    services.push({
      kind: 'clerk',
      sdkPackage: deps['@clerk/nextjs'] ? '@clerk/nextjs' : '@clerk/clerk-react',
      version: clerkPkg.replace(/[\^~>=<]/g, '').trim(),
      features: ['auth'],
    });
  }

  // OpenAI detection
  if (deps['openai']) {
    services.push({
      kind: 'openai',
      sdkPackage: 'openai',
      version: (deps['openai'] ?? '').replace(/[\^~>=<]/g, '').trim(),
      features: ['ai'],
    });
  }

  // Anthropic detection
  if (deps['@anthropic-ai/sdk']) {
    services.push({
      kind: 'anthropic',
      sdkPackage: '@anthropic-ai/sdk',
      version: (deps['@anthropic-ai/sdk'] ?? '').replace(/[\^~>=<]/g, '').trim(),
      features: ['ai'],
    });
  }

  // Markdown rendering detection
  const hasMarkdownRendering = !!(deps['react-markdown'] || deps['remark-gfm'] || deps['@mdx-js/react']);

  return { services, hasMarkdownRendering };
}

// ---------------------------------------------------------------------------
// Environment Variable Detection
// ---------------------------------------------------------------------------

/** Known API base URL env var names across frameworks */
const API_URL_VARS = [
  'NEXT_PUBLIC_API_URL',
  'NEXT_PUBLIC_BASE_URL',
  'NEXT_PUBLIC_BACKEND_URL',
  'VITE_API_URL',
  'VITE_BASE_URL',
  'REACT_APP_API_URL',
  'REACT_APP_BASE_URL',
  'API_BASE_URL',
  'API_URL',
];

/** Known service config env var patterns */
const SERVICE_ENV_PATTERNS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'STRIPE_PUBLIC_KEY',
  'STRIPE_SECRET_KEY',
  'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
  'FIREBASE_API_KEY',
  'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
];

/**
 * Scan .env files for API base URLs and service configuration.
 * Only reads values from .env.example and .env.local (non-secret patterns).
 */
function detectEnvVars(repoPath: string): { apiBaseURL?: string; envVars: Record<string, string> } {
  const envFiles = [
    '.env',
    '.env.local',
    '.env.example',
    '.env.production',
    '.env.development',
  ];

  const envVars: Record<string, string> = {};
  let apiBaseURL: string | undefined;

  for (const envFile of envFiles) {
    const envPath = path.join(repoPath, envFile);
    try {
      if (!fs.existsSync(envPath)) continue;
      const content = fs.readFileSync(envPath, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
        if (!value || value.includes('your-') || value.includes('xxx') || value === '') continue;

        // Check for API base URL
        if (!apiBaseURL && API_URL_VARS.includes(key) && value.startsWith('http')) {
          apiBaseURL = value;
        }

        // Check for service config vars
        if (SERVICE_ENV_PATTERNS.includes(key)) {
          envVars[key] = value;
        }
      }
    } catch { /* skip unreadable env files */ }
  }

  return { apiBaseURL, envVars };
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
  const hasViteConfig = allFiles.some((f) => /^vite\.config\.(ts|js|mjs|cjs)$/.test(path.basename(f.relativePath)));

  // Read package.json once for dependency detection
  let pkgDeps: Record<string, string> = {};
  try {
    const pkgPath = path.join(resolvedRoot, 'package.json');
    const pkgContent = fs.readFileSync(pkgPath, 'utf-8');
    const pkg = JSON.parse(pkgContent) as Record<string, unknown>;
    pkgDeps = {
      ...(pkg.dependencies as Record<string, string> | undefined),
      ...(pkg.devDependencies as Record<string, string> | undefined),
    };
  } catch {
    // no package.json
  }

  const hasNextDep = 'next' in pkgDeps;
  const hasReactRouterDep = 'react-router-dom' in pkgDeps || 'react-router' in pkgDeps;
  const hasRemixDep = '@remix-run/react' in pkgDeps || '@remix-run/node' in pkgDeps;
  const hasReactDep = 'react' in pkgDeps;

  let framework: FrameworkKind = 'unknown';

  if (hasNextConfig || hasNextDep) {
    // Next.js — determine app vs pages router
    framework = hasAppDir ? 'nextjs-app-router' : 'nextjs-pages-router';
  } else if (hasAppDir && !hasViteConfig) {
    // Has app/ directory without Next.js — still treat as app router convention
    framework = 'nextjs-app-router';
  } else if (hasRemixDep) {
    framework = 'remix';
  } else if (hasReactRouterDep && hasReactDep) {
    framework = 'react';
  } else if (hasViteConfig && hasReactDep) {
    framework = 'react';
  } else if (hasReactDep) {
    framework = 'react';
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
  let backendServices: DetectedService[] = [];
  let hasMarkdownRendering = false;
  try {
    const pkgPath = path.join(resolvedRoot, 'package.json');
    const pkgContent = fs.readFileSync(pkgPath, 'utf-8');
    const pkg = JSON.parse(pkgContent) as Record<string, unknown>;
    uiLibraries = detectUiLibraries(pkg);
    const detected = detectBackendServices(pkg, allFiles);
    backendServices = detected.services;
    hasMarkdownRendering = detected.hasMarkdownRendering;
  } catch {
    // ignore
  }

  // Detect env vars for API base URL and service config
  const { apiBaseURL, envVars: detectedEnvVars } = detectEnvVars(resolvedRoot);

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
    backendServices,
    hasMarkdownRendering,
    apiBaseURL,
    detectedEnvVars,
  };
}

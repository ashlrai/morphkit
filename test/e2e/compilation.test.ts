import { existsSync, rmSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';

import { describe, test, expect, beforeAll } from 'bun:test';

import { analyzeRepo } from '../../src/analyzer/index';
import { generateProject } from '../../src/generator/index';
import { adaptForPlatform } from '../../src/semantic/adapter';
import { buildSemanticModel } from '../../src/semantic/builder';

const FIXTURES_DIR = join(import.meta.dir, '../__fixtures__');
const OUTPUT_BASE = join(import.meta.dir, '../__output__/compilation-test');

// Check if Swift toolchain is available
let hasSwift = false;
try {
  execSync('which swift', { stdio: 'pipe' });
  hasSwift = true;
} catch {
  // Swift not available
}

async function generateAndBuild(fixture: string): Promise<void> {
  const fixturePath = join(FIXTURES_DIR, fixture);
  const outputPath = join(OUTPUT_BASE, fixture);

  // Clean previous
  if (existsSync(outputPath)) {
    rmSync(outputPath, { recursive: true, force: true });
  }

  // Run full pipeline
  const analysis = await analyzeRepo(fixturePath);
  const model = await buildSemanticModel(analysis);
  model.appName = 'TestApp';
  const adapted = adaptForPlatform(model, 'ios');
  const result = await generateProject(adapted, outputPath);

  expect(result.files.length).toBeGreaterThan(0);

  // Verify swift build succeeds
  try {
    execSync('swift build', {
      cwd: outputPath,
      timeout: 120_000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err: unknown) {
    const stderr = (err as { stderr?: string })?.stderr ?? '';
    const stdout = (err as { stdout?: string })?.stdout ?? '';
    const output = stdout + '\n' + stderr;
    const errors = output.split('\n').filter(l => l.includes('error:')).slice(0, 10);
    throw new Error(`swift build failed for ${fixture}:\n${errors.join('\n')}`);
  }
}

describe('Compilation Guarantee', () => {
  beforeAll(() => {
    process.env.MORPHKIT_NO_AI = '1';
    process.env.MORPHKIT_SKIP_SWIFT_VALIDATION = '1';
    delete process.env.XAI_API_KEY;
  });

  (hasSwift ? test : test.skip)('sample-nextjs-app compiles', async () => {
    await generateAndBuild('sample-nextjs-app');
  }, 120_000);

  (hasSwift ? test : test.skip)('blog-app compiles', async () => {
    await generateAndBuild('blog-app');
  }, 120_000);

  (hasSwift ? test : test.skip)('dashboard-app compiles', async () => {
    await generateAndBuild('dashboard-app');
  }, 120_000);

  (hasSwift ? test : test.skip)('social-app compiles', async () => {
    await generateAndBuild('social-app');
  }, 120_000);

  (hasSwift ? test : test.skip)('react-vite-app compiles', async () => {
    await generateAndBuild('react-vite-app');
  }, 120_000);

  (hasSwift ? test : test.skip)('nextjs-pages-app compiles', async () => {
    await generateAndBuild('nextjs-pages-app');
  }, 120_000);
});

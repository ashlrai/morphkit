/**
 * Morphkit Watch Mode
 *
 * Watches a web app source directory for changes and incrementally
 * regenerates the SwiftUI output. Runs the full pipeline on startup,
 * then re-runs analysis and diffing on each detected change.
 */

import { watch, type FSWatcher } from 'fs';
import { resolve, relative, extname } from 'path';

import chalk from 'chalk';
import ora from 'ora';

import { analyzeRepo } from './analyzer/index.js';
import { generateProject } from './generator/index.js';
import type { GeneratedProject } from './generator/project-generator.js';
import { adaptForPlatform } from './semantic/adapter.js';
import { buildSemanticModel } from './semantic/builder.js';
import type { SemanticAppModel } from './semantic/model.js';
import { diffModels, isDiffEmpty } from './sync/model-diff.js';
import type { ModelDiff } from './sync/model-diff.js';

// Re-export for consumers that import from watcher
export { diffModels, isDiffEmpty };
export type { ModelDiff };

// ---------------------------------------------------------------------------
// File change filtering
// ---------------------------------------------------------------------------

/** File extensions we care about watching. */
const WATCHED_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.css',
]);

/** Directories to ignore (checked as path segments). */
const IGNORED_DIRS = [
  'node_modules',
  '.next',
  'dist',
  'build',
  '.git',
  '.turbo',
  '.vercel',
];

/**
 * Returns true if a changed file path should trigger a rebuild.
 */
export function shouldWatch(filePath: string): boolean {
  // Must have a watched extension
  const ext = extname(filePath).toLowerCase();
  if (!WATCHED_EXTENSIONS.has(ext)) return false;

  // Must not be inside an ignored directory
  const segments = filePath.split('/');
  for (const seg of segments) {
    if (IGNORED_DIRS.includes(seg)) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Debounce utility
// ---------------------------------------------------------------------------

/**
 * Creates a debounced version of `fn` that waits `delayMs` after the last
 * invocation before actually calling through. Returns a cancel function.
 */
export function createDebouncedRunner(
  fn: () => Promise<void>,
  delayMs: number,
): { trigger: () => void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let pendingWhileRunning = false;

  async function execute(): Promise<void> {
    if (running) {
      pendingWhileRunning = true;
      return;
    }
    running = true;
    try {
      await fn();
    } finally {
      running = false;
      if (pendingWhileRunning) {
        pendingWhileRunning = false;
        // Another change came in while we were rebuilding — run again
        timer = setTimeout(() => void execute(), delayMs);
      }
    }
  }

  return {
    trigger() {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => void execute(), delayMs);
    },
    cancel() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Watch session stats
// ---------------------------------------------------------------------------

interface WatchStats {
  rebuilds: number;
  filesUpdated: number;
  startedAt: number;
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ---------------------------------------------------------------------------
// Main watch function
// ---------------------------------------------------------------------------

export interface WatchOptions {
  sourcePath: string;
  outputPath: string;
  appName?: string;
  debounceMs: number;
}

/**
 * Start watch mode: run the full pipeline once, then watch for changes
 * and incrementally rebuild.
 *
 * Returns a cleanup function to stop watching.
 */
export async function startWatchMode(
  options: WatchOptions,
): Promise<() => void> {
  const { sourcePath, outputPath, appName, debounceMs } = options;

  const stats: WatchStats = {
    rebuilds: 0,
    filesUpdated: 0,
    startedAt: Date.now(),
  };

  let previousModel: SemanticAppModel | null = null;
  let fsWatcher: FSWatcher | null = null;
  const changedFiles: Set<string> = new Set();

  // ------ Initial build ------
  console.log('');
  console.log(
    chalk.cyan('[morphkit]') + ` Watching ${chalk.bold(sourcePath)} for changes...`,
  );

  const initialStart = performance.now();
  const spinner = ora('Running initial build...').start();

  try {
    const analysisResult = await analyzeRepo(sourcePath);
    spinner.text = 'Building semantic model...';
    const model = await buildSemanticModel(analysisResult);

    if (appName) {
      model.appName = appName;
    }

    spinner.text = 'Adapting for iOS...';
    const adapted = adaptForPlatform(model, 'ios');

    spinner.text = 'Generating SwiftUI project...';
    const project = await generateProject(adapted, outputPath);

    const elapsed = formatElapsed(performance.now() - initialStart);
    spinner.succeed(
      chalk.cyan('[morphkit]') +
        ` Initial build: ${chalk.bold(String(project.stats.totalFiles))} files generated in ${chalk.bold(elapsed)}`,
    );

    previousModel = adapted;
    stats.filesUpdated += project.stats.totalFiles;
  } catch (error) {
    spinner.fail('Initial build failed');
    console.error(
      chalk.red(
        `Error: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
    throw error;
  }

  // ------ Rebuild function ------
  async function rebuild(): Promise<void> {
    const filesToReport = [...changedFiles];
    changedFiles.clear();

    if (filesToReport.length === 0) return;

    const rebuildStart = performance.now();

    // Log changed files
    for (const f of filesToReport) {
      const rel = relative(sourcePath, f) || f;
      console.log(
        chalk.cyan('[morphkit]') + ` File changed: ${chalk.dim(rel)}`,
      );
    }

    const rebuildSpinner = ora('Re-analyzing...').start();

    try {
      const analysisResult = await analyzeRepo(sourcePath);
      rebuildSpinner.text = 'Building semantic model...';
      const model = await buildSemanticModel(analysisResult);

      if (appName) {
        model.appName = appName;
      }

      rebuildSpinner.text = 'Adapting for iOS...';
      const adapted = adaptForPlatform(model, 'ios');

      // Diff against previous model
      const diff = previousModel
        ? diffModels(previousModel, adapted)
        : null;

      if (diff && isDiffEmpty(diff)) {
        rebuildSpinner.info(
          chalk.cyan('[morphkit]') +
            ' No semantic changes detected — skipping generation',
        );
        return;
      }

      rebuildSpinner.text = 'Generating SwiftUI project...';
      const project = await generateProject(adapted, outputPath);

      const elapsed = formatElapsed(performance.now() - rebuildStart);
      stats.rebuilds++;
      stats.filesUpdated += project.stats.totalFiles;

      // Build summary of what changed
      const summaryParts: string[] = [];
      if (diff) {
        const updatedFiles = describeChangedFiles(diff, project);
        if (updatedFiles.length > 0) {
          rebuildSpinner.succeed(
            chalk.cyan('[morphkit]') +
              ` Updated: ${chalk.bold(updatedFiles.join(', '))}`,
          );
        } else {
          rebuildSpinner.succeed(
            chalk.cyan('[morphkit]') + ' Rebuild complete',
          );
        }

        if (diff.addedScreens.length > 0)
          summaryParts.push(`+${diff.addedScreens.length} screens`);
        if (diff.removedScreens.length > 0)
          summaryParts.push(`-${diff.removedScreens.length} screens`);
        if (diff.modifiedScreens.length > 0)
          summaryParts.push(`~${diff.modifiedScreens.length} screens`);
        if (diff.addedEntities.length > 0)
          summaryParts.push(`+${diff.addedEntities.length} entities`);
        if (diff.removedEntities.length > 0)
          summaryParts.push(`-${diff.removedEntities.length} entities`);
        if (diff.modifiedEntities.length > 0)
          summaryParts.push(`~${diff.modifiedEntities.length} entities`);
        if (diff.changedNavigation) summaryParts.push('navigation');
        if (diff.changedAuth) summaryParts.push('auth');
      }

      const changeSummary =
        summaryParts.length > 0 ? ` (${summaryParts.join(', ')})` : '';

      console.log(
        chalk.cyan('[morphkit]') +
          ` Rebuild complete in ${chalk.bold(elapsed)}` +
          ` (${project.stats.totalFiles} files)${changeSummary}`,
      );

      previousModel = adapted;
    } catch (error) {
      rebuildSpinner.fail('Rebuild failed');
      console.error(
        chalk.red(
          `Error: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
      // Don't throw — keep watching for the next change
    }
  }

  // ------ Start file watcher ------
  const debounced = createDebouncedRunner(rebuild, debounceMs);

  try {
    fsWatcher = watch(
      sourcePath,
      { recursive: true },
      (_eventType, filename) => {
        if (!filename) return;
        const fullPath = resolve(sourcePath, filename);
        if (shouldWatch(filename)) {
          changedFiles.add(fullPath);
          debounced.trigger();
        }
      },
    );
  } catch (error) {
    console.error(
      chalk.red(
        `Failed to start file watcher: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
    throw error;
  }

  console.log('');
  console.log(
    chalk.dim('  Watching for changes. Press Ctrl+C to stop.'),
  );
  console.log('');

  // ------ Cleanup function ------
  function cleanup(): void {
    debounced.cancel();

    if (fsWatcher) {
      fsWatcher.close();
      fsWatcher = null;
    }

    const sessionDuration = formatElapsed(Date.now() - stats.startedAt);
    console.log('');
    console.log(chalk.cyan('[morphkit]') + ' Watch mode stopped.');
    console.log(
      chalk.dim(
        `  Session: ${sessionDuration} | Rebuilds: ${stats.rebuilds} | Total files updated: ${stats.filesUpdated}`,
      ),
    );
  }

  return cleanup;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Given a diff and the generated project, return a list of notable
 * output file names that likely correspond to the changes.
 */
function describeChangedFiles(
  diff: ModelDiff,
  project: GeneratedProject,
): string[] {
  // Collect all changed screen and entity names
  const changedNames = [
    ...diff.addedScreens,
    ...diff.modifiedScreens,
    ...diff.addedEntities,
    ...diff.modifiedEntities,
  ];

  // Find generated files whose path matches any changed name (case-insensitive)
  const relevantPaths = new Set<string>();
  for (const name of changedNames) {
    const nameLower = name.toLowerCase();
    for (const f of project.files) {
      if (f.path.toLowerCase().includes(nameLower)) {
        relevantPaths.add(f.path);
      }
    }
  }

  const result = [...relevantPaths];

  // Limit to a reasonable number for display
  if (result.length > 5) {
    return [...result.slice(0, 4), `+${result.length - 4} more`];
  }

  return result;
}

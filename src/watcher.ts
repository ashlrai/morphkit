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

// ---------------------------------------------------------------------------
// Model Diff
// ---------------------------------------------------------------------------

export interface ModelDiff {
  addedScreens: string[];
  removedScreens: string[];
  modifiedScreens: string[];
  addedEntities: string[];
  removedEntities: string[];
  modifiedEntities: string[];
  addedEndpoints: string[];
  removedEndpoints: string[];
  changedNavigation: boolean;
  changedAuth: boolean;
}

/**
 * Compare two SemanticAppModels and return a structured diff
 * describing what changed between them.
 */
export function diffModels(
  prev: SemanticAppModel,
  next: SemanticAppModel,
): ModelDiff {
  const diff: ModelDiff = {
    addedScreens: [],
    removedScreens: [],
    modifiedScreens: [],
    addedEntities: [],
    removedEntities: [],
    modifiedEntities: [],
    addedEndpoints: [],
    removedEndpoints: [],
    changedNavigation: false,
    changedAuth: false,
  };

  // --- Screens ---
  const prevScreenNames = new Set(prev.screens.map((s) => s.name));
  const nextScreenNames = new Set(next.screens.map((s) => s.name));

  for (const name of nextScreenNames) {
    if (!prevScreenNames.has(name)) {
      diff.addedScreens.push(name);
    }
  }
  for (const name of prevScreenNames) {
    if (!nextScreenNames.has(name)) {
      diff.removedScreens.push(name);
    }
  }

  // Check for modified screens (same name, different content)
  const prevScreenMap = new Map(prev.screens.map((s) => [s.name, s]));
  const nextScreenMap = new Map(next.screens.map((s) => [s.name, s]));

  for (const [name, nextScreen] of nextScreenMap) {
    if (prevScreenNames.has(name) && !diff.addedScreens.includes(name)) {
      const prevScreen = prevScreenMap.get(name)!;
      if (JSON.stringify(prevScreen) !== JSON.stringify(nextScreen)) {
        diff.modifiedScreens.push(name);
      }
    }
  }

  // --- Entities ---
  const prevEntityNames = new Set(prev.entities.map((e) => e.name));
  const nextEntityNames = new Set(next.entities.map((e) => e.name));

  for (const name of nextEntityNames) {
    if (!prevEntityNames.has(name)) {
      diff.addedEntities.push(name);
    }
  }
  for (const name of prevEntityNames) {
    if (!nextEntityNames.has(name)) {
      diff.removedEntities.push(name);
    }
  }

  const prevEntityMap = new Map(prev.entities.map((e) => [e.name, e]));
  const nextEntityMap = new Map(next.entities.map((e) => [e.name, e]));

  for (const [name, nextEntity] of nextEntityMap) {
    if (prevEntityNames.has(name) && !diff.addedEntities.includes(name)) {
      const prevEntity = prevEntityMap.get(name)!;
      if (JSON.stringify(prevEntity) !== JSON.stringify(nextEntity)) {
        diff.modifiedEntities.push(name);
      }
    }
  }

  // --- API Endpoints ---
  const prevEndpointKeys = new Set(
    prev.apiEndpoints.map((e) => `${e.method} ${e.url}`),
  );
  const nextEndpointKeys = new Set(
    next.apiEndpoints.map((e) => `${e.method} ${e.url}`),
  );

  for (const key of nextEndpointKeys) {
    if (!prevEndpointKeys.has(key)) {
      diff.addedEndpoints.push(key);
    }
  }
  for (const key of prevEndpointKeys) {
    if (!nextEndpointKeys.has(key)) {
      diff.removedEndpoints.push(key);
    }
  }

  // --- Navigation ---
  diff.changedNavigation =
    JSON.stringify(prev.navigation) !== JSON.stringify(next.navigation);

  // --- Auth ---
  diff.changedAuth = JSON.stringify(prev.auth) !== JSON.stringify(next.auth);

  return diff;
}

/**
 * Returns true if the diff contains any changes at all.
 */
export function isDiffEmpty(diff: ModelDiff): boolean {
  return (
    diff.addedScreens.length === 0 &&
    diff.removedScreens.length === 0 &&
    diff.modifiedScreens.length === 0 &&
    diff.addedEntities.length === 0 &&
    diff.removedEntities.length === 0 &&
    diff.modifiedEntities.length === 0 &&
    diff.addedEndpoints.length === 0 &&
    diff.removedEndpoints.length === 0 &&
    !diff.changedNavigation &&
    !diff.changedAuth
  );
}

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
  const relevantNames: string[] = [];

  // Map screen names to likely generated file names
  const allScreenChanges = [
    ...diff.addedScreens,
    ...diff.modifiedScreens,
  ];
  for (const screenName of allScreenChanges) {
    const matching = project.files.filter(
      (f) =>
        f.path.includes(screenName) ||
        f.path.toLowerCase().includes(screenName.toLowerCase()),
    );
    for (const m of matching) {
      relevantNames.push(m.path);
    }
  }

  // Map entity names to likely generated file names
  const allEntityChanges = [
    ...diff.addedEntities,
    ...diff.modifiedEntities,
  ];
  for (const entityName of allEntityChanges) {
    const matching = project.files.filter(
      (f) =>
        f.path.includes(entityName) ||
        f.path.toLowerCase().includes(entityName.toLowerCase()),
    );
    for (const m of matching) {
      if (!relevantNames.includes(m.path)) {
        relevantNames.push(m.path);
      }
    }
  }

  // Limit to a reasonable number for display
  if (relevantNames.length > 5) {
    return [...relevantNames.slice(0, 4), `+${relevantNames.length - 4} more`];
  }

  return relevantNames;
}

#!/usr/bin/env node
import { execSync } from 'child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { resolve, join, dirname } from 'path';

import chalk from 'chalk';
import { Command } from 'commander';
import ora from 'ora';


import { analyzeRepo } from './analyzer/index.js';
import { generateProject } from './generator/index.js';
import { adaptForPlatform } from './semantic/adapter.js';
import { buildSemanticModel } from './semantic/builder.js';
import type { SemanticAppModel } from './semantic/model.js';
import { syncRepos } from './sync/index.js';
import { verifyProject, formatVerifyResult } from './verify.js';
import { startWatchMode } from './watcher.js';

// ---------------------------------------------------------------------------
// API Key Authentication
// ---------------------------------------------------------------------------

const MORPHKIT_API_URL = process.env.MORPHKIT_API_URL ?? 'https://kvuxgjjlmhmhbpqfvqeo.supabase.co/functions/v1';

interface AuthResult {
  valid: boolean;
  tier: 'free' | 'pro' | 'enterprise';
  remaining: number;
  error?: string;
}

/**
 * Resolve the API key from CLI flag, env var, or config file.
 */
function resolveApiKey(flagValue?: string): string | null {
  // 1. CLI flag takes priority
  if (flagValue) return flagValue;

  // 2. Environment variable
  const envKey = process.env.MORPHKIT_API_KEY;
  if (envKey) return envKey;

  // 3. Config file (~/.morphkit/config)
  const configPath = join(process.env.HOME ?? '', '.morphkit', 'config');
  if (existsSync(configPath)) {
    try {
      const config = readFileSync(configPath, 'utf-8');
      const match = config.match(/^api_key\s*=\s*(.+)$/m);
      if (match) return match[1].trim();
    } catch {
      // Ignore read errors
    }
  }

  return null;
}

/**
 * Validate an API key against the Morphkit API and check usage quota.
 * Returns auth result with tier info and remaining quota.
 */
async function validateApiKey(apiKey: string): Promise<AuthResult> {
  try {
    const response = await fetch(`${MORPHKIT_API_URL}/validate-key`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (response.status === 401) {
      return { valid: false, tier: 'free', remaining: 0, error: 'Invalid API key' };
    }

    if (response.status === 429) {
      return { valid: true, tier: 'free', remaining: 0, error: 'Usage quota exceeded. Upgrade at https://morphkit.dev/pricing' };
    }

    if (!response.ok) {
      return { valid: false, tier: 'free', remaining: 0, error: `API error: ${response.status}` };
    }

    const data = await response.json() as { tier: string; remaining: number };
    return {
      valid: true,
      tier: (data.tier as AuthResult['tier']) ?? 'free',
      remaining: data.remaining ?? 0,
    };
  } catch (error) {
    // Network errors — allow offline usage with a warning
    const isNetworkError =
      error instanceof TypeError ||
      (error as any)?.code === 'ECONNREFUSED' ||
      (error as any)?.code === 'ENOTFOUND' ||
      (error instanceof DOMException && error.name === 'TimeoutError') ||
      (error instanceof DOMException && error.name === 'AbortError');

    if (isNetworkError) {
      return { valid: true, tier: 'free', remaining: -1, error: 'Could not reach Morphkit API — running in offline mode' };
    }
    // Unexpected errors — still allow offline but log for debugging
    return { valid: true, tier: 'free', remaining: -1, error: 'API validation failed — running in offline mode' };
  }
}

/**
 * Log usage after a successful generation.
 */
async function logUsage(apiKey: string, sourceRepo: string, status: 'success' | 'failed'): Promise<void> {
  try {
    await fetch(`${MORPHKIT_API_URL}/log-usage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ source_repo: sourceRepo, status }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    // Usage logging is best-effort — don't fail the generation
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VERSION = '0.2.1';

const BANNER = `
  ${chalk.cyan('╔═══════════════════════════════════════╗')}
  ${chalk.cyan('║')}  ${chalk.bold.white('Morphkit')} v${VERSION}                      ${chalk.cyan('║')}
  ${chalk.cyan('║')}  React → Native iOS in seconds        ${chalk.cyan('║')}
  ${chalk.cyan('╚═══════════════════════════════════════╝')}
`;

// ---------------------------------------------------------------------------
// Runtime checks
// ---------------------------------------------------------------------------

/** Check if running under Bun; warn if using Node. */
function checkRuntime(): void {
  const isBun = typeof globalThis.Bun !== 'undefined';
  if (!isBun) {
    console.warn(
      chalk.yellow(
        '\n⚠  Morphkit is designed for Bun. You appear to be running under Node.js.\n' +
          '   Some features may not work correctly.\n' +
          '   Install Bun: curl -fsSL https://bun.sh/install | bash\n',
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/** Validate that a path exists and is a directory. Throws with a clear message if not. */
function validateDirectoryExists(dirPath: string): void {
  if (!existsSync(dirPath)) {
    throw new Error(`Directory not found: ${dirPath}`);
  }
}

/** Validate that the path looks like a project root (has package.json). */
function validateProjectRoot(dirPath: string): void {
  if (!existsSync(join(dirPath, 'package.json'))) {
    console.warn(
      chalk.yellow(
        '\nWarning: No package.json found. Are you pointing at a project root?\n',
      ),
    );
  }
}

/** Validate that --name is a valid Swift identifier (PascalCase, no special chars). */
function validateAppName(name: string): void {
  // Must start with uppercase letter, followed by alphanumeric only
  const SWIFT_IDENTIFIER_RE = /^[A-Z][A-Za-z0-9]*$/;
  if (!SWIFT_IDENTIFIER_RE.test(name)) {
    throw new Error(
      `Invalid app name "${name}". Must be PascalCase with no special characters (e.g., "MyApp", "ShopKit").`,
    );
  }
}

/** Check analysis result for empty projects and warn. */
function validateAnalysisResult(
  result: Awaited<ReturnType<typeof analyzeRepo>>,
): void {
  const totalComponents =
    result.components.length +
    result.scanResult.pages.length +
    result.scanResult.layouts.length;
  if (totalComponents === 0 && result.routes.length === 0) {
    console.warn(
      chalk.yellow(
        '\nWarning: No React components found. Is this a Next.js/React app?',
      ),
    );
  }
}

/** Warn when the semantic model has 0 screens but still proceed. */
function warnIfEmptyModel(model: SemanticAppModel): void {
  if (model.screens.length === 0) {
    console.warn(
      chalk.yellow(
        '\nWarning: Semantic model has 0 screens. A minimal project will be generated.',
      ),
    );
  }
}

/** Format elapsed time in a human-friendly way. */
function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ---------------------------------------------------------------------------
// CLI setup
// ---------------------------------------------------------------------------

checkRuntime();

const program = new Command();

program
  .name('morphkit')
  .description(
    'Semantic AI agent that converts TypeScript/React web apps to native SwiftUI iOS apps.\n\n' +
    'Morphkit analyzes your web app\'s components, routes, state, and API calls,\n' +
    'builds a semantic model, and generates a complete SwiftUI Xcode project.\n\n' +
    'Examples:\n' +
    '  $ morphkit generate ./my-nextjs-app\n' +
    '  $ morphkit generate ./app -o ./ios -n ShopKit\n' +
    '  $ morphkit analyze ./app -o model.json\n' +
    '  $ morphkit preview ./app --screen Dashboard',
  )
  .version(VERSION, '-V, --version', 'Output the current version')
  .option('--no-ai', 'Disable AI-enhanced analysis (use heuristics only)')
  .option('--ai-provider <provider>', 'AI provider to use (claude, grok, openai, none)', undefined)
  .option('--ai-model <model>', 'Override the default AI model for the chosen provider', undefined)
  .hook('preAction', () => {
    const opts = program.opts();
    // --no-ai flag disables all AI
    if (opts.ai === false) {
      process.env.MORPHKIT_NO_AI = '1';
    }
    // --ai-provider none is equivalent to --no-ai
    if (opts.aiProvider === 'none') {
      process.env.MORPHKIT_NO_AI = '1';
    } else if (opts.aiProvider) {
      process.env.MORPHKIT_AI_PROVIDER = opts.aiProvider;
    }
    // --ai-model passes through to the builder via env var
    if (opts.aiModel) {
      process.env.MORPHKIT_AI_MODEL = opts.aiModel;
    }
  });

program
  .command('analyze')
  .description(
    'Analyze a web app and output the semantic model as JSON.\n\n' +
    'Examples:\n' +
    '  $ morphkit analyze ./my-app\n' +
    '  $ morphkit analyze ./my-app -o model.json\n' +
    '  $ morphkit analyze ./my-app -v',
  )
  .argument('<path>', 'Path to the web app repository')
  .option('-o, --output <file>', 'Output file for the semantic model JSON')
  .option('-v, --verbose', 'Show detailed analysis output', false)
  .action(async (repoPath: string, options: { output?: string; verbose?: boolean }) => {
    const absolutePath = resolve(repoPath);

    // Validate directory exists before starting spinner
    validateDirectoryExists(absolutePath);
    validateProjectRoot(absolutePath);

    const startTime = performance.now();
    const spinner = ora('Analyzing repository...').start();

    try {
      // Stage 1: Scan and extract
      spinner.text = 'Scanning repository structure...';
      const analysisResult = await analyzeRepo(absolutePath);

      // Check if we found anything useful
      validateAnalysisResult(analysisResult);

      if (options.verbose) {
        spinner.info(`Found ${analysisResult.components.length} components`);
        spinner.info(`Found ${analysisResult.routes.length} routes`);
        spinner.info(`Found ${analysisResult.statePatterns.length} state patterns`);
        spinner.info(`Found ${analysisResult.apiEndpoints.length} API endpoints`);
        spinner.start();
      }

      // Stage 2: Build semantic model
      spinner.text = 'Building semantic model...';
      const model = await buildSemanticModel(analysisResult);

      const elapsed = formatElapsed(Math.round(performance.now() - startTime));
      spinner.succeed(`Analysis complete in ${elapsed}`);

      // Output
      const json = JSON.stringify(model, null, 2);
      if (options.output) {
        writeFileSync(resolve(options.output), json, 'utf-8');
        console.log(chalk.green(`\nSemantic model written to ${options.output}`));
      } else {
        console.log('\n' + json);
      }

      printModelSummary(model);
    } catch (error) {
      spinner.fail('Analysis failed');
      console.error(chalk.red(`\nError: ${error instanceof Error ? error.message : error}`));
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// plan — intelligent mobile scope planning (always free)
// ---------------------------------------------------------------------------

program
  .command('plan')
  .description('Analyze a web app and generate an iOS conversion plan')
  .argument('<repo-path>', 'Path to the web app repository')
  .option('-o, --output <file>', 'Output plan to a file instead of stdout')
  .action(async (repoPath: string, options: { output?: string }) => {
    const absolutePath = resolve(repoPath);
    validateDirectoryExists(absolutePath);

    const spinner = ora('Analyzing codebase...').start();

    try {
      const { analyzeRepo } = await import('./analyzer/index.js');
      const { buildSemanticModel } = await import('./semantic/builder.js');
      const { generatePlan } = await import('./planner.js');

      spinner.text = 'Scanning repository...';
      const analysis = await analyzeRepo(absolutePath);

      spinner.text = 'Building semantic model...';
      const model = await buildSemanticModel(analysis);

      spinner.text = 'Generating conversion plan...';
      const plan = generatePlan(model);

      spinner.stop();

      if (options.output) {
        const { writeFileSync } = await import('fs');
        writeFileSync(resolve(options.output), plan.markdownPlan, 'utf-8');
        console.log(chalk.green(`\nPlan written to ${options.output}`));
      } else {
        console.log(plan.markdownPlan);
      }

      // Summary
      console.log('');
      console.log(chalk.bold('Plan Summary'));
      console.log(chalk.dim('─'.repeat(40)));
      console.log(`  Screens included: ${chalk.green(String(plan.includedScreens))} of ${plan.totalScreens}`);
      console.log(`  Screens excluded: ${chalk.dim(String(plan.excludedScreens.length))}`);
      console.log(`  Integrations:     ${chalk.cyan(plan.integrations.map(i => i.kind).join(', ') || 'none')}`);
      console.log(`  SSE endpoints:    ${plan.sseEndpointCount > 0 ? chalk.yellow(String(plan.sseEndpointCount)) : '0'}`);
      console.log('');
      console.log(chalk.dim('This command is always free. Run `morphkit generate` to create the iOS project.'));
    } catch (error) {
      spinner.stop();
      console.error(chalk.red(`\nPlan generation failed: ${error instanceof Error ? error.message : error}`));
      process.exit(1);
    }
  });

program
  .command('generate')
  .description(
    'Generate a SwiftUI Xcode project from a web app.\n\n' +
    'Examples:\n' +
    '  $ morphkit generate ./my-nextjs-app\n' +
    '  $ morphkit generate ./app -o ./ios -n ShopKit\n' +
    '  $ morphkit generate ./app --model model.json',
  )
  .argument('<path>', 'Path to the web app repository')
  .option('-o, --output <dir>', 'Output directory for the iOS project', './ios-app')
  .option('-n, --name <name>', 'App name (defaults to package.json name)')
  .option('--model <file>', 'Use a pre-built semantic model JSON file instead of analyzing')
  .option('--api-key <key>', 'Morphkit API key (or set MORPHKIT_API_KEY env var)')
  .option('-v, --verbose', 'Show detailed generation output', false)
  .action(async (repoPath: string, options: { output: string; name?: string; model?: string; verbose?: boolean; apiKey?: string }) => {
    const absolutePath = resolve(repoPath);
    const outputPath = resolve(options.output);

    // Validate inputs before starting
    validateDirectoryExists(absolutePath);
    validateProjectRoot(absolutePath);
    if (options.name) {
      validateAppName(options.name);
    }

    // Show banner for generate command
    console.log(BANNER);

    // API key authentication
    const apiKey = resolveApiKey(options.apiKey);
    if (apiKey) {
      const auth = await validateApiKey(apiKey);
      if (!auth.valid) {
        console.error(chalk.red(`\nAuthentication failed: ${auth.error}`));
        console.error(chalk.dim('Get an API key at https://morphkit.dev/dashboard'));
        process.exit(1);
      }
      if (auth.remaining === 0) {
        console.error(chalk.red(`\n${auth.error}`));
        process.exit(1);
      }
      if (auth.error) {
        // Offline mode warning — make it visible
        console.warn('');
        console.warn(chalk.yellow('  ⚠  ' + auth.error));
        console.warn(chalk.yellow('  ⚠  Usage will not be tracked. Get a free API key at:'));
        console.warn(chalk.yellow('  ⚠  https://morphkit.dev/dashboard'));
        console.warn('');
      } else {
        console.log(chalk.dim(`  Authenticated (${auth.tier} tier${auth.remaining > 0 ? `, ${auth.remaining} conversions remaining` : ''})`));
      }
    } else {
      console.log(chalk.dim('  No API key set — running in offline mode'));
      console.log(chalk.dim('  Get a free key (20 conversions/month) at https://morphkit.dev/dashboard'));
    }

    const startTime = performance.now();
    const spinner = ora('Starting generation pipeline...').start();

    try {
      let model: SemanticAppModel;

      if (options.model) {
        // Use pre-built model
        spinner.text = 'Loading semantic model...';
        const modelPath = resolve(options.model);
        if (!existsSync(modelPath)) {
          throw new Error(`Model file not found: ${modelPath}`);
        }
        const modelFile = readFileSync(modelPath, 'utf-8');
        model = JSON.parse(modelFile) as SemanticAppModel;
      } else {
        // Full pipeline: analyze -> build model
        spinner.text = 'Analyzing repository...';
        const analysisResult = await analyzeRepo(absolutePath);
        validateAnalysisResult(analysisResult);

        spinner.text = 'Building semantic model...';
        model = await buildSemanticModel(analysisResult);
      }

      // Override app name if provided
      if (options.name) {
        model.appName = options.name;
      }

      // Warn if model is empty but continue with minimal generation
      warnIfEmptyModel(model);

      // Stage 3: Adapt for iOS
      spinner.text = 'Adapting for iOS platform...';
      const adapted = adaptForPlatform(model, 'ios');

      // Stage 4: Generate
      spinner.text = 'Generating SwiftUI project...';
      const project = await generateProject(adapted, outputPath);

      const elapsed = formatElapsed(Math.round(performance.now() - startTime));
      spinner.succeed('Generation complete!');

      // Log usage (best-effort, non-blocking)
      if (apiKey) {
        logUsage(apiKey, absolutePath, 'success').catch(() => {});
      }

      // Print summary
      console.log('');
      console.log(chalk.bold('Generated Project Summary'));
      console.log(chalk.dim('─'.repeat(40)));
      console.log(`  App name:       ${chalk.cyan(project.appName)}`);
      console.log(`  Output:         ${chalk.cyan(project.outputPath)}`);
      console.log(`  Total files:    ${chalk.white(project.stats.totalFiles)}`);
      console.log(`  ${chalk.green('●')} High confidence:   ${project.stats.highConfidence}`);
      console.log(`  ${chalk.yellow('●')} Medium confidence: ${project.stats.mediumConfidence}`);
      console.log(`  ${chalk.red('●')} Low confidence:    ${project.stats.lowConfidence}`);

      if (project.stats.warnings.length > 0) {
        console.log('');
        console.log(chalk.yellow('Warnings:'));
        for (const warning of project.stats.warnings) {
          console.log(chalk.yellow(`  ⚠ ${warning}`));
        }
      }

      console.log('');
      console.log(
        chalk.dim(`Generated ${project.stats.totalFiles} files in ${elapsed}`),
      );
      // Next steps guidance
      console.log('');
      console.log(chalk.bold('Next Steps'));
      console.log(chalk.dim('─'.repeat(40)));
      console.log(`  1. ${chalk.cyan(`open ${outputPath}/Package.swift`)}  — Open in Xcode`);
      console.log(`  2. ${chalk.cyan(`swift build`)}  — Verify compilation`);
      console.log(`  3. Set API URL in ${chalk.dim('Networking/APIConfiguration.swift')}`);
      console.log(`  4. Study the ${chalk.green('REFERENCE IMPL')} views for the canonical data loading pattern`);
      console.log(`  5. Wire remaining screens by following the reference pattern`);
      console.log(`  6. Read ${chalk.dim('CLAUDE.md')} for full architecture and API contract docs`);
      console.log('');
      console.log(chalk.dim('Tip: Use Claude Code or another AI assistant with the generated CLAUDE.md'));
      console.log(chalk.dim('for the fastest path to a complete app.'));
    } catch (error) {
      spinner.fail('Generation failed');
      if (apiKey) {
        logUsage(apiKey, absolutePath, 'failed').catch(() => {});
      }
      console.error(chalk.red(`\nError: ${error instanceof Error ? error.message : error}`));
      process.exit(1);
    }
  });

program
  .command('preview')
  .description(
    'Preview what would be generated without writing files.\n\n' +
    'Examples:\n' +
    '  $ morphkit preview ./my-app\n' +
    '  $ morphkit preview ./my-app --screen Dashboard',
  )
  .argument('<path>', 'Path to the web app repository')
  .option('-s, --screen <name>', 'Preview a specific screen')
  .action(async (repoPath: string, options: { screen?: string }) => {
    const absolutePath = resolve(repoPath);

    validateDirectoryExists(absolutePath);
    validateProjectRoot(absolutePath);

    const startTime = performance.now();
    const spinner = ora('Analyzing for preview...').start();

    try {
      const analysisResult = await analyzeRepo(absolutePath);
      const model = await buildSemanticModel(analysisResult);
      const adapted = adaptForPlatform(model, 'ios');

      spinner.succeed('Analysis complete');

      // Generate to a temp directory so file writes succeed
      const tempDir = mkdtempSync(resolve(tmpdir(), 'morphkit-preview-'));

      try {
        const project = await generateProject(adapted, tempDir);

        const filesToShow = options.screen
          ? project.files.filter(f => f.path.toLowerCase().includes(options.screen!.toLowerCase()))
          : project.files;

        for (const file of filesToShow) {
          console.log('');
          console.log(chalk.bold.cyan(`── ${file.path} ──`));
          console.log(chalk.dim(`Source: ${file.sourceMapping}`));
          console.log(chalk.dim(`Confidence: ${file.confidence}`));
          if (file.warnings.length > 0) {
            console.log(chalk.yellow(`Warnings: ${file.warnings.join(', ')}`));
          }
          console.log('');
          console.log(file.content);
        }

        const elapsed = formatElapsed(Math.round(performance.now() - startTime));
        console.log('');
        console.log(chalk.dim(`Previewed ${filesToShow.length} files in ${elapsed}`));
      } finally {
        // Clean up temp directory
        rmSync(tempDir, { recursive: true, force: true });
      }
    } catch (error) {
      spinner.fail('Preview failed');
      console.error(chalk.red(`\nError: ${error instanceof Error ? error.message : error}`));
      process.exit(1);
    }
  });

program
  .command('watch')
  .description(
    'Watch a web app for changes and incrementally regenerate the SwiftUI project.\n\n' +
    'Runs the full pipeline on startup, then watches for file changes and\n' +
    'rebuilds only what changed.\n\n' +
    'Examples:\n' +
    '  $ morphkit watch ./my-nextjs-app\n' +
    '  $ morphkit watch ./app -o ./ios -n ShopKit\n' +
    '  $ morphkit watch ./app --debounce 2000',
  )
  .argument('<path>', 'Path to the web app repository')
  .option('-o, --output <dir>', 'Output directory for the iOS project', './ios-app')
  .option('-n, --name <name>', 'App name (defaults to package.json name)')
  .option('--debounce <ms>', 'Debounce delay in milliseconds', '1000')
  .action(async (repoPath: string, options: { output: string; name?: string; debounce: string }) => {
    const absolutePath = resolve(repoPath);
    const outputPath = resolve(options.output);
    const debounceMs = parseInt(options.debounce, 10);

    // Validate inputs
    validateDirectoryExists(absolutePath);
    validateProjectRoot(absolutePath);
    if (options.name) {
      validateAppName(options.name);
    }
    if (isNaN(debounceMs) || debounceMs < 0) {
      console.error(chalk.red('Error: --debounce must be a positive number of milliseconds'));
      process.exit(1);
    }

    // Show banner
    console.log(BANNER);

    let cleanup: (() => void) | null = null;

    // Graceful shutdown handler
    function handleShutdown(): void {
      if (cleanup) {
        cleanup();
        cleanup = null;
      }
      process.exit(0);
    }

    process.on('SIGINT', handleShutdown);
    process.on('SIGTERM', handleShutdown);

    try {
      cleanup = await startWatchMode({
        sourcePath: absolutePath,
        outputPath,
        appName: options.name,
        debounceMs,
      });
    } catch (error) {
      console.error(chalk.red(`\nError: ${error instanceof Error ? error.message : error}`));
      process.exit(1);
    }
  });

program
  .command('sync')
  .description(
    'Sync a web app\'s changes to an existing iOS project via Git.\n\n' +
    'Analyzes the web app, diffs the semantic model against the previous\n' +
    'sync, regenerates only changed files, and creates a Git branch\n' +
    '(optionally with a GitHub PR).\n\n' +
    'Examples:\n' +
    '  $ morphkit sync ./my-nextjs-app ./ios-app\n' +
    '  $ morphkit sync ./app ./ios --no-pr --dry-run\n' +
    '  $ morphkit sync ./app ./ios --base-branch develop',
  )
  .argument('<source-path>', 'Path to the web app repository')
  .argument('<target-path>', 'Path to the iOS project repository')
  .option('--base-branch <branch>', 'Base branch for the PR', 'main')
  .option('--no-pr', 'Commit changes without creating a GitHub PR')
  .option('--dry-run', 'Show what would change without committing', false)
  .option('-n, --name <name>', 'App name override (PascalCase)')
  .option('--pr-title <title>', 'Custom PR title')
  .action(async (sourcePath: string, targetPath: string, options: {
    baseBranch: string;
    pr: boolean;
    dryRun: boolean;
    name?: string;
    prTitle?: string;
  }) => {
    const absSource = resolve(sourcePath);
    const absTarget = resolve(targetPath);

    // Validate inputs
    validateDirectoryExists(absSource);
    validateDirectoryExists(absTarget);
    validateProjectRoot(absSource);
    if (options.name) {
      validateAppName(options.name);
    }

    // Show banner
    console.log(BANNER);

    const startTime = performance.now();
    const spinner = ora('Starting sync...').start();

    try {
      spinner.text = 'Analyzing source repo and diffing models...';

      const result = await syncRepos({
        sourceRepo: absSource,
        targetRepo: absTarget,
        appName: options.name,
        baseBranch: options.baseBranch,
        createPR: options.pr,
        prTitle: options.prTitle,
        dryRun: options.dryRun,
      });

      const elapsed = formatElapsed(Math.round(performance.now() - startTime));

      if (!result.hasChanges) {
        spinner.succeed(`No changes detected (${elapsed})`);
        console.log(chalk.dim('\nThe iOS project is already up to date with the web app.'));
        return;
      }

      if (options.dryRun) {
        spinner.succeed(`Dry run complete (${elapsed})`);
      } else {
        spinner.succeed(`Sync complete (${elapsed})`);
      }

      // Print summary
      console.log('');
      console.log(chalk.bold('Sync Summary'));
      console.log(chalk.dim('\u2500'.repeat(50)));
      console.log(`  ${chalk.cyan('Model diff:')}  ${result.modelDiff.summary}`);
      console.log(`  ${chalk.green('Added:')}       ${result.addedFiles.length} file(s)`);
      console.log(`  ${chalk.yellow('Modified:')}    ${result.changedFiles.length - result.addedFiles.length} file(s)`);
      console.log(`  ${chalk.red('Removed:')}     ${result.removedFiles.length} file(s) (flagged, not deleted)`);
      if (result.conflictFiles.length > 0) {
        console.log(`  ${chalk.magenta('Conflicts:')}   ${result.conflictFiles.length} file(s) with manual edits (preserved)`);
      }

      if (!options.dryRun) {
        console.log(`  ${chalk.dim('Branch:')}      ${result.branchName}`);
      }

      if (result.prUrl) {
        console.log('');
        console.log(chalk.green(`PR created: ${result.prUrl}`));
      }
      if (result.manualInstructions) {
        console.log('');
        console.log(chalk.yellow(result.manualInstructions));
      }

      if (options.dryRun) {
        console.log('');
        console.log(chalk.dim('This was a dry run. No files were written or committed.'));
        console.log(chalk.dim('Remove --dry-run to apply changes.'));
      }

      // List changed files if not too many
      if (result.changedFiles.length > 0 && result.changedFiles.length <= 20) {
        console.log('');
        console.log(chalk.bold('Changed Files:'));
        for (const f of result.changedFiles) {
          const prefix = result.addedFiles.includes(f) ? chalk.green('+ ') : chalk.yellow('~ ');
          console.log(`  ${prefix}${f}`);
        }
      }
      if (result.removedFiles.length > 0 && result.removedFiles.length <= 10) {
        for (const f of result.removedFiles) {
          console.log(`  ${chalk.red('- ')}${f}`);
        }
      }
    } catch (error) {
      spinner.fail('Sync failed');
      console.error(chalk.red(`\nError: ${error instanceof Error ? error.message : error}`));
      process.exit(1);
    }
  });

program
  .command('verify')
  .description('Verify completion status of a generated iOS project')
  .argument('<path>', 'Path to the generated iOS project directory')
  .option('--json', 'Output raw JSON instead of formatted text')
  .action(async (projectPath: string, options: { json?: boolean }) => {
    const resolvedPath = resolve(projectPath);

    validateDirectoryExists(resolvedPath);

    const spinner = ora('Verifying project...').start();

    try {
      const result = verifyProject(resolvedPath);
      spinner.succeed('Verification complete');

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log('');
        console.log(chalk.bold('Verification Result'));
        console.log(chalk.dim('─'.repeat(40)));
        console.log(formatVerifyResult(result));
      }
    } catch (error) {
      spinner.fail('Verification failed');
      console.error(chalk.red(`\nError: ${error instanceof Error ? error.message : error}`));
      process.exit(1);
    }
  });

program
  .command('setup')
  .description('Register Morphkit MCP server in Claude Code settings')
  .option('--global', 'Register in ~/.claude/settings.json (default: project-local .claude/settings.json)')
  .action(async (options: { global?: boolean }) => {
    const settingsPath = options.global
      ? join(homedir(), '.claude', 'settings.json')
      : join(process.cwd(), '.claude', 'settings.json');

    try {
      // Read existing settings or start fresh
      const settings: Record<string, any> = Object.create(null);
      if (existsSync(settingsPath)) {
        const raw = readFileSync(settingsPath, 'utf-8');
        const parsed = JSON.parse(raw);
        // Only copy known safe keys to prevent prototype pollution
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          for (const key of Object.keys(parsed)) {
            if (key !== '__proto__' && key !== 'constructor' && key !== 'prototype') {
              settings[key] = parsed[key];
            }
          }
        }
      }

      // Merge mcpServers entry
      if (!settings.mcpServers || typeof settings.mcpServers !== 'object') {
        settings.mcpServers = {};
      }
      settings.mcpServers.morphkit = {
        command: 'npx',
        args: ['-y', 'morphkit-cli@latest', 'mcp'],
      };

      // Create parent directories if needed
      mkdirSync(dirname(settingsPath), { recursive: true });

      // Write updated settings
      writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');

      console.log(chalk.green(`\nMorphkit MCP server registered in ${settingsPath}`));
      console.log(chalk.dim('Claude Code will now have access to Morphkit tools.'));
    } catch (error) {
      console.error(chalk.red(`\nError: ${error instanceof Error ? error.message : error}`));
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// complete — AI-powered TODO resolution
// ---------------------------------------------------------------------------

program
  .command('complete')
  .description('Auto-complete all MORPHKIT-TODOs in a generated iOS project using Claude API')
  .argument('<project-path>', 'Path to the generated iOS project')
  .option('--model <model>', 'Claude model to use', 'claude-sonnet-4-6')
  .option('--max-iterations <n>', 'Maximum completion iterations', '30')
  .option('--dry-run', 'Preview changes without writing files')
  .option('-v, --verbose', 'Show detailed completion output', false)
  .action(async (projectPath: string, options: { model: string; maxIterations: string; dryRun?: boolean; verbose?: boolean }) => {
    const resolvedPath = resolve(projectPath);

    if (!existsSync(resolvedPath)) {
      console.error(chalk.red(`Error: Directory not found: ${resolvedPath}`));
      process.exit(1);
    }

    if (!process.env.ANTHROPIC_API_KEY && !options.dryRun) {
      console.error(chalk.red('Error: ANTHROPIC_API_KEY environment variable is required'));
      console.error(chalk.dim('Set it with: export ANTHROPIC_API_KEY=sk-ant-...'));
      process.exit(1);
    }

    const { completeProject } = await import('./complete.js');
    const { getDetailedTodos } = await import('./verify.js');

    // Show initial state
    const initialTodos = getDetailedTodos(resolvedPath);
    console.log('');
    console.log(chalk.bold('Morphkit Complete'));
    console.log(chalk.dim('─'.repeat(40)));
    console.log(`  Project:        ${chalk.cyan(resolvedPath)}`);
    console.log(`  Model:          ${chalk.cyan(options.model)}`);
    console.log(`  TODOs found:    ${chalk.yellow(String(initialTodos.length))}`);
    console.log(`  Max iterations: ${options.maxIterations}`);
    if (options.dryRun) console.log(`  Mode:           ${chalk.yellow('DRY RUN')}`);
    console.log('');

    if (initialTodos.length === 0) {
      console.log(chalk.green('No TODOs found — project is already complete!'));
      return;
    }

    const spinner = ora('Completing TODOs...').start();

    try {
      const result = await completeProject(resolvedPath, {
        model: options.model,
        maxIterations: parseInt(options.maxIterations, 10),
        dryRun: options.dryRun,
        verbose: options.verbose,
      });

      spinner.stop();
      console.log('');
      console.log(chalk.bold('Completion Results'));
      console.log(chalk.dim('─'.repeat(40)));
      console.log(`  Iterations:     ${result.iterations}`);
      console.log(`  TODOs resolved: ${chalk.green(String(result.todosResolved))}`);
      console.log(`  TODOs remaining:${result.todosRemaining > 0 ? chalk.yellow(` ${result.todosRemaining}`) : chalk.green(' 0')}`);
      console.log(`  Files completed:${chalk.cyan(` ${result.filesCompleted.length}`)}`);
      console.log(`  Build status:   ${result.buildStatus === 'pass' ? chalk.green('pass') : result.buildStatus === 'fail' ? chalk.red('fail') : chalk.dim('skipped')}`);
      console.log('');

      if (result.filesCompleted.length > 0) {
        console.log(chalk.bold('  Completed files:'));
        for (const file of result.filesCompleted) {
          console.log(`    ${chalk.green('✓')} ${file}`);
        }
        console.log('');
      }

      if (result.success) {
        console.log(chalk.green('All TODOs resolved! Run `swift build` to verify.'));
      } else {
        console.log(chalk.yellow(`${result.todosRemaining} TODOs remaining. Run again or complete manually.`));
      }
    } catch (error) {
      spinner.stop();
      console.error(chalk.red(`\nCompletion failed: ${error instanceof Error ? error.message : error}`));
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// doctor — diagnose configuration issues
// ---------------------------------------------------------------------------

program
  .command('doctor')
  .description('Diagnose Morphkit configuration and environment')
  .action(async () => {
    console.log('');
    console.log(chalk.bold('Morphkit Doctor'));
    console.log(chalk.dim('─'.repeat(40)));

    const checks: Array<{ name: string; status: 'ok' | 'warn' | 'error'; message: string }> = [];

    // Check Bun
    try {
      const bunVersion = execSync('bun --version', { encoding: 'utf-8', stdio: 'pipe' }).trim();
      checks.push({ name: 'Bun runtime', status: 'ok', message: `v${bunVersion}` });
    } catch {
      checks.push({ name: 'Bun runtime', status: 'warn', message: 'Not found (npm/node fallback active)' });
    }

    // Check Swift
    try {
      const swiftVersion = execSync('swift --version', { encoding: 'utf-8', stdio: 'pipe' }).split('\n')[0].trim();
      checks.push({ name: 'Swift toolchain', status: 'ok', message: swiftVersion });
    } catch {
      checks.push({ name: 'Swift toolchain', status: 'warn', message: 'Not found — compilation validation will be skipped' });
    }

    // Check API key
    const apiKey = resolveApiKey();
    if (apiKey) {
      const auth = await validateApiKey(apiKey);
      if (auth.valid) {
        checks.push({ name: 'Morphkit API key', status: 'ok', message: `${auth.tier} tier${auth.remaining > 0 ? ` (${auth.remaining} remaining)` : ''}` });
      } else {
        checks.push({ name: 'Morphkit API key', status: 'error', message: auth.error ?? 'Invalid' });
      }
    } else {
      checks.push({ name: 'Morphkit API key', status: 'warn', message: 'Not set — running in offline mode' });
    }

    // Check AI providers
    if (process.env.ANTHROPIC_API_KEY) {
      checks.push({ name: 'Claude (Anthropic)', status: 'ok', message: 'API key set' });
    } else if (process.env.OPENAI_API_KEY) {
      checks.push({ name: 'OpenAI', status: 'ok', message: 'API key set' });
    } else if (process.env.XAI_API_KEY) {
      checks.push({ name: 'Grok (xAI)', status: 'ok', message: 'API key set' });
    } else {
      checks.push({ name: 'AI provider', status: 'warn', message: 'No API key set — using heuristic analysis only' });
    }

    // Check config file
    const configPath = join(homedir(), '.morphkit', 'config');
    if (existsSync(configPath)) {
      checks.push({ name: 'Config file', status: 'ok', message: configPath });
    } else {
      checks.push({ name: 'Config file', status: 'warn', message: 'Not found (~/.morphkit/config)' });
    }

    // Check MCP registration
    const mcpPath = join(process.cwd(), '.claude', 'settings.json');
    const globalMcpPath = join(homedir(), '.claude', 'settings.json');
    const hasMcp = [mcpPath, globalMcpPath].some(p => {
      try {
        return existsSync(p) && readFileSync(p, 'utf-8').includes('morphkit');
      } catch { return false; }
    });
    if (hasMcp) {
      checks.push({ name: 'MCP server', status: 'ok', message: 'Registered in Claude Code' });
    } else {
      checks.push({ name: 'MCP server', status: 'warn', message: 'Not registered — run `morphkit setup`' });
    }

    // Print results
    for (const check of checks) {
      const icon = check.status === 'ok' ? chalk.green('✓') : check.status === 'warn' ? chalk.yellow('⚠') : chalk.red('✗');
      const msg = check.status === 'ok' ? chalk.green(check.message) : check.status === 'warn' ? chalk.yellow(check.message) : chalk.red(check.message);
      console.log(`  ${icon} ${check.name.padEnd(20)} ${msg}`);
    }

    const hasErrors = checks.some(c => c.status === 'error');
    const hasWarns = checks.some(c => c.status === 'warn');
    console.log('');
    if (hasErrors) {
      console.log(chalk.red('Issues found that need attention.'));
    } else if (hasWarns) {
      console.log(chalk.yellow('Some optional features are not configured. Morphkit will still work.'));
    } else {
      console.log(chalk.green('All checks passed!'));
    }
    console.log('');
  });

function printModelSummary(model: SemanticAppModel): void {
  console.log('');
  console.log(chalk.bold('Semantic Model Summary'));
  console.log(chalk.dim('─'.repeat(40)));
  console.log(`  App:            ${chalk.cyan(model.appName)}`);
  console.log(`  Entities:       ${model.entities.length}`);
  console.log(`  Screens:        ${model.screens.length}`);
  console.log(`  API endpoints:  ${model.apiEndpoints.length}`);
  console.log(`  State patterns: ${model.stateManagement.length}`);
  console.log(`  Auth:           ${model.auth ? model.auth.type : 'none detected'}`);
  console.log(`  Navigation:     ${model.navigation.type}`);

  if (model.screens.length > 0) {
    console.log('');
    console.log(chalk.bold('  Screens:'));
    for (const screen of model.screens) {
      console.log(`    ${chalk.white(screen.name)} — ${chalk.dim(screen.purpose)}`);
    }
  }
}

program.parse();

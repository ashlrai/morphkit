#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { resolve, join } from 'path';
import { existsSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { analyzeRepo } from './analyzer/index.js';
import { buildSemanticModel } from './semantic/builder.js';
import { adaptForPlatform } from './semantic/adapter.js';
import { generateProject } from './generator/index.js';
import type { SemanticAppModel } from './semantic/model.js';

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
    // Network error — allow offline usage with a warning
    if (error instanceof TypeError || (error as any)?.code === 'ECONNREFUSED') {
      return { valid: true, tier: 'free', remaining: -1, error: 'Could not reach Morphkit API — running in offline mode' };
    }
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

const VERSION = '0.1.0';

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
  .hook('preAction', () => {
    // Set MORPHKIT_NO_AI env var when --no-ai flag is passed so the builder
    // uses heuristic analysis instead of calling the xAI API.
    const opts = program.opts();
    if (opts.ai === false) {
      process.env.MORPHKIT_NO_AI = '1';
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
        // Offline mode warning
        console.warn(chalk.yellow(`\n${auth.error}`));
      } else {
        console.log(chalk.dim(`  Authenticated (${auth.tier} tier${auth.remaining > 0 ? `, ${auth.remaining} conversions remaining` : ''})`));
      }
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
      console.log('');
      console.log(chalk.green(`Open in Xcode: open ${outputPath}/Package.swift`));
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

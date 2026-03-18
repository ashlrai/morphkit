#!/usr/bin/env bun
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { analyzeRepo } from './analyzer/index.js';
import { buildSemanticModel } from './semantic/builder.js';
import { adaptForPlatform } from './semantic/adapter.js';
import { generateProject } from './generator/index.js';
import type { SemanticAppModel } from './semantic/model.js';

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/** Validate that a path exists and is a directory. Throws with a clear message if not. */
function validateDirectoryExists(dirPath: string): void {
  if (!existsSync(dirPath)) {
    throw new Error(`Directory not found: ${dirPath}`);
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

const program = new Command();

program
  .name('morphkit')
  .description('Semantic AI agent that converts TypeScript/React web apps to native SwiftUI iOS apps')
  .version('0.1.0');

program
  .command('analyze')
  .description('Analyze a web app and output the semantic model')
  .argument('<path>', 'Path to the web app repository')
  .option('-o, --output <file>', 'Output file for the semantic model JSON')
  .option('-v, --verbose', 'Show detailed analysis output', false)
  .action(async (repoPath: string, options: { output?: string; verbose?: boolean }) => {
    const absolutePath = resolve(repoPath);

    // Validate directory exists before starting spinner
    validateDirectoryExists(absolutePath);

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

      spinner.succeed('Analysis complete!');

      // Output
      const json = JSON.stringify(model, null, 2);
      if (options.output) {
        await Bun.write(resolve(options.output), json);
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
  .description('Generate a SwiftUI Xcode project from a web app')
  .argument('<path>', 'Path to the web app repository')
  .option('-o, --output <dir>', 'Output directory for the iOS project', './ios-app')
  .option('-n, --name <name>', 'App name (defaults to package.json name)')
  .option('--model <file>', 'Use a pre-built semantic model JSON file instead of analyzing')
  .option('-v, --verbose', 'Show detailed generation output', false)
  .action(async (repoPath: string, options: { output: string; name?: string; model?: string; verbose?: boolean }) => {
    const absolutePath = resolve(repoPath);
    const outputPath = resolve(options.output);

    // Validate inputs before starting
    validateDirectoryExists(absolutePath);
    if (options.name) {
      validateAppName(options.name);
    }

    const spinner = ora('Starting generation pipeline...').start();

    try {
      let model: SemanticAppModel;

      if (options.model) {
        // Use pre-built model
        spinner.text = 'Loading semantic model...';
        const modelFile = await Bun.file(resolve(options.model)).text();
        model = JSON.parse(modelFile) as SemanticAppModel;
      } else {
        // Full pipeline: analyze → build model
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

      spinner.succeed('Generation complete!');

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
      console.log(chalk.green(`Open in Xcode: open ${outputPath}/Package.swift`));
    } catch (error) {
      spinner.fail('Generation failed');
      console.error(chalk.red(`\nError: ${error instanceof Error ? error.message : error}`));
      process.exit(1);
    }
  });

program
  .command('preview')
  .description('Preview what would be generated without writing files')
  .argument('<path>', 'Path to the web app repository')
  .option('-s, --screen <name>', 'Preview a specific screen')
  .action(async (repoPath: string, options: { screen?: string }) => {
    const absolutePath = resolve(repoPath);

    validateDirectoryExists(absolutePath);

    const spinner = ora('Analyzing for preview...').start();

    try {
      const analysisResult = await analyzeRepo(absolutePath);
      const model = await buildSemanticModel(analysisResult);
      const adapted = adaptForPlatform(model, 'ios');

      spinner.succeed('Analysis complete');

      // Generate to memory only (don't write files)
      const project = await generateProject(adapted, '/dev/null');

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

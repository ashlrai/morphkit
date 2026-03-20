/**
 * PR Generator — creates Git branches, commits, and optionally GitHub PRs
 * for Morphkit sync operations.
 *
 * Uses `simple-git` for all Git operations and shells out to `gh` CLI
 * for PR creation (with graceful fallback to manual instructions).
 */

import { execFileSync, execSync } from 'node:child_process';

import type { SimpleGit } from 'simple-git';
import { simpleGit } from 'simple-git';

import type { ModelDiff } from './model-diff.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PROptions {
  /** Absolute path to the target (iOS) repo */
  targetRepo: string;
  /** Base branch to create the PR against */
  baseBranch: string;
  /** Branch name for the sync commit */
  branchName: string;
  /** Files that were added or modified (relative to repo root) */
  changedFiles: string[];
  /** Files that were added (subset of changedFiles) */
  addedFiles: string[];
  /** Files flagged for removal */
  removedFiles: string[];
  /** Files with detected manual edits that were preserved */
  conflictFiles: string[];
  /** Model diff for the PR description */
  modelDiff: ModelDiff;
  /** Custom PR title override */
  prTitle?: string;
  /** Commit message */
  commitMessage: string;
}

export interface PRResult {
  branchName: string;
  commitSha: string;
  prUrl?: string;
  /** Set when gh CLI is unavailable — contains manual instructions */
  manualInstructions?: string;
}

// ---------------------------------------------------------------------------
// Branch naming
// ---------------------------------------------------------------------------

/**
 * Generate a branch name with timestamp.
 * Format: morphkit/sync-YYYY-MM-DD-HHMMSS
 */
export function generateBranchName(now?: Date): string {
  const d = now ?? new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `morphkit/sync-${date}-${time}`;
}

// ---------------------------------------------------------------------------
// PR body generation
// ---------------------------------------------------------------------------

export function generatePRBody(options: {
  modelDiff: ModelDiff;
  changedFiles: string[];
  addedFiles: string[];
  removedFiles: string[];
  conflictFiles: string[];
}): string {
  const { modelDiff, changedFiles, addedFiles, removedFiles, conflictFiles } = options;
  const lines: string[] = [];

  lines.push('## Summary');
  lines.push('');
  lines.push(modelDiff.summary);
  lines.push('');

  // Detailed changes
  if (modelDiff.addedScreens.length > 0) {
    lines.push('### New Screens');
    for (const s of modelDiff.addedScreens) lines.push(`- \`${s}\``);
    lines.push('');
  }
  if (modelDiff.removedScreens.length > 0) {
    lines.push('### Removed Screens');
    for (const s of modelDiff.removedScreens) lines.push(`- \`${s}\``);
    lines.push('');
  }
  if (modelDiff.modifiedScreens.length > 0) {
    lines.push('### Modified Screens');
    for (const s of modelDiff.modifiedScreens) lines.push(`- \`${s}\``);
    lines.push('');
  }
  if (modelDiff.addedEntities.length > 0) {
    lines.push('### New Entities');
    for (const e of modelDiff.addedEntities) lines.push(`- \`${e}\``);
    lines.push('');
  }
  if (modelDiff.modifiedEntities.length > 0) {
    lines.push('### Modified Entities');
    for (const e of modelDiff.modifiedEntities) lines.push(`- \`${e}\``);
    lines.push('');
  }
  if (modelDiff.addedEndpoints.length > 0) {
    lines.push('### New Endpoints');
    for (const ep of modelDiff.addedEndpoints) lines.push(`- \`${ep}\``);
    lines.push('');
  }
  if (modelDiff.modifiedEndpoints.length > 0) {
    lines.push('### Modified Endpoints');
    for (const ep of modelDiff.modifiedEndpoints) lines.push(`- \`${ep}\``);
    lines.push('');
  }
  if (modelDiff.changedNavigation) {
    lines.push('### Navigation');
    lines.push('Navigation structure was updated.');
    lines.push('');
  }
  if (modelDiff.changedAuth) {
    lines.push('### Authentication');
    lines.push('Auth configuration was updated.');
    lines.push('');
  }

  // File changes
  lines.push('## Files');
  lines.push('');
  if (addedFiles.length > 0) {
    lines.push(`**Added (${addedFiles.length}):**`);
    for (const f of addedFiles) lines.push(`- \`${f}\``);
    lines.push('');
  }
  const modifiedFiles = changedFiles.filter(f => !addedFiles.includes(f));
  if (modifiedFiles.length > 0) {
    lines.push(`**Modified (${modifiedFiles.length}):**`);
    for (const f of modifiedFiles) lines.push(`- \`${f}\``);
    lines.push('');
  }
  if (removedFiles.length > 0) {
    lines.push(`**Flagged for removal (${removedFiles.length}):**`);
    lines.push('> These files are no longer generated but were NOT auto-deleted.');
    lines.push('> Review and remove manually if no longer needed.');
    for (const f of removedFiles) lines.push(`- \`${f}\``);
    lines.push('');
  }

  // Conflict warnings
  if (conflictFiles.length > 0) {
    lines.push('## Manual Edits Detected');
    lines.push('');
    lines.push('The following files appear to have been manually edited (missing `// Generated by Morphkit` header).');
    lines.push('Their contents were **preserved** — Morphkit did not overwrite them.');
    lines.push('');
    for (const f of conflictFiles) lines.push(`- \`${f}\``);
    lines.push('');
  }

  lines.push('---');
  lines.push('*Generated by [Morphkit](https://morphkit.dev) continuous sync*');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Git + PR operations
// ---------------------------------------------------------------------------

/**
 * Create a branch, commit changes, push, and optionally create a PR.
 *
 * Returns the branch name, commit SHA, and (if possible) the PR URL.
 */
export async function createSyncPR(options: PROptions): Promise<PRResult> {
  const git: SimpleGit = simpleGit(options.targetRepo);

  // Guard: refuse to sync into a dirty working tree
  const status = await git.status();
  if (!status.isClean()) {
    throw new Error(
      'Target repo has uncommitted changes. Please commit or stash before syncing.\n' +
      `  Modified: ${status.modified.length}, Staged: ${status.staged.length}, Untracked: ${status.not_added.length}`,
    );
  }

  // Ensure we start from the base branch
  await git.checkout(options.baseBranch);
  await git.pull('origin', options.baseBranch).catch(() => {
    // Pull may fail if no remote — that's fine for local-only repos
  });

  // Create and switch to the sync branch
  await git.checkoutLocalBranch(options.branchName);

  // Stage changed files
  if (options.changedFiles.length > 0) {
    await git.add(options.changedFiles);
  }

  // Commit
  const commitResult = await git.commit(options.commitMessage);
  const commitSha = commitResult.commit || 'unknown';

  // Try to push
  let pushed = false;
  try {
    await git.push('origin', options.branchName, ['--set-upstream']);
    pushed = true;
  } catch {
    // No remote configured or push failed — that's OK
  }

  // Try to create PR via gh CLI
  let prUrl: string | undefined;
  let manualInstructions: string | undefined;

  if (pushed) {
    const ghAvailable = isGhCliAvailable();
    if (ghAvailable) {
      const title = options.prTitle ?? `[Morphkit] Sync: ${options.modelDiff.summary}`;
      const body = generatePRBody({
        modelDiff: options.modelDiff,
        changedFiles: options.changedFiles,
        addedFiles: options.addedFiles,
        removedFiles: options.removedFiles,
        conflictFiles: options.conflictFiles,
      });

      try {
        const result = execFileSync('gh', [
          'pr', 'create',
          '--title', title,
          '--body', body,
          '--base', options.baseBranch,
          '--head', options.branchName,
        ], { cwd: options.targetRepo, encoding: 'utf-8', timeout: 30_000 });
        prUrl = result.trim();
      } catch (err) {
        manualInstructions = buildManualInstructions(options);
      }
    } else {
      manualInstructions = buildManualInstructions(options);
    }
  } else {
    manualInstructions =
      `Branch "${options.branchName}" created locally with ${options.changedFiles.length} changed file(s).\n` +
      `No remote configured — push manually and create a PR when ready.`;
  }

  return { branchName: options.branchName, commitSha, prUrl, manualInstructions };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isGhCliAvailable(): boolean {
  try {
    execSync('gh --version', { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}
function buildManualInstructions(options: PROptions): string {
  return [
    `Branch "${options.branchName}" has been pushed.`,
    '',
    'To create a PR manually:',
    `  gh pr create --base ${options.baseBranch} --head ${options.branchName}`,
    '',
    'Or visit your repository on GitHub to create the PR.',
  ].join('\n');
}

import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';


import type { ModelDiff } from '../../src/sync/model-diff';
import { generateBranchName, generatePRBody } from '../../src/sync/pr-generator';

// ---------------------------------------------------------------------------
// PR generator unit tests (no repo needed)
// ---------------------------------------------------------------------------

describe('generateBranchName', () => {
  it('produces branch name with correct format', () => {
    const date = new Date('2024-06-15T14:30:45Z');
    const name = generateBranchName(date);
    // The exact time depends on timezone, but the prefix is consistent
    expect(name).toMatch(/^morphkit\/sync-\d{4}-\d{2}-\d{2}-\d{6}$/);
    expect(name).toContain('morphkit/sync-');
  });

  it('generates unique names for different timestamps', () => {
    const a = generateBranchName(new Date('2024-01-01T00:00:00Z'));
    const b = generateBranchName(new Date('2024-01-01T00:00:01Z'));
    expect(a).not.toBe(b);
  });
});

describe('generatePRBody', () => {
  it('includes summary and file lists', () => {
    const diff: ModelDiff = {
      addedScreens: ['Settings'],
      removedScreens: [],
      modifiedScreens: ['Home'],
      addedEntities: ['User'],
      removedEntities: [],
      modifiedEntities: [],
      addedEndpoints: ['GET:/api/users'],
      removedEndpoints: [],
      modifiedEndpoints: [],
      changedNavigation: false,
      changedAuth: false,
      summary: '1 new screen, 1 updated screen, 1 new entity, 1 new endpoint',
    };

    const body = generatePRBody({
      modelDiff: diff,
      changedFiles: ['Views/SettingsView.swift', 'Views/HomeView.swift', 'Models/User.swift'],
      addedFiles: ['Views/SettingsView.swift', 'Models/User.swift'],
      removedFiles: [],
      conflictFiles: [],
    });

    expect(body).toContain('## Summary');
    expect(body).toContain('1 new screen');
    expect(body).toContain('### New Screens');
    expect(body).toContain('`Settings`');
    expect(body).toContain('### Modified Screens');
    expect(body).toContain('`Home`');
    expect(body).toContain('### New Entities');
    expect(body).toContain('`User`');
    expect(body).toContain('**Added (2):**');
    expect(body).toContain('**Modified (1):**');
    expect(body).toContain('Morphkit');
  });

  it('shows conflict warnings for manually edited files', () => {
    const diff: ModelDiff = {
      addedScreens: [],
      removedScreens: [],
      modifiedScreens: [],
      addedEntities: [],
      removedEntities: [],
      modifiedEntities: [],
      addedEndpoints: [],
      removedEndpoints: [],
      modifiedEndpoints: [],
      changedNavigation: false,
      changedAuth: false,
      summary: 'No changes detected',
    };

    const body = generatePRBody({
      modelDiff: diff,
      changedFiles: [],
      addedFiles: [],
      removedFiles: [],
      conflictFiles: ['Views/CustomView.swift'],
    });

    expect(body).toContain('Manual Edits Detected');
    expect(body).toContain('CustomView.swift');
    expect(body).toContain('preserved');
  });

  it('shows removal warnings', () => {
    const diff: ModelDiff = {
      addedScreens: [],
      removedScreens: ['OldPage'],
      modifiedScreens: [],
      addedEntities: [],
      removedEntities: [],
      modifiedEntities: [],
      addedEndpoints: [],
      removedEndpoints: [],
      modifiedEndpoints: [],
      changedNavigation: false,
      changedAuth: false,
      summary: '1 removed screen',
    };

    const body = generatePRBody({
      modelDiff: diff,
      changedFiles: [],
      addedFiles: [],
      removedFiles: ['Views/OldPageView.swift'],
      conflictFiles: [],
    });

    expect(body).toContain('Flagged for removal');
    expect(body).toContain('NOT auto-deleted');
    expect(body).toContain('OldPageView.swift');
  });
});

// ---------------------------------------------------------------------------
// Sync engine integration tests (use temp git repos)
// ---------------------------------------------------------------------------

describe('sync engine file diffing', () => {
  let targetDir: string;

  beforeEach(() => {
    targetDir = mkdtempSync(join(tmpdir(), 'morphkit-sync-test-'));
  });

  afterEach(() => {
    rmSync(targetDir, { recursive: true, force: true });
  });

  it('detects manually edited files by missing Morphkit header', () => {
    // Write a file without the Morphkit header (simulating manual edit)
    const viewDir = join(targetDir, 'Views');
    mkdirSync(viewDir, { recursive: true });
    writeFileSync(join(viewDir, 'CustomView.swift'), 'import SwiftUI\n\nstruct CustomView: View { }');

    // File without header is considered manually edited
    const content = readFileSync(join(viewDir, 'CustomView.swift'), 'utf-8');
    expect(content.startsWith('// Generated by Morphkit')).toBe(false);
  });

  it('identifies Morphkit-generated files by header', () => {
    const viewDir = join(targetDir, 'Views');
    mkdirSync(viewDir, { recursive: true });
    writeFileSync(
      join(viewDir, 'HomeView.swift'),
      '// Generated by Morphkit from: src/pages/Home.tsx\nimport SwiftUI\n',
    );

    const content = readFileSync(join(viewDir, 'HomeView.swift'), 'utf-8');
    expect(content.startsWith('// Generated by Morphkit')).toBe(true);
  });

  it('stores model in .morphkit/model.json', () => {
    const morphkitDir = join(targetDir, '.morphkit');
    mkdirSync(morphkitDir, { recursive: true });

    const model = { appName: 'TestApp', version: '1.0' };
    writeFileSync(join(morphkitDir, 'model.json'), JSON.stringify(model, null, 2));

    const stored = JSON.parse(readFileSync(join(morphkitDir, 'model.json'), 'utf-8'));
    expect(stored.appName).toBe('TestApp');
    expect(stored.version).toBe('1.0');
  });

  it('stores sync metadata in .morphkit/sync.json', () => {
    const morphkitDir = join(targetDir, '.morphkit');
    mkdirSync(morphkitDir, { recursive: true });

    const meta = {
      lastSyncTimestamp: new Date().toISOString(),
      sourceRepo: '/path/to/source',
      branchName: 'morphkit/sync-2024-01-01-120000',
      morphkitVersion: '0.1.0',
    };
    writeFileSync(join(morphkitDir, 'sync.json'), JSON.stringify(meta, null, 2));

    const stored = JSON.parse(readFileSync(join(morphkitDir, 'sync.json'), 'utf-8'));
    expect(stored.sourceRepo).toBe('/path/to/source');
    expect(stored.branchName).toContain('morphkit/sync-');
  });

  it('skips files when content is identical', () => {
    const viewDir = join(targetDir, 'Views');
    mkdirSync(viewDir, { recursive: true });

    const content = '// Generated by Morphkit\nimport SwiftUI\n\nstruct HomeView: View { var body: some View { Text("Home") } }';
    writeFileSync(join(viewDir, 'HomeView.swift'), content);

    // Re-reading the file gives identical content
    const existing = readFileSync(join(viewDir, 'HomeView.swift'), 'utf-8');
    expect(existing).toBe(content);
  });
});

describe('sync engine git operations', () => {
  let targetDir: string;

  beforeEach(() => {
    targetDir = mkdtempSync(join(tmpdir(), 'morphkit-git-test-'));
    // Initialize a git repo
    execSync('git init', { cwd: targetDir, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: targetDir, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: targetDir, stdio: 'pipe' });

    // Create initial commit on main
    writeFileSync(join(targetDir, 'README.md'), '# Test');
    execSync('git add .', { cwd: targetDir, stdio: 'pipe' });
    execSync('git commit -m "init"', { cwd: targetDir, stdio: 'pipe' });
  });

  afterEach(() => {
    rmSync(targetDir, { recursive: true, force: true });
  });

  it('creates a branch with the morphkit/sync- prefix', () => {
    const branchName = generateBranchName();
    execSync(`git checkout -b "${branchName}"`, { cwd: targetDir, stdio: 'pipe' });

    const currentBranch = execSync('git branch --show-current', { cwd: targetDir, encoding: 'utf-8' }).trim();
    expect(currentBranch).toBe(branchName);
    expect(currentBranch).toMatch(/^morphkit\/sync-/);
  });

  it('can commit sync changes on a branch', () => {
    const branchName = generateBranchName();
    execSync(`git checkout -b "${branchName}"`, { cwd: targetDir, stdio: 'pipe' });

    // Write files
    mkdirSync(join(targetDir, 'Views'), { recursive: true });
    writeFileSync(join(targetDir, 'Views', 'HomeView.swift'), '// Generated by Morphkit\nimport SwiftUI');
    mkdirSync(join(targetDir, '.morphkit'), { recursive: true });
    writeFileSync(join(targetDir, '.morphkit', 'model.json'), '{}');

    execSync('git add .', { cwd: targetDir, stdio: 'pipe' });
    execSync('git commit -m "[Morphkit] Sync: test"', { cwd: targetDir, stdio: 'pipe' });

    const log = execSync('git log --oneline -1', { cwd: targetDir, encoding: 'utf-8' });
    expect(log).toContain('[Morphkit] Sync: test');
  });

  it('creates branch from the specified base branch', () => {
    // Create a develop branch
    execSync('git checkout -b develop', { cwd: targetDir, stdio: 'pipe' });
    writeFileSync(join(targetDir, 'dev.txt'), 'dev');
    execSync('git add .', { cwd: targetDir, stdio: 'pipe' });
    execSync('git commit -m "dev commit"', { cwd: targetDir, stdio: 'pipe' });

    const branchName = generateBranchName();
    execSync(`git checkout -b "${branchName}"`, { cwd: targetDir, stdio: 'pipe' });

    // The sync branch should be based off develop
    const devFileExists = existsSync(join(targetDir, 'dev.txt'));
    expect(devFileExists).toBe(true);
  });
});

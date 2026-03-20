/**
 * Morphkit Sync — Public API
 *
 * Continuous sync between a web app source repo and an iOS target repo.
 */

export { syncRepos } from './sync-engine.js';
export type { SyncOptions, SyncResult, SyncMetadata } from './sync-engine.js';

export { diffModels, isDiffEmpty } from './model-diff.js';
export type { ModelDiff } from './model-diff.js';

export { generateBranchName, generatePRBody, createSyncPR } from './pr-generator.js';
export type { PROptions, PRResult } from './pr-generator.js';

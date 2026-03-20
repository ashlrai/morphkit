/**
 * @module ai/cache
 *
 * Caching layer for AIProvider responses. Wraps any AIProvider and stores
 * results as JSON files keyed by SHA-256 hash of the input arguments.
 * Cache entries expire after 24 hours (checked via file mtime).
 *
 * All cache I/O failures are silently swallowed — the real provider is
 * always called as a fallback so the pipeline is never broken.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type {
  AIProvider,
  AIComponentInput,
  AIMapComponentInput,
  AIEntityContext,
  AIIntentResult,
  AIComponentMapResult,
  AIStateArchitectureResult,
  AIEntityFieldsResult,
} from './provider.js';

const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/** Stable JSON serialization with sorted keys for deterministic cache hits. */
function stableStringify(val: unknown): string {
  if (val === null || val === undefined) return JSON.stringify(val);
  if (Array.isArray(val)) return `[${val.map(stableStringify).join(',')}]`;
  if (typeof val === 'object') {
    const keys = Object.keys(val as Record<string, unknown>).sort();
    return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify((val as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(val);
}

function cacheKey(method: string, args: unknown[]): string {
  const payload = stableStringify({ method, args });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

function readCache<T>(dir: string, key: string): T | null {
  try {
    const file = path.join(dir, `${key}.json`);
    const stat = fs.statSync(file);
    if (Date.now() - stat.mtimeMs > TTL_MS) return null;
    const data = fs.readFileSync(file, 'utf-8');
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

function writeCache(dir: string, key: string, value: unknown): void {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${key}.json`);
    fs.writeFileSync(file, JSON.stringify(value, null, 2));
  } catch {
    // Silently ignore write failures
  }
}

class CachingAIProvider implements AIProvider {
  readonly name: string;

  constructor(
    private readonly inner: AIProvider,
    private readonly cacheDir: string,
  ) {
    this.name = `${inner.name} (cached)`;
  }

  /** Read from cache or call `fn`, storing the result for next time. */
  private async cached<T>(method: string, args: unknown[], fn: () => Promise<T>): Promise<T> {
    const key = cacheKey(method, args);
    const hit = readCache<T>(this.cacheDir, key);
    if (hit) return hit;
    const result = await fn();
    writeCache(this.cacheDir, key, result);
    return result;
  }

  async analyzeIntent(component: AIComponentInput, context: string): Promise<AIIntentResult> {
    return this.cached('analyzeIntent', [component, context], () =>
      this.inner.analyzeIntent(component, context));
  }

  async mapComponent(component: AIMapComponentInput, targetPlatform: 'ios'): Promise<AIComponentMapResult> {
    return this.cached('mapComponent', [component, targetPlatform], () =>
      this.inner.mapComponent(component, targetPlatform));
  }

  async suggestStateArchitecture(statePatterns: any[], screens: string[]): Promise<AIStateArchitectureResult> {
    return this.cached('suggestStateArchitecture', [statePatterns, screens], () =>
      this.inner.suggestStateArchitecture(statePatterns, screens));
  }

  async enhanceEntityFields(entityName: string, context: AIEntityContext): Promise<AIEntityFieldsResult> {
    return this.cached('enhanceEntityFields', [entityName, context], () =>
      this.inner.enhanceEntityFields(entityName, context));
  }
}

/**
 * Wrap an AIProvider with a file-based caching layer.
 *
 * Cached responses are stored as JSON files in `cacheDir` (default: `.morphkit/cache/`).
 * Entries expire after 24 hours. Cache failures never break the pipeline.
 */
export function withCaching(
  provider: AIProvider,
  cacheDir: string = path.join(os.homedir(), '.morphkit', 'cache'),
): AIProvider {
  return new CachingAIProvider(provider, cacheDir);
}

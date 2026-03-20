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

function cacheKey(method: string, args: unknown[]): string {
  const payload = JSON.stringify({ method, args });
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

  async analyzeIntent(component: AIComponentInput, context: string): Promise<AIIntentResult> {
    const key = cacheKey('analyzeIntent', [component, context]);
    const cached = readCache<AIIntentResult>(this.cacheDir, key);
    if (cached) return cached;
    const result = await this.inner.analyzeIntent(component, context);
    writeCache(this.cacheDir, key, result);
    return result;
  }

  async mapComponent(component: AIMapComponentInput, targetPlatform: 'ios'): Promise<AIComponentMapResult> {
    const key = cacheKey('mapComponent', [component, targetPlatform]);
    const cached = readCache<AIComponentMapResult>(this.cacheDir, key);
    if (cached) return cached;
    const result = await this.inner.mapComponent(component, targetPlatform);
    writeCache(this.cacheDir, key, result);
    return result;
  }

  async suggestStateArchitecture(statePatterns: any[], screens: string[]): Promise<AIStateArchitectureResult> {
    const key = cacheKey('suggestStateArchitecture', [statePatterns, screens]);
    const cached = readCache<AIStateArchitectureResult>(this.cacheDir, key);
    if (cached) return cached;
    const result = await this.inner.suggestStateArchitecture(statePatterns, screens);
    writeCache(this.cacheDir, key, result);
    return result;
  }

  async enhanceEntityFields(entityName: string, context: AIEntityContext): Promise<AIEntityFieldsResult> {
    const key = cacheKey('enhanceEntityFields', [entityName, context]);
    const cached = readCache<AIEntityFieldsResult>(this.cacheDir, key);
    if (cached) return cached;
    const result = await this.inner.enhanceEntityFields(entityName, context);
    writeCache(this.cacheDir, key, result);
    return result;
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
  cacheDir: string = path.join('.morphkit', 'cache'),
): AIProvider {
  return new CachingAIProvider(provider, cacheDir);
}

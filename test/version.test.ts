import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(import.meta.dir, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  version: string;
  bin: Record<string, string>;
  scripts: Record<string, string>;
};

describe('release metadata', () => {
  it('CLI --version matches package.json', () => {
    const src = readFileSync(join(root, 'src/index.ts'), 'utf8');
    expect(src).toContain(`const VERSION = '${pkg.version}';`);
  });

  it('MCP server reports the package version', () => {
    const src = readFileSync(join(root, 'src/mcp/server.ts'), 'utf8');
    expect(src).toMatch(new RegExp(`name: 'morphkit',\\s*version: '${pkg.version.replace(/\./g, '\\.')}'`));
  });

  it('build and prepublishOnly produce every bin entry', () => {
    for (const target of new Set(Object.values(pkg.bin))) {
      const entry = target.replace(/^\.\/?/, '').replace(/^dist\//, 'src/').replace(/\.js$/, '.ts');
      expect(pkg.scripts.build).toContain(entry);
      expect(pkg.scripts.prepublishOnly).toContain(entry);
    }
  });
});

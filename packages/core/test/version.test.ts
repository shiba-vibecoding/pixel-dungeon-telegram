import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RULES_HASH, RULES_VERSION } from '../src/version';

/** Files whose changes do not change how the world plays: the version itself and Pixel-Mart's offers. */
const NOT_RULES = new Set(['version.ts', 'shop.ts']);

function rulesHash(): string {
  const root = fileURLToPath(new URL('../src', import.meta.url));
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith('.ts') && !NOT_RULES.has(name)) files.push(path);
    }
  };
  walk(root);
  const hash = createHash('sha256');
  for (const path of files.sort()) {
    hash.update(relative(root, path).replace(/\\/g, '/'));
    hash.update(readFileSync(path, 'utf8').replace(/\r\n/g, '\n'));
  }
  return hash.digest('hex').slice(0, 16);
}

describe('rules version', () => {
  it('is the Shattered update at 18 or later (the pioneer cup keys on rules below 18)', () => {
    expect(RULES_VERSION).toBeGreaterThanOrEqual(18);
  });

  it('goes up whenever the rules change', () => {
    const now = rulesHash();
    expect(
      now,
      `The rules have changed: raise RULES_VERSION (now ${RULES_VERSION}) and set RULES_HASH to '${now}' in packages/core/src/version.ts`,
    ).toBe(RULES_HASH);
  });
});

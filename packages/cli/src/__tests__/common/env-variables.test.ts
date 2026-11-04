import { describe, expect, test } from 'bun:test';
import { Glob } from 'bun';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EnvVariables } from '../../common/env-variables.ts';

const PACKAGE = join(import.meta.dir, '../../..');
/** A variable read from the environment: `env.NAME`, `env['NAME']`, or a whole string `'NAME'`. */
const READ =
  /\benv(?:\.|\[')((?:VULCAN|CLAUDE)_[A-Z_]+|CLAUDECODE)\b|['"`]((?:VULCAN|CLAUDE)_[A-Z_]+|CLAUDECODE)['"`]/g;

const sources = (): string[] =>
  ['src/**/*.ts', 'base/hooks/*.ts', 'base/extensions/*.ts'].flatMap((pattern) =>
    [...new Glob(pattern).scanSync({ cwd: PACKAGE })].filter((file) => !file.includes('__tests__')),
  );

describe('EnvVariables names every VULCAN_ and CLAUDE_ variable the cli reads', () => {
  test('the source reads no variable that the class does not name', () => {
    const named = new Set<string>(Object.values(EnvVariables));
    const unnamed: string[] = [];
    let reads = 0;

    for (const file of sources()) {
      for (const match of readFileSync(join(PACKAGE, file), 'utf8').matchAll(READ)) {
        const name = match[1] ?? match[2];

        reads += 1;

        if (!named.has(name)) {
          unnamed.push(`${file}: ${name}`);
        }
      }
    }

    expect(reads).toBeGreaterThan(20);
    expect(unnamed).toEqual([]);
  });

  test('each name has a comment directly above it, and its value is its own name', () => {
    const lines = readFileSync(join(PACKAGE, 'src/common/env-variables.ts'), 'utf8').split('\n');
    const members = lines.flatMap((line, index) =>
      line.startsWith('  static readonly ') ? [index] : [],
    );

    expect(members).toHaveLength(Object.keys(EnvVariables).length);
    expect(members.filter((index) => !lines[index - 1].trim().endsWith('*/'))).toEqual([]);

    for (const [member, value] of Object.entries(EnvVariables)) {
      expect(value).toBe(member);
    }
  });
});

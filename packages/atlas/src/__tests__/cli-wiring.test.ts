import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// __dirname, not import.meta: this package emits CommonJS.
const SOURCE = readFileSync(join(__dirname, '..', 'cli.ts'), 'utf8');

/** The body of one subcommand's branch in the entry file, up to the next `}` at its indent. */
const branchOf = (opts: { start: string }): string => {
  const from = SOURCE.indexOf(opts.start);

  expect(from).toBeGreaterThan(-1);

  return SOURCE.slice(from, from + 600);
};

describe('the command line never plans from an older index', () => {
  test('`migrate` and `tools` read the server fresh and wait for the fresh builds', () => {
    for (const start of ['if (subcommand === AtlasCommands.MIGRATE)', 'const listTools = async']) {
      const body = branchOf({ start });

      expect(body).toContain('readServer({ isFresh: true })');
      expect(body).toContain('await boot.fresh');
      expect(body).not.toContain('await boot.settled');
    }
  });

  test('only the server that serves a client may answer from an older index', () => {
    expect(SOURCE).toContain('isStaleAllowed: opts.isFresh !== true');
    expect(SOURCE.match(/readServer\(/g)?.length).toBe(3);
    expect(SOURCE.match(/readServer\(\{ isFresh: true \}\)/g)?.length).toBe(2);
  });
});

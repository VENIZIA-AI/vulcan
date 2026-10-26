import { describe, expect, test } from 'bun:test';
import { VULCAN_CONFIG_SCHEMA } from '../../config/index.ts';

const parseScripts = (opts: { scripts: unknown }) =>
  VULCAN_CONFIG_SCHEMA.safeParse({ guard: { writes: { trustedScripts: opts.scripts } } });

const messageOf = (opts: { value: string }): string => {
  const result = parseScripts({ scripts: [opts.value] });

  return result.success ? '' : result.error.issues.map((issue) => issue.message).join('\n');
};

describe('guard.writes.trustedScripts', () => {
  test('defaults to an empty list, with or without a guard section', () => {
    expect(VULCAN_CONFIG_SCHEMA.parse({}).guard.writes.trustedScripts).toEqual([]);
    expect(VULCAN_CONFIG_SCHEMA.parse({ guard: {} }).guard.writes.trustedScripts).toEqual([]);
    expect(
      VULCAN_CONFIG_SCHEMA.parse({ guard: { writes: {} } }).guard.writes.trustedScripts,
    ).toEqual([]);
  });

  test('keeps toolOwnedPaths next to it', () => {
    const config = VULCAN_CONFIG_SCHEMA.parse({ guard: { toolOwnedPaths: ['/x'] } });

    expect(config.guard.toolOwnedPaths).toEqual(['/x']);
  });

  test('accepts repo-relative .ts paths', () => {
    const scripts = ['cli.ts', 'tools/cli.ts', './tools/cli.ts', 'my tools/the cli.ts'];
    const result = parseScripts({ scripts });

    expect(result.success).toBe(true);
    expect(result.data?.guard.writes.trustedScripts).toEqual(scripts);
  });

  const REJECTED: { name: string; value: string; reason: string }[] = [
    { name: 'a star glob', value: 'tools/*.ts', reason: 'no globs' },
    { name: 'a question mark', value: 'tools/?.ts', reason: 'no globs' },
    { name: 'a character class', value: 'tools/[a].ts', reason: 'no globs' },
    { name: 'braces', value: 'tools/{a,b}.ts', reason: 'no globs' },
    { name: 'an absolute path', value: '/etc/cli.ts', reason: 'relative to the repo root' },
    { name: 'a home path', value: '~/cli.ts', reason: 'relative to the repo root' },
    { name: 'a parent segment', value: '../cli.ts', reason: 'without ..' },
    { name: 'a parent segment inside', value: 'tools/../../cli.ts', reason: 'without ..' },
    { name: 'a windows parent segment', value: 'tools\\..\\cli.ts', reason: 'without ..' },
    { name: 'a non-ts file', value: 'tools/cli.js', reason: 'a .ts file' },
    { name: 'a ts-looking suffix', value: 'tools/cli.ts.bak', reason: 'a .ts file' },
    { name: 'a folder', value: 'tools', reason: 'a .ts file' },
  ];

  for (const testCase of REJECTED) {
    test(`rejects ${testCase.name}, naming the value`, () => {
      const message = messageOf({ value: testCase.value });

      expect(message).toContain(testCase.value);
      expect(message).toContain(testCase.reason);
    });
  }

  test('one bad entry fails the whole list', () => {
    expect(parseScripts({ scripts: ['cli.ts', 'tools/*.ts'] }).success).toBe(false);
  });

  test('an unknown key under guard.writes is rejected', () => {
    const result = VULCAN_CONFIG_SCHEMA.safeParse({
      guard: { writes: { trustedScript: ['cli.ts'] } },
    });

    expect(result.success).toBe(false);
  });

  test('an unknown key under guard is rejected', () => {
    expect(VULCAN_CONFIG_SCHEMA.safeParse({ guard: { trusted: [] } }).success).toBe(false);
  });
});

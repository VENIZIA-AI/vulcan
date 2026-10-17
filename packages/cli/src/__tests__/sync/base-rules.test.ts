import { afterAll, describe, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildBaseRuleHashes, ManifestConstants } from '../../manifest/index.ts';
import { diffBaseRules } from '../../sync/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';

afterAll(removeProjects);

const PROJECT = {
  '.configs/vulcan.config.ts': "export default { rules: { 'V-W-01': 'read-only' } };\n",
  'AGENTS.md': '# x\n',
};
const DIFF_LINE = /^ {2}(?:added|changed|removed) +V-/m;

const runSync = (opts: { root: string; args?: string[] }) =>
  runCli({ args: ['sync', ...(opts.args ?? [])], cwd: opts.root });

const readBaseHashes = (opts: { root: string }): Record<string, string> =>
  JSON.parse(readFileSync(join(opts.root, ManifestConstants.FILE), 'utf8')).rules.base;

/** A project synced against an older base: V-C-02 is new, V-W-02 reworded, V-W-05 since retired. */
const createUpgradedProject = (): string => {
  const root = createProject({ files: PROJECT });

  runSync({ root });

  const file = join(root, ManifestConstants.FILE);
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  const base = Object.entries(manifest.rules.base).filter(([id]) => id !== 'V-C-02');

  manifest.rules.base = {
    ...Object.fromEntries(base),
    'V-W-02': '00000000',
    'V-W-05': 'ffffffff',
  };
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);

  return root;
};

describe('the base diff', () => {
  test('a first sync, with no manifest yet, prints no diff', () => {
    const root = createProject({ files: PROJECT });

    expect(diffBaseRules({ root })).toEqual([]);
    expect(runSync({ root }).stderr).not.toMatch(DIFF_LINE);
  });

  test('sync prints each added, changed and removed base rule with its new text, then rewrites the hashes', () => {
    const root = createUpgradedProject();
    const result = runSync({ root });

    expect(result.code).toBe(0);
    expect(result.stderr).toContain(
      '  added     V-C-02 **One options object first, at most 5 parameters.**',
    );
    expect(result.stderr).toContain('  changed   V-W-02 Never write to a database.');
    expect(result.stderr).toContain('  removed   V-W-05 (retired)');
    expect(result.stderr.match(new RegExp(DIFF_LINE.source, 'gm'))).toHaveLength(3);
    expect(readBaseHashes({ root })).toEqual(buildBaseRuleHashes());
  });

  test('a second sync prints no diff', () => {
    const root = createUpgradedProject();

    runSync({ root });
    expect(runSync({ root }).stderr).not.toMatch(DIFF_LINE);
  });

  test('--dry-run prints the diff and writes nothing', () => {
    const root = createUpgradedProject();
    const before = readFileSync(join(root, ManifestConstants.FILE), 'utf8');

    expect(runSync({ root, args: ['--dry-run'] }).stderr).toContain('  changed   V-W-02');
    expect(readFileSync(join(root, ManifestConstants.FILE), 'utf8')).toBe(before);
  });
});

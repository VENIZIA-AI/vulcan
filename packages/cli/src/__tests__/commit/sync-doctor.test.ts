import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DoctorChecks, DoctorRunner } from '../../doctor/index.ts';
import { git } from '../git-repo.helper.ts';
import { hermeticEnv } from '../hermetic.helper.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';

afterAll(removeProjects);

const CONFIG = (opts: { commit?: string }) =>
  `export default {${opts.commit === undefined ? '' : ` commit: ${opts.commit},`} };\n`;

const DENY = "{ message: { agent: { signature: 'deny' } } }";

const repo = (opts: { commit?: string }): string => {
  const root = createProject({
    files: { '.configs/vulcan.config.mts': CONFIG(opts), 'AGENTS.md': '# x\n' },
  });

  git({ cwd: root, args: ['init', '--quiet'] });

  return root;
};

const sync = (opts: { root: string; extra?: string[] }) =>
  runCli({
    args: ['sync', '--agents', 'claude', ...(opts.extra ?? [])],
    cwd: opts.root,
    env: hermeticEnv(),
  });

const hook = (opts: { root: string }): string => join(opts.root, '.git/hooks/commit-msg');

describe('vulcan sync and the commit-msg hook', () => {
  test('a project that denies agent signatures gets the hook and the manifest block', () => {
    const root = repo({ commit: DENY });
    const result = sync({ root });

    expect(result.code, result.stderr).toBe(0);
    expect(result.stderr).toMatch(/created\s+\.git\/hooks\/commit-msg/);
    expect(readFileSync(hook({ root }), 'utf8')).toContain('vulcan commit-check');
    expect(
      JSON.parse(readFileSync(join(root, '.agents/vulcan.manifest.json'), 'utf8')).commit,
    ).toEqual({
      message: { agent: { signature: 'deny' } },
    });
    expect(sync({ root }).stderr).toMatch(/unchanged\s+\.git\/hooks\/commit-msg/);
  });

  test('a project that sets nothing gets no hook and no line about one', () => {
    const root = repo({});
    const result = sync({ root });

    expect(result.code, result.stderr).toBe(0);
    expect(existsSync(hook({ root }))).toBe(false);
    expect(result.stderr).not.toContain('commit-msg');
  });

  test('--dry-run says what it would do and writes nothing', () => {
    const root = repo({ commit: DENY });
    const result = sync({ root, extra: ['--dry-run'] });

    expect(result.stderr).toMatch(/would create\s+\.git\/hooks\/commit-msg/);
    expect(existsSync(hook({ root }))).toBe(false);
  });

  test('a hook of the developer is skipped with the line to add, and kept', () => {
    const root = repo({ commit: DENY });

    mkdirSync(join(root, '.git/hooks'), { recursive: true });
    writeFileSync(hook({ root }), '#!/bin/sh\necho mine\n');

    const result = sync({ root });

    expect(result.stderr).toMatch(/skipped\s+\.git\/hooks\/commit-msg/);
    expect(result.stderr).toContain('bun x --no-install vulcan commit-check "$1"');
    expect(readFileSync(hook({ root }), 'utf8')).toBe('#!/bin/sh\necho mine\n');
  });

  test('the hook goes when the project turns the checks off', () => {
    const root = repo({ commit: DENY });

    sync({ root });
    writeFileSync(join(root, '.configs/vulcan.config.mts'), CONFIG({}));

    const result = sync({ root });

    expect(result.stderr).toMatch(/removed\s+\.git\/hooks\/commit-msg/);
    expect(existsSync(hook({ root }))).toBe(false);
  });
});

describe('vulcan doctor and the commit-msg hook', () => {
  const warningsOf = async (opts: { root: string }): Promise<string[]> => {
    const warnings = await DoctorRunner.runWarnings({ root: opts.root });

    return warnings
      .filter((warning) => warning.check === DoctorChecks.COMMIT_HOOK)
      .map((warning) => warning.message);
  };

  test('a missing hook is a warning that names the fix, and sync clears it', async () => {
    const root = repo({ commit: DENY });
    const [message] = await warningsOf({ root });

    expect(message).toContain('not installed');
    expect(message).toContain('vulcan sync');

    sync({ root });

    const after = await warningsOf({ root });

    expect(after).toEqual([]);
  });

  test('a hook of the developer that does not call the check is a warning with the line to add', async () => {
    const root = repo({ commit: DENY });

    mkdirSync(join(root, '.git/hooks'), { recursive: true });
    writeFileSync(hook({ root }), '#!/bin/sh\necho mine\n');

    const [message] = await warningsOf({ root });

    expect(message).toContain('bun x --no-install vulcan commit-check "$1"');
  });

  test('a stale managed hook is a warning', async () => {
    const root = repo({ commit: DENY });

    mkdirSync(join(root, '.git/hooks'), { recursive: true });
    writeFileSync(hook({ root }), '#!/bin/sh\n# vulcan:commit-msg\nold\n');

    const [message] = await warningsOf({ root });

    expect(message).toContain('out of date');
  });

  test('a project that turned nothing on, or is not a git repository, hears nothing', async () => {
    const unconfigured = await warningsOf({ root: repo({}) });
    const notGit = createProject({
      files: { '.configs/vulcan.config.mts': CONFIG({ commit: DENY }), 'AGENTS.md': '# x\n' },
    });
    const outsideGit = await warningsOf({ root: notGit });

    expect(unconfigured).toEqual([]);
    expect(outsideGit).toEqual([]);
  });
});

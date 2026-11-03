import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DoctorChecks, DoctorRunner } from '../../doctor/index.ts';
import { git } from '../git-repo.helper.ts';
import { hermeticEnv } from '../hermetic.helper.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';

afterAll(removeProjects);

const CONFIG = (opts: { signature?: string }) =>
  `export default {${
    opts.signature === undefined
      ? ''
      : ` commit: { message: { agent: { signature: '${opts.signature}' } } },`
  } };\n`;

const ATTRIBUTION = { commit: '', pr: '', sessionUrl: false };

const repo = (opts: { signature?: string; files?: Record<string, string> }): string => {
  const root = createProject({
    files: {
      '.configs/vulcan.config.mts': CONFIG({ signature: opts.signature }),
      'AGENTS.md': '# x\n',
      ...opts.files,
    },
  });

  git({ cwd: root, args: ['init', '--quiet'] });

  return root;
};

const sync = (opts: { root: string; agents?: string; extra?: string[] }) =>
  runCli({
    args: ['sync', '--agents', opts.agents ?? 'claude', ...(opts.extra ?? [])],
    cwd: opts.root,
    env: hermeticEnv(),
  });

const settingsOf = (opts: { root: string }): Record<string, unknown> =>
  JSON.parse(readFileSync(join(opts.root, '.claude/settings.json'), 'utf8'));

const managedOf = (opts: { root: string }): Record<string, unknown> =>
  JSON.parse(readFileSync(join(opts.root, '.claude/vulcan-managed.json'), 'utf8'));

describe('Claude Code attribution while agents may not sign commits', () => {
  test('deny writes an empty commit and pull request attribution, and no session link', () => {
    const root = repo({ signature: 'deny' });
    const result = sync({ root });

    expect(result.code, result.stderr).toBe(0);
    expect(settingsOf({ root }).attribution).toEqual(ATTRIBUTION);
    expect(managedOf({ root }).attribution).toEqual(ATTRIBUTION);
  });

  test('the default, and allow, leave attribution to Claude Code', () => {
    for (const signature of [undefined, 'allow']) {
      const root = repo({ signature });

      sync({ root });

      expect(settingsOf({ root }).attribution, `signature ${signature}`).toBeUndefined();
    }
  });

  test('a second sync changes nothing', () => {
    const root = repo({ signature: 'deny' });

    sync({ root });

    expect(sync({ root }).stderr).toMatch(/unchanged\s+\.claude\/settings\.json/);
  });

  test('switching back to allow removes what sync wrote and nothing else', () => {
    const root = repo({ signature: 'deny' });

    sync({ root });

    const mine = { ...settingsOf({ root }), model: 'opus', permissions: { allow: ['Bash(ls)'] } };

    writeFileSync(join(root, '.claude/settings.json'), `${JSON.stringify(mine, null, 2)}\n`);
    writeFileSync(join(root, '.configs/vulcan.config.mts'), CONFIG({ signature: 'allow' }));
    sync({ root });

    const after = settingsOf({ root });

    expect(after.attribution).toBeUndefined();
    expect(managedOf({ root }).attribution).toBeUndefined();
    expect(after.model).toBe('opus');
    expect(after.permissions).toEqual(
      expect.objectContaining({ allow: expect.arrayContaining(['Bash(ls)']) }),
    );
  });

  test('an attribution the developer changed by hand is not taken back', () => {
    const root = repo({ signature: 'deny' });

    sync({ root });
    writeFileSync(
      join(root, '.claude/settings.json'),
      `${JSON.stringify({ ...settingsOf({ root }), attribution: { commit: 'mine', pr: '' } }, null, 2)}\n`,
    );
    writeFileSync(join(root, '.configs/vulcan.config.mts'), CONFIG({ signature: 'allow' }));
    sync({ root });

    expect(settingsOf({ root }).attribution).toEqual({ commit: 'mine', pr: '' });
  });

  test('with --dry-run nothing is written', () => {
    const root = repo({ signature: 'deny' });

    sync({ root, extra: ['--dry-run'] });

    expect(existsSync(join(root, '.claude/settings.json'))).toBe(false);
  });

  test('without Claude Code chosen, no Claude settings are written', () => {
    const root = repo({ signature: 'deny' });

    sync({ root, agents: 'omp' });

    expect(existsSync(join(root, '.claude/settings.json'))).toBe(false);
  });

  test('doctor calls settings without it stale once the project denies signatures', async () => {
    const root = repo({ signature: 'allow' });

    sync({ root });
    writeFileSync(join(root, '.configs/vulcan.config.mts'), CONFIG({ signature: 'deny' }));

    const violations = await DoctorRunner.runChecks({ root });

    expect(violations.some((entry) => entry.check === DoctorChecks.ADAPTERS)).toBe(true);

    sync({ root });

    const after = await DoctorRunner.runChecks({ root });

    expect(after.some((entry) => entry.check === DoctorChecks.ADAPTERS)).toBe(false);
  });

  test('another setting of the developer survives the first deny', () => {
    const root = repo({
      signature: 'deny',
      files: { '.claude/settings.json': JSON.stringify({ model: 'opus' }) },
    });

    mkdirSync(join(root, '.claude'), { recursive: true });
    sync({ root });

    expect(settingsOf({ root }).model).toBe('opus');
    expect(settingsOf({ root }).attribution).toEqual(ATTRIBUTION);
  });
});

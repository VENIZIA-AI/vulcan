import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, lstatSync, mkdirSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';

afterAll(removeProjects);

const PROJECT = {
  '.configs/vulcan.config.ts': "export default { rules: { 'V-W-01': 'read-only' } };\n",
  'AGENTS.md': '# x\n',
};
const SHIPPED = ['build-a-feature', 'docs-update', 'docs-writing', 'knowledge-sync'];

const sync = (opts: { root: string; agents: string }) =>
  runCli({ args: ['sync', '--agents', opts.agents], cwd: opts.root });

const isLink = (opts: { path: string }): boolean =>
  existsSync(opts.path) && lstatSync(opts.path).isSymbolicLink();

describe('shipped skills for the agents that read .agents/skills', () => {
  test('omp gets the four shipped skills as links in .agents/skills, and no Claude folder', () => {
    const root = createProject({ files: PROJECT });
    const result = sync({ root, agents: 'omp' });

    expect(result.code).toBe(0);

    for (const name of SHIPPED) {
      const link = join(root, '.agents/skills', name);

      expect(isLink({ path: link })).toBe(true);
      expect(existsSync(join(link, 'SKILL.md'))).toBe(true);
      expect(result.stderr).toContain(`created   .agents/skills/${name}`);
    }

    expect(existsSync(join(root, '.claude'))).toBe(false);
  });

  test('the link points at the same stable path the Claude links use', () => {
    const root = createProject({ files: PROJECT });

    sync({ root, agents: 'claude,omp' });

    for (const name of SHIPPED) {
      expect(readlinkSync(join(root, '.agents/skills', name))).toBe(
        readlinkSync(join(root, '.claude/skills', name)),
      );
    }
  });

  test('claude alone leaves .agents/skills without links', () => {
    const root = createProject({ files: PROJECT });

    sync({ root, agents: 'claude' });

    expect(existsSync(join(root, '.agents/skills'))).toBe(false);
  });

  test('every agent that reads the folder shares one set of links', () => {
    const root = createProject({ files: PROJECT });
    const result = sync({ root, agents: 'omp,codex,cursor,antigravity,pi' });

    expect(result.stderr.match(/\.agents\/skills\/docs-update/g)).toHaveLength(1);
  });

  test('a project skill of the same name wins: its real folder is left and reported', () => {
    const root = createProject({
      files: { ...PROJECT, '.agents/skills/docs-update/SKILL.md': 'mine' },
    });
    const result = sync({ root, agents: 'omp' });

    expect(result.stderr).toContain(
      'skipped   .agents/skills/docs-update (a real directory - left untouched)',
    );
    expect(isLink({ path: join(root, '.agents/skills/docs-update') })).toBe(false);
    expect(isLink({ path: join(root, '.agents/skills/docs-writing') })).toBe(true);
  });

  test('project skills that are not shipped names stay as they are', () => {
    const root = createProject({
      files: { ...PROJECT, '.agents/skills/my-skill/SKILL.md': 'mine' },
    });

    sync({ root, agents: 'omp' });

    expect(isLink({ path: join(root, '.agents/skills/my-skill') })).toBe(false);
    expect(existsSync(join(root, '.agents/skills/my-skill/SKILL.md'))).toBe(true);
  });

  test('a second run reports every link unchanged', () => {
    const root = createProject({ files: PROJECT });

    sync({ root, agents: 'omp' });

    const again = sync({ root, agents: 'omp' });

    for (const name of SHIPPED) {
      expect(again.stderr).toContain(`unchanged .agents/skills/${name}`);
    }
  });

  test('a link to a shipped skill this version no longer has is taken back', () => {
    const root = createProject({ files: PROJECT });

    sync({ root, agents: 'omp' });

    const dead = join(root, '.agents/skills', 'retired-skill');
    const stable = readlinkSync(join(root, '.agents/skills', 'docs-update')).replace(
      /docs-update$/,
      'retired-skill',
    );

    mkdirSync(join(root, '.agents/skills'), { recursive: true });
    Bun.spawnSync(['ln', '-s', stable, dead]);

    const again = sync({ root, agents: 'omp' });

    expect(again.stderr).toContain(
      'removed   .agents/skills/retired-skill (a shipped skill this version no longer has)',
    );
    expect(existsSync(dead)).toBe(false);
  });

  test('a symlinked .agents/skills is left alone', () => {
    const root = createProject({ files: PROJECT });
    const elsewhere = createProject({ files: {} });

    mkdirSync(join(root, '.agents'), { recursive: true });
    Bun.spawnSync(['ln', '-s', elsewhere, join(root, '.agents/skills')]);

    const result = sync({ root, agents: 'omp' });

    expect(result.stderr).toContain('skipped   .agents/skills (a symlink - left untouched)');
    expect(existsSync(join(elsewhere, 'docs-update'))).toBe(false);
  });

  test('--dry-run writes none of it', () => {
    const root = createProject({ files: PROJECT });
    const result = runCli({ args: ['sync', '--dry-run', '--agents', 'omp'], cwd: root });

    expect(result.stderr).toContain('would create  .agents/skills/docs-update');
    expect(existsSync(join(root, '.agents/skills'))).toBe(false);
  });
});

import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GUARD_HOOK_NAME } from '../../agents/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';

afterAll(removeProjects);

const PROJECT = {
  '.configs/vulcan.config.ts': "export default { rules: { 'V-W-01': 'read-only' } };\n",
  'AGENTS.md': '# x\n',
};
const HOOKS = '.agents/hooks.json';

const sync = (opts: { root: string; agents: string }) =>
  runCli({ args: ['sync', '--agents', opts.agents], cwd: opts.root });

const hooksOf = (opts: { root: string }): Record<string, unknown> =>
  JSON.parse(readFileSync(join(opts.root, HOOKS), 'utf8'));

describe('the guard hook of Antigravity', () => {
  test('sync creates .agents/hooks.json with the guard entry, hidden from git on this machine', () => {
    const root = createProject({ files: PROJECT });

    Bun.spawnSync(['git', 'init', '-q'], { cwd: root });

    const result = sync({ root, agents: 'antigravity' });

    expect(result.code).toBe(0);
    expect(Object.keys(hooksOf({ root }))).toEqual([GUARD_HOOK_NAME]);
    expect(result.stderr).toContain(`created   ${HOOKS}`);
    expect(readFileSync(join(root, '.git', 'info', 'exclude'), 'utf8')).toContain(`/${HOOKS}`);
  });

  test('a second run reports it unchanged and the hooks of the user stay', () => {
    const root = createProject({
      files: { ...PROJECT, [HOOKS]: JSON.stringify({ 'my-linter': { PostToolUse: [] } }) },
    });

    sync({ root, agents: 'antigravity' });

    expect(Object.keys(hooksOf({ root }))).toEqual(['my-linter', GUARD_HOOK_NAME]);
    expect(sync({ root, agents: 'antigravity' }).stderr).toContain(`unchanged ${HOOKS}`);
  });

  test('a hooks file that is not JSON is left alone and the line says so', () => {
    const root = createProject({ files: { ...PROJECT, [HOOKS]: '{ not json' } });
    const result = sync({ root, agents: 'antigravity' });

    expect(result.code).toBe(0);
    expect(readFileSync(join(root, HOOKS), 'utf8')).toBe('{ not json');
    expect(result.stderr).toContain('the hooks file is not JSON');
  });

  test('choosing the agent away takes only its entry back; the file goes when nothing else is in it', () => {
    const alone = createProject({ files: PROJECT });

    sync({ root: alone, agents: 'antigravity,pi' });
    sync({ root: alone, agents: 'pi' });

    expect(existsSync(join(alone, HOOKS))).toBe(false);

    const shared = createProject({
      files: { ...PROJECT, [HOOKS]: JSON.stringify({ 'my-linter': { PostToolUse: [] } }) },
    });

    sync({ root: shared, agents: 'antigravity' });
    sync({ root: shared, agents: 'pi' });

    expect(Object.keys(hooksOf({ root: shared }))).toEqual(['my-linter']);
  });
});

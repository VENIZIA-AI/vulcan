import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';

afterAll(removeProjects);

const PROJECT = {
  '.configs/vulcan.config.ts': "export default { rules: { 'V-W-01': 'read-only' } };\n",
  'AGENTS.md': '# x\n',
};
const HOOKS = '.codex/hooks.json';
const MINE = { matcher: 'Bash', hooks: [{ type: 'command', command: './my-check.sh' }] };

const sync = (opts: { root: string; agents: string }) =>
  runCli({ args: ['sync', '--agents', opts.agents], cwd: opts.root });

interface IFile {
  hooks: { PreToolUse: { matcher: string; hooks: { command: string }[] }[] };
}

const fileOf = (opts: { root: string }): IFile =>
  JSON.parse(readFileSync(join(opts.root, HOOKS), 'utf8'));

describe('the guard hook of Codex', () => {
  test('sync creates .codex/hooks.json with the guard entry, hidden from git, and prints the trust note', () => {
    const root = createProject({ files: PROJECT });

    Bun.spawnSync(['git', 'init', '-q'], { cwd: root });

    const result = sync({ root, agents: 'codex' });

    expect(result.code).toBe(0);
    expect(fileOf({ root }).hooks.PreToolUse).toHaveLength(1);
    expect(result.stderr).toContain(`created   ${HOOKS}`);
    expect(result.stderr).toContain('only after you review and trust it in /hooks');
    expect(readFileSync(join(root, '.git', 'info', 'exclude'), 'utf8')).toContain(`/${HOOKS}`);
  });

  test('a second run reports it unchanged, and the hooks of the user stay', () => {
    const root = createProject({
      files: { ...PROJECT, [HOOKS]: JSON.stringify({ hooks: { PreToolUse: [MINE] } }) },
    });

    sync({ root, agents: 'codex' });

    expect(fileOf({ root }).hooks.PreToolUse).toHaveLength(2);
    expect(fileOf({ root }).hooks.PreToolUse[0]).toEqual(MINE);
    expect(sync({ root, agents: 'codex' }).stderr).toContain(`unchanged ${HOOKS}`);
  });

  test('a hooks file that is not JSON is left alone and the line says so', () => {
    const root = createProject({ files: { ...PROJECT, [HOOKS]: '{ not json' } });
    const result = sync({ root, agents: 'codex' });

    expect(result.code).toBe(0);
    expect(readFileSync(join(root, HOOKS), 'utf8')).toBe('{ not json');
    expect(result.stderr).toContain('the hooks file is not JSON');
  });

  test('choosing Codex away takes only its entry back; the file and its folder go when nothing else is in them', () => {
    const alone = createProject({ files: PROJECT });

    sync({ root: alone, agents: 'codex,pi' });
    sync({ root: alone, agents: 'pi' });

    expect(existsSync(join(alone, HOOKS))).toBe(false);

    const shared = createProject({
      files: { ...PROJECT, [HOOKS]: JSON.stringify({ hooks: { PreToolUse: [MINE] } }) },
    });

    sync({ root: shared, agents: 'codex' });
    sync({ root: shared, agents: 'pi' });

    expect(fileOf({ root: shared }).hooks.PreToolUse).toEqual([MINE]);
  });
});

import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';

afterAll(removeProjects);

const PROJECT = {
  '.configs/vulcan.config.ts': "export default { rules: { 'V-W-01': 'read-only' } };\n",
  'AGENTS.md': '# x\n',
};

const git = (opts: { root: string; args: string[] }) =>
  Bun.spawnSync(['git', ...opts.args], { cwd: opts.root, stdout: 'pipe', stderr: 'pipe' });

const repo = (opts: { files?: Record<string, string> } = {}): string => {
  const root = createProject({ files: { ...PROJECT, ...opts.files } });

  git({ root, args: ['init', '-q'] });

  return root;
};

const sync = (opts: { root: string; agents: string }) =>
  runCli({ args: ['sync', '--agents', opts.agents], cwd: opts.root });

const exclude = (opts: { root: string }): string =>
  readFileSync(join(opts.root, '.git/info/exclude'), 'utf8');

const status = (opts: { root: string }): string =>
  git({
    root: opts.root,
    args: ['status', '--porcelain', '--untracked-files=all'],
  }).stdout.toString();

describe('the chosen agents go to .git/info/exclude', () => {
  test('the files sync wrote for them are ignored in this clone and nowhere else', () => {
    const root = repo();
    const result = sync({ root, agents: 'cursor,omp' });
    const block = exclude({ root });

    expect(result.stderr).toMatch(/(created|replaced)\s+\.git\/info\/exclude/);
    expect(block).toContain('# vulcan:start');
    expect(block).toContain('/.cursor/mcp.json');
    expect(block).toContain('/.agents/skills/docs-update');
    expect(block).toContain('/.agents/vulcan.local.json');
    expect(block).not.toContain('CLAUDE.md');
    expect(existsSync(join(root, '.gitignore'))).toBe(false);
    expect(status({ root })).not.toContain('.cursor');
    expect(status({ root })).not.toContain('.agents/skills');
    expect(status({ root })).not.toContain('vulcan.local.json');
  });

  test('Claude files are listed when claude is chosen', () => {
    const root = repo();

    sync({ root, agents: 'claude' });

    expect(exclude({ root })).toContain('/CLAUDE.md');
    expect(exclude({ root })).toContain('/.claude/');
    expect(status({ root })).not.toContain('CLAUDE.md');
  });

  test('a second run reports it unchanged', () => {
    const root = repo();

    sync({ root, agents: 'cursor' });

    expect(sync({ root, agents: 'cursor' }).stderr).toContain('unchanged .git/info/exclude');
  });

  test('an agent that is no longer chosen drops out of the block, and its files are taken back', () => {
    const root = repo();

    sync({ root, agents: 'cursor,pi' });
    sync({ root, agents: 'pi' });

    expect(exclude({ root })).not.toContain('.cursor');
    expect(exclude({ root })).toContain('/.pi/mcp.json');
    expect(existsSync(join(root, '.cursor/mcp.json'))).toBe(false);
  });

  test("the user's own lines in the file stay", () => {
    const root = repo();

    writeFileSync(join(root, '.git/info/exclude'), '# mine\n*.log\n');
    sync({ root, agents: 'cursor' });

    expect(exclude({ root }).startsWith('# mine\n*.log\n')).toBe(true);
  });

  test('a path git tracks is not listed', () => {
    const root = repo({ files: { '.vscode/mcp.json': '{ "servers": {} }\n' } });

    git({ root, args: ['add', '.vscode/mcp.json'] });
    sync({ root, agents: 'copilot-vscode,cursor' });

    expect(exclude({ root })).not.toContain('.vscode');
    expect(exclude({ root })).toContain('/.cursor/mcp.json');
  });

  test('a project that is not a git repository gets no exclude file and no error', () => {
    const root = createProject({ files: PROJECT });
    const result = sync({ root, agents: 'cursor' });

    expect(result.code).toBe(0);
    expect(existsSync(join(root, '.git'))).toBe(false);
    expect(result.stderr).not.toContain('exclude');
  });

  test('--dry-run writes nothing', () => {
    const root = repo();
    const result = runCli({ args: ['sync', '--dry-run', '--agents', 'cursor'], cwd: root });

    expect(result.stderr).toMatch(/would (create|replace)\s+\.git\/info\/exclude/);
    expect(exclude({ root })).not.toContain('vulcan:start');
    expect(existsSync(join(root, '.cursor'))).toBe(false);
  });

  test('a clone whose .git is a file (a worktree, a separate git dir) writes to the real exclude file', () => {
    const root = createProject({ files: PROJECT });
    const gitDirectory = join(createProject({ files: {} }), 'real.git');

    git({ root, args: ['init', '-q', '--separate-git-dir', gitDirectory] });

    const result = sync({ root, agents: 'cursor' });

    expect(readFileSync(join(root, '.git'), 'utf8')).toContain('gitdir:');
    expect(result.code).toBe(0);
    expect(readFileSync(join(gitDirectory, 'info/exclude'), 'utf8')).toContain('/.cursor/mcp.json');
    expect(status({ root })).not.toContain('.cursor');
  });

  test('a project below the repository top is anchored with its folder', () => {
    const top = repo();
    const root = join(top, 'apps', 'demo');

    mkdirSync(join(root, '.configs'), { recursive: true });
    writeFileSync(join(root, '.configs/vulcan.config.ts'), PROJECT['.configs/vulcan.config.ts']);
    writeFileSync(join(root, 'AGENTS.md'), '# x\n');

    sync({ root, agents: 'cursor' });

    expect(exclude({ root: top })).toContain('/apps/demo/.cursor/mcp.json');
    expect(status({ root: top })).not.toContain('.cursor');
  });
});

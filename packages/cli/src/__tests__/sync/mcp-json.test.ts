import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';

afterAll(removeProjects);

const PROJECT = {
  '.configs/vulcan.config.ts': "export default { rules: { 'V-W-01': 'read-only' } };\n",
  'AGENTS.md': '# x\n',
};
const CANONICAL = {
  command: 'bun',
  args: ['x', '--no-install', 'vulcan', 'x', 'atlas', 'mcp', '--root', '.'],
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

const agents = (opts: { root: string; args: string[] }) =>
  runCli({ args: ['agents', ...opts.args], cwd: opts.root });

const mcp = (opts: { root: string }) =>
  JSON.parse(readFileSync(join(opts.root, '.mcp.json'), 'utf8'));

const exclude = (opts: { root: string }): string =>
  readFileSync(join(opts.root, '.git/info/exclude'), 'utf8');

describe('sync writes the root .mcp.json for the agents that read it', () => {
  for (const agent of ['claude', 'omp', 'copilot-cli']) {
    test(`${agent}: the canonical atlas entry, created`, () => {
      const root = repo();
      const result = sync({ root, agents: agent });

      expect(result.code).toBe(0);
      expect(result.stderr).toContain('created   .mcp.json');
      expect(mcp({ root })).toEqual({ mcpServers: { atlas: CANONICAL } });
    });
  }

  for (const agent of ['cursor', 'antigravity', 'pi', 'codex', 'copilot-vscode']) {
    test(`${agent} does not read it: no .mcp.json`, () => {
      const root = repo();

      sync({ root, agents: agent });
      expect(existsSync(join(root, '.mcp.json'))).toBe(false);
    });
  }

  test('three agents that read it share one file, written once', () => {
    const root = repo();
    const result = sync({ root, agents: 'claude,omp,copilot-cli' });

    expect(result.stderr.match(/\.mcp\.json/g)).toHaveLength(1);
  });

  test('it is listed in this clone .git/info/exclude, once', () => {
    const root = repo();

    sync({ root, agents: 'claude,omp' });

    expect(exclude({ root }).match(/\/\.mcp\.json/g)).toHaveLength(1);
    expect(
      git({ root, args: ['status', '--porcelain', '--untracked-files=all'] }).stdout.toString(),
    ).not.toContain('.mcp.json');
  });

  test('a second run changes nothing', () => {
    const root = repo();

    sync({ root, agents: 'omp' });

    expect(sync({ root, agents: 'omp' }).stderr).toContain('unchanged .mcp.json');
  });

  test('the user servers and keys stay, the atlas entry is added after them', () => {
    const root = repo({
      files: { '.mcp.json': JSON.stringify({ mcpServers: { mine: { command: 'x' } }, other: 1 }) },
    });

    sync({ root, agents: 'omp' });

    expect(mcp({ root })).toEqual({
      mcpServers: { mine: { command: 'x' }, atlas: CANONICAL },
      other: 1,
    });
  });

  test('an atlas entry the user wrote is left as it is', () => {
    const mine = JSON.stringify({ mcpServers: { atlas: { command: 'mine' } } });
    const root = repo({ files: { '.mcp.json': mine } });
    const result = sync({ root, agents: 'omp' });

    expect(result.stderr).toContain('unchanged .mcp.json');
    expect(readFileSync(join(root, '.mcp.json'), 'utf8')).toBe(mine);
  });

  test('a file that is not JSON is skipped and untouched', () => {
    const root = repo({ files: { '.mcp.json': '{ nope' } });
    const result = sync({ root, agents: 'omp' });

    expect(result.stderr).toContain('skipped   .mcp.json (not valid JSON');
    expect(readFileSync(join(root, '.mcp.json'), 'utf8')).toBe('{ nope');
  });

  test('--dry-run says what it would write and writes nothing', () => {
    const root = repo();
    const result = runCli({ args: ['sync', '--agents', 'omp', '--dry-run'], cwd: root });

    expect(result.stderr).toContain('would create  .mcp.json');
    expect(existsSync(join(root, '.mcp.json'))).toBe(false);
  });
});

describe('a project that tracks .mcp.json today (the migration)', () => {
  const tracked = (opts: { text: string }): string => {
    const root = repo({ files: { '.mcp.json': opts.text } });

    git({ root, args: ['add', '.mcp.json'] });

    return root;
  };

  test('sync never rewrites it, even to add the atlas entry, and does not list it in the exclude block', () => {
    const text = `${JSON.stringify({ mcpServers: { mine: { command: 'x' } } })}\n`;
    const root = tracked({ text });
    const result = sync({ root, agents: 'omp' });

    expect(result.code).toBe(0);
    expect(readFileSync(join(root, '.mcp.json'), 'utf8')).toBe(text);
    expect(exclude({ root })).not.toContain('/.mcp.json');
  });

  test('a tracked canonical file is unchanged, and still not excluded', () => {
    const text = `${JSON.stringify({ mcpServers: { atlas: CANONICAL } }, null, 2)}\n`;
    const root = tracked({ text });

    expect(sync({ root, agents: 'omp' }).stderr).toContain('unchanged .mcp.json');
    expect(exclude({ root })).not.toContain('/.mcp.json');
  });

  test('doctor says what to do: git rm --cached, and let sync manage it', () => {
    const root = tracked({ text: `${JSON.stringify({ mcpServers: { atlas: CANONICAL } })}\n` });

    sync({ root, agents: 'omp' });

    const result = runCli({ args: ['doctor'], cwd: root });

    expect(result.stderr).toContain(
      'warning [mcp] .mcp.json: tracked by git; VULCAN now writes it per machine. Run `git rm --cached .mcp.json` and let sync manage it.',
    );
  });

  test('after git rm --cached sync adopts the canonical entry: excluded, then taken back on remove', () => {
    const root = tracked({
      text: `${JSON.stringify({ mcpServers: { atlas: CANONICAL } }, null, 2)}\n`,
    });

    sync({ root, agents: 'omp' });
    git({ root, args: ['rm', '--cached', '-q', '.mcp.json'] });

    const second = sync({ root, agents: 'omp' });

    expect(second.stderr).toContain('unchanged .mcp.json');
    expect(exclude({ root })).toContain('/.mcp.json');

    const removed = agents({ root, args: ['remove', 'omp'] });

    expect(removed.stderr).toContain('removed   .mcp.json');
    expect(existsSync(join(root, '.mcp.json'))).toBe(false);
  });

  test('doctor is quiet about it when no chosen agent reads .mcp.json', () => {
    const root = tracked({ text: `${JSON.stringify({ mcpServers: { atlas: CANONICAL } })}\n` });

    sync({ root, agents: 'cursor' });

    expect(runCli({ args: ['doctor'], cwd: root }).stderr).not.toContain('is tracked');
  });
});

describe('agents remove takes .mcp.json back when no remaining agent reads it', () => {
  test('the last reader leaves: the file sync wrote is deleted', () => {
    const root = repo();

    sync({ root, agents: 'omp,cursor' });

    const result = agents({ root, args: ['remove', 'omp'] });

    expect(result.stderr).toContain('removed   .mcp.json');
    expect(existsSync(join(root, '.mcp.json'))).toBe(false);
    expect(exclude({ root })).not.toContain('/.mcp.json');
  });

  test('another reader stays: the file stays', () => {
    const root = repo();

    sync({ root, agents: 'omp,claude' });

    const result = agents({ root, args: ['remove', 'omp'] });

    expect(result.stderr).not.toContain('removed   .mcp.json');
    expect(mcp({ root })).toEqual({ mcpServers: { atlas: CANONICAL } });
  });

  test('a file with the user servers loses only the atlas key', () => {
    const root = repo({
      files: { '.mcp.json': JSON.stringify({ mcpServers: { mine: { command: 'x' } } }) },
    });

    sync({ root, agents: 'omp' });
    agents({ root, args: ['remove', 'omp'] });

    expect(mcp({ root })).toEqual({ mcpServers: { mine: { command: 'x' } } });
  });

  test('an atlas entry the user changed is left, and the line says so', () => {
    const root = repo();

    sync({ root, agents: 'omp' });
    writeFileSync(
      join(root, '.mcp.json'),
      JSON.stringify({ mcpServers: { atlas: { command: 'mine' } } }),
    );

    const result = agents({ root, args: ['remove', 'omp'] });

    expect(result.stderr).toContain(
      'skipped   .mcp.json (the atlas entry is not the one sync wrote - left alone)',
    );
    expect(existsSync(join(root, '.mcp.json'))).toBe(true);
  });

  test('a tracked file is left alone', () => {
    const text = `${JSON.stringify({ mcpServers: { atlas: CANONICAL } }, null, 2)}\n`;
    const root = repo({ files: { '.mcp.json': text } });

    git({ root, args: ['add', '.mcp.json'] });
    sync({ root, agents: 'omp' });

    const result = agents({ root, args: ['remove', 'omp'] });

    expect(result.stderr).toContain('skipped   .mcp.json (tracked by git - left alone)');
    expect(readFileSync(join(root, '.mcp.json'), 'utf8')).toBe(text);
  });
});

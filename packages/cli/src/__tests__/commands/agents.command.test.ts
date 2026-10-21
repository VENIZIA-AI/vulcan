import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hermeticEnv } from '../hermetic.helper.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';
import { spawnSyncBounded } from '../spawn.helper.ts';

afterAll(removeProjects);

const CLI = join(import.meta.dir, '..', '..', 'cli.ts');
const PROJECT = {
  '.configs/vulcan.config.ts': "export default { rules: { 'V-W-01': 'read-only' } };\n",
  'AGENTS.md': '# x\n',
};
const LOCAL = '.agents/vulcan.local.json';
const hasScript = Bun.which('script') !== null;

const ENV = hermeticEnv();

const git = (opts: { root: string; args: string[] }) =>
  Bun.spawnSync(['git', ...opts.args], {
    cwd: opts.root,
    env: { ...process.env, ...ENV },
    stdout: 'pipe',
    stderr: 'pipe',
  });

/** A git repository with `agents` already synced, so the stored choice and the exclude block exist. */
const synced = (opts: { agents: string; files?: Record<string, string> }): string => {
  const root = createProject({ files: { ...PROJECT, ...opts.files } });

  git({ root, args: ['init', '-q'] });
  runCli({ args: ['sync', '--agents', opts.agents], cwd: root, env: ENV });

  return root;
};

const agents = (opts: { root: string; args: string[] }) =>
  runCli({ args: ['agents', ...opts.args], cwd: opts.root, env: ENV });

const stored = (opts: { root: string }): string[] =>
  JSON.parse(readFileSync(join(opts.root, LOCAL), 'utf8')).agents;

const exclude = (opts: { root: string }): string =>
  readFileSync(join(opts.root, '.git/info/exclude'), 'utf8');

const isLink = (opts: { path: string }): boolean =>
  existsSync(opts.path) && lstatSync(opts.path).isSymbolicLink();

describe('vulcan agents (list)', () => {
  test('prints the chosen agents, what was detected and the table, and writes nothing', () => {
    const root = synced({ agents: 'omp' });
    const before = readFileSync(join(root, LOCAL), 'utf8');
    const result = agents({ root, args: [] });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('chosen on this machine: omp');
    expect(result.stdout).toContain('claude');
    expect(result.stdout).toContain('.cursor/mcp.json');
    expect(readFileSync(join(root, LOCAL), 'utf8')).toBe(before);
  });

  test('an explicit list does the same', () => {
    expect(agents({ root: synced({ agents: 'omp' }), args: ['list'] }).stdout).toContain(
      'chosen on this machine: omp',
    );
  });

  test('a machine that chose nothing says so', () => {
    const root = createProject({ files: PROJECT });

    expect(agents({ root, args: [] }).stdout).toContain('chosen on this machine: (nothing yet)');
  });
});

describe('vulcan agents add', () => {
  test('adds to the stored list in table order and writes the new adapters', () => {
    const root = synced({ agents: 'omp' });
    const result = agents({ root, args: ['add', 'pi,cursor'] });

    expect(result.code).toBe(0);
    expect(stored({ root })).toEqual(['omp', 'cursor', 'pi']);
    expect(existsSync(join(root, '.cursor/mcp.json'))).toBe(true);
    expect(existsSync(join(root, '.pi/mcp.json'))).toBe(true);
    expect(exclude({ root })).toContain('/.pi/mcp.json');
    expect(result.stderr, result.stderr).toContain('created   .cursor/mcp.json');
  });

  test('an agent already chosen is said and nothing changes', () => {
    const root = synced({ agents: 'omp,pi' });
    const before = readFileSync(join(root, LOCAL), 'utf8');
    const result = agents({ root, args: ['add', 'pi'] });

    expect(result.code).toBe(0);
    expect(result.stderr, result.stderr).toContain('already chosen: pi');
    expect(readFileSync(join(root, LOCAL), 'utf8')).toBe(before);
  });

  test('an unknown id, none, or a missing list is refused', () => {
    const root = synced({ agents: 'omp' });

    expect(agents({ root, args: ['add', 'vim'] })).toMatchObject({ code: 1 });
    expect(agents({ root, args: ['add', 'vim'] }).stderr).toContain("unknown agent 'vim'");
    expect(agents({ root, args: ['add', 'none'] }).code).toBe(1);
    expect(agents({ root, args: ['add'] }).stderr).toContain('add needs the agents to add');
    expect(stored({ root })).toEqual(['omp']);
  });

  test('on a machine that chose nothing yet, add starts from what sync would use', () => {
    const root = createProject({ files: { ...PROJECT, 'CLAUDE.md': '@AGENTS.md\n' } });

    agents({ root, args: ['add', 'omp'] });

    expect(stored({ root })).toEqual(['claude', 'omp']);
  });

  test('--dry-run writes nothing', () => {
    const root = synced({ agents: 'omp' });
    const result = agents({ root, args: ['add', 'cursor', '--dry-run'] });

    expect(result.stderr, result.stderr).toContain('would create  .cursor/mcp.json');
    expect(stored({ root })).toEqual(['omp']);
    expect(existsSync(join(root, '.cursor'))).toBe(false);
  });
});

describe('vulcan agents remove', () => {
  test('takes back a file sync wrote whole, its folder, and the exclude lines', () => {
    const root = synced({ agents: 'cursor,omp' });
    const result = agents({ root, args: ['remove', 'cursor'] });

    expect(result.code).toBe(0);
    expect(stored({ root })).toEqual(['omp']);
    expect(existsSync(join(root, '.cursor'))).toBe(false);
    expect(exclude({ root })).not.toContain('.cursor');
    expect(result.stderr, result.stderr).toContain('removed   .cursor/mcp.json');
    expect(isLink({ path: join(root, '.agents/skills/docs-update') })).toBe(true);
  });

  test("a file that also holds the user's servers keeps them: only the atlas key goes", () => {
    const root = synced({
      agents: 'cursor',
      files: {
        '.cursor/mcp.json': JSON.stringify({ mcpServers: { mine: { command: 'x' } }, other: 1 }),
      },
    });

    agents({ root, args: ['remove', 'cursor'] });

    const after = JSON.parse(readFileSync(join(root, '.cursor/mcp.json'), 'utf8'));

    expect(after).toEqual({ mcpServers: { mine: { command: 'x' } }, other: 1 });
  });

  test('an atlas entry the user wrote is left and reported', () => {
    const root = synced({
      agents: 'cursor',
      files: { '.cursor/mcp.json': JSON.stringify({ mcpServers: { atlas: { command: 'mine' } } }) },
    });
    const result = agents({ root, args: ['remove', 'cursor'] });

    expect(result.stderr, result.stderr).toContain(
      'skipped   .cursor/mcp.json (the atlas entry is not the one sync wrote - left alone)',
    );
    expect(
      JSON.parse(readFileSync(join(root, '.cursor/mcp.json'), 'utf8')).mcpServers.atlas,
    ).toEqual({
      command: 'mine',
    });
    expect(stored({ root })).toEqual([]);
  });

  test('codex: the marker block goes, the rest of config.toml stays, an empty file is deleted', () => {
    const kept = synced({ agents: 'codex', files: { '.codex/config.toml': 'model = "gpt"\n' } });

    agents({ root: kept, args: ['remove', 'codex'] });
    expect(readFileSync(join(kept, '.codex/config.toml'), 'utf8')).toBe('model = "gpt"\n');

    const whole = synced({ agents: 'codex' });

    agents({ root: whole, args: ['remove', 'codex'] });
    expect(existsSync(join(whole, '.codex'))).toBe(false);
  });

  test('skill links stay while another chosen agent reads the folder, go with the last one', () => {
    const root = synced({ agents: 'omp,codex' });

    agents({ root, args: ['remove', 'omp'] });
    expect(isLink({ path: join(root, '.agents/skills/docs-update') })).toBe(true);

    agents({ root, args: ['remove', 'codex'] });
    expect(isLink({ path: join(root, '.agents/skills/docs-update') })).toBe(false);
    expect(stored({ root })).toEqual([]);
  });

  test("a project skill of the user's is never touched", () => {
    const root = synced({ agents: 'omp', files: { '.agents/skills/mine/SKILL.md': 'mine' } });

    agents({ root, args: ['remove', 'omp'] });

    expect(readFileSync(join(root, '.agents/skills/mine/SKILL.md'), 'utf8')).toBe('mine');
  });

  test('claude: the shim, the skill links and the managed settings go; a hand-written CLAUDE.md stays', () => {
    const root = synced({ agents: 'claude,omp' });

    expect(existsSync(join(root, 'CLAUDE.md'))).toBe(true);

    agents({ root, args: ['remove', 'claude'] });

    expect(existsSync(join(root, 'CLAUDE.md'))).toBe(false);
    expect(isLink({ path: join(root, '.claude/skills/docs-update') })).toBe(false);
    expect(existsSync(join(root, '.claude/vulcan-managed.json'))).toBe(false);
    expect(stored({ root })).toEqual(['omp']);

    const handWritten = synced({ agents: 'claude', files: { 'CLAUDE.md': 'my own notes\n' } });

    agents({ root: handWritten, args: ['remove', 'claude'] });
    expect(readFileSync(join(handWritten, 'CLAUDE.md'), 'utf8')).toBe('my own notes\n');
  });

  test('a skill the user wrote is unlinked from .claude/skills but its folder stays', () => {
    const root = synced({
      agents: 'claude',
      files: { '.agents/skills/mine/SKILL.md': '---\nname: mine\n---\n' },
    });

    expect(isLink({ path: join(root, '.claude/skills/mine') })).toBe(true);

    agents({ root, args: ['remove', 'claude'] });

    expect(isLink({ path: join(root, '.claude/skills/mine') })).toBe(false);
    expect(existsSync(join(root, '.agents/skills/mine/SKILL.md'))).toBe(true);
  });

  test('personal keys in .claude/settings.json survive the removal of the managed ones', () => {
    const root = synced({ agents: 'claude' });
    const file = join(root, '.claude/settings.json');
    const settings = JSON.parse(readFileSync(file, 'utf8'));

    writeFileSync(file, JSON.stringify({ ...settings, theme: 'dark' }, null, 2));
    agents({ root, args: ['remove', 'claude'] });

    expect(JSON.parse(readFileSync(file, 'utf8')).theme).toBe('dark');
    expect(JSON.stringify(JSON.parse(readFileSync(file, 'utf8')))).not.toContain('session-start');
  });

  test('an agent that is not chosen is said and nothing changes', () => {
    const root = synced({ agents: 'omp' });
    const result = agents({ root, args: ['remove', 'cursor'] });

    expect(result.code).toBe(0);
    expect(result.stderr, result.stderr).toContain('not chosen: cursor');
    expect(stored({ root })).toEqual(['omp']);
  });

  test('--dry-run says what it would remove and removes nothing', () => {
    const root = synced({ agents: 'cursor' });
    const result = agents({ root, args: ['remove', 'cursor', '--dry-run'] });

    expect(result.stderr, result.stderr).toContain('would remove  .cursor/mcp.json');
    expect(existsSync(join(root, '.cursor/mcp.json'))).toBe(true);
    expect(stored({ root })).toEqual(['cursor']);
  });
});

describe('sync --agents does the same cleanup for agents that drop out', () => {
  test('an agent stored before and left out of the new list is taken back', () => {
    const root = synced({ agents: 'cursor,omp' });

    runCli({ args: ['sync', '--agents', 'omp'], cwd: root, env: ENV });

    expect(existsSync(join(root, '.cursor'))).toBe(false);
    expect(stored({ root })).toEqual(['omp']);
  });

  test('a machine that never stored a choice loses nothing it did not choose to drop', () => {
    const root = createProject({ files: { ...PROJECT, 'CLAUDE.md': '@AGENTS.md\n' } });

    runCli({ args: ['sync', '--agents', 'omp'], cwd: root, env: ENV });

    expect(readFileSync(join(root, 'CLAUDE.md'), 'utf8')).toBe('@AGENTS.md\n');
  });
});

describe('vulcan agents setup', () => {
  test('without a terminal it says so and points at add, remove and sync --agents', () => {
    const root = synced({ agents: 'omp' });
    const result = agents({ root, args: ['setup'] });

    expect(result.code).toBe(1);
    expect(result.stderr, result.stderr).toContain('setup asks questions and needs a terminal');
  });

  describe.skipIf(!hasScript)('in a terminal', () => {
    test('Enter keeps the stored list and the question says so', () => {
      const root = synced({ agents: 'omp' });
      const command = `'${process.execPath}' '${CLI}' agents setup`;
      const child = spawnSyncBounded({
        cmd: ['script', '-qec', command, '/dev/null'],
        cwd: root,
        env: { ...process.env, ...ENV },
        stdin: Buffer.from('\n'),
        stdout: 'pipe',
        stderr: 'pipe',
      });

      expect(child.exitCode).toBe(0);
      expect(child.stdout.toString()).toContain('Enter keeps your earlier choice: omp');
      expect(stored({ root })).toEqual(['omp']);
    });

    test('asks again with the stored list shown, and applies the answer', () => {
      const root = synced({ agents: 'omp' });
      const command = `'${process.execPath}' '${CLI}' agents setup`;
      const child = spawnSyncBounded({
        cmd: ['script', '-qec', command, '/dev/null'],
        cwd: root,
        env: { ...process.env, ...ENV },
        stdin: Buffer.from('omp,pi\n'),
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const output = child.stdout.toString();

      expect(child.exitCode).toBe(0);
      expect(output).toContain('chosen before: omp');
      expect(stored({ root })).toEqual(['omp', 'pi']);
      expect(existsSync(join(root, '.pi/mcp.json'))).toBe(true);
    });
  });
});

describe('the command line', () => {
  test('an unknown subcommand is refused with the choices', () => {
    const result = agents({ root: createProject({ files: PROJECT }), args: ['frobnicate'] });

    expect(result.code).toBe(1);
    expect(result.stderr, result.stderr).toContain('unknown subcommand');
    expect(result.stderr, result.stderr).toContain('list, add, remove, setup');
  });

  test('help names the command', () => {
    expect(runCli({ args: ['help'], cwd: createProject({ files: {} }) }).stdout).toContain(
      'agents',
    );
  });
});

import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { NO_TTY_HINT } from '../../agents/index.ts';
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

/** A PATH holding bun and the system tools only, so the agents of the machine running the tests are not detected. */
const barePath = (): string => {
  const bin = createProject({ files: {} });

  symlinkSync(process.execPath, join(bin, 'bun'));

  return `${bin}:/usr/bin:/bin`;
};

const localAgents = (opts: { root: string }): string[] =>
  JSON.parse(readFileSync(join(opts.root, LOCAL), 'utf8')).agents;

describe('vulcan sync --agents', () => {
  test('a list is stored in the local file and only those agents get adapters', () => {
    const root = createProject({ files: PROJECT });
    const result = runCli({ args: ['sync', '--agents', 'omp,pi'], cwd: root });

    expect(result.code).toBe(0);
    expect(localAgents({ root })).toEqual(['omp', 'pi']);
    expect(existsSync(join(root, 'CLAUDE.md'))).toBe(false);
    expect(existsSync(join(root, '.claude'))).toBe(false);
    expect(existsSync(join(root, '.agents/vulcan.manifest.json'))).toBe(true);
    expect(result.stderr).toContain(`created   ${LOCAL}`);
  });

  test('claude in the list writes the Claude adapters as before', () => {
    const root = createProject({ files: PROJECT });

    runCli({ args: ['sync', '--agents', 'claude,omp'], cwd: root });

    expect(localAgents({ root })).toEqual(['claude', 'omp']);
    expect(readFileSync(join(root, 'CLAUDE.md'), 'utf8')).toBe('@AGENTS.md\n');
    expect(existsSync(join(root, '.claude/settings.json'))).toBe(true);
  });

  test('none writes AGENTS.md-level files only', () => {
    const root = createProject({ files: PROJECT });

    expect(runCli({ args: ['sync', '--agents', 'none'], cwd: root }).code).toBe(0);
    expect(localAgents({ root })).toEqual([]);
    expect(existsSync(join(root, 'CLAUDE.md'))).toBe(false);
  });

  test('the next sync with no flag reads the stored choice and prints no hint', () => {
    const root = createProject({ files: PROJECT });

    runCli({ args: ['sync', '--agents', 'omp'], cwd: root });

    const again = runCli({ args: ['sync'], cwd: root });

    expect(again.code).toBe(0);
    expect(again.stderr).not.toContain('no agents chosen');
    expect(existsSync(join(root, 'CLAUDE.md'))).toBe(false);
    expect(again.stderr).toContain(`unchanged ${LOCAL}`);
  });

  test('an unknown agent is refused before anything is written', () => {
    const root = createProject({ files: PROJECT });
    const result = runCli({ args: ['sync', '--agents', 'claude,vim'], cwd: root });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("unknown agent 'vim'");
    expect(existsSync(join(root, '.agents/vulcan.manifest.json'))).toBe(false);
    expect(existsSync(join(root, LOCAL))).toBe(false);
  });

  test('--dry-run says what it would do and writes no local file', () => {
    const root = createProject({ files: PROJECT });
    const result = runCli({ args: ['sync', '--dry-run', '--agents', 'omp'], cwd: root });

    expect(result.stderr).toContain(`would create  ${LOCAL}`);
    expect(existsSync(join(root, LOCAL))).toBe(false);
  });

  test('--agents list prints the table and writes nothing', () => {
    const root = createProject({ files: PROJECT });
    const result = runCli({ args: ['sync', '--agents', 'list'], cwd: root });

    expect(result.code).toBe(0);

    for (const id of [
      'claude',
      'omp',
      'copilot-cli',
      'copilot-vscode',
      'codex',
      'cursor',
      'antigravity',
      'pi',
    ]) {
      expect(result.stdout).toContain(id);
    }

    expect(result.stdout).toContain('.agents/mcp_config.json');
    expect(existsSync(join(root, '.agents'))).toBe(false);
  });
});

describe('vulcan sync with nothing chosen', () => {
  test('without a terminal it writes the Claude files as before, prints one hint and stores nothing', () => {
    const root = createProject({ files: PROJECT });
    const result = runCli({ args: ['sync'], cwd: root });

    expect(result.code).toBe(0);
    expect(existsSync(join(root, 'CLAUDE.md'))).toBe(true);
    expect(existsSync(join(root, '.claude/settings.json'))).toBe(true);
    expect(existsSync(join(root, LOCAL))).toBe(false);
    expect(result.stderr).toContain(NO_TTY_HINT);
    expect(result.stderr.split(NO_TTY_HINT)).toHaveLength(2);
  });

  test('a project that already has Claude files is migrated: stored as claude, no hint', () => {
    const root = createProject({ files: { ...PROJECT, 'CLAUDE.md': '@AGENTS.md\n' } });
    const result = runCli({ args: ['sync'], cwd: root });

    expect(localAgents({ root })).toEqual(['claude']);
    expect(result.stderr).not.toContain('no agents chosen');
  });

  test('a committed config that lists agents is the suggested default', () => {
    const root = createProject({
      files: {
        ...PROJECT,
        '.configs/vulcan.config.ts':
          "export default { agents: ['claude', 'cursor'], rules: { 'V-W-01': 'read-only' } };\n",
      },
    });

    runCli({ args: ['sync'], cwd: root });

    expect(localAgents({ root })).toEqual(['claude', 'cursor']);
  });

  test('the local file is added to .gitignore when there is one, once', () => {
    const root = createProject({ files: { ...PROJECT, '.gitignore': 'node_modules/\n' } });

    runCli({ args: ['sync', '--agents', 'omp'], cwd: root });
    runCli({ args: ['sync', '--agents', 'omp'], cwd: root });

    const ignore = readFileSync(join(root, '.gitignore'), 'utf8');

    expect(ignore).toBe(`node_modules/\n${LOCAL}\n`);
  });
});

describe.skipIf(!hasScript)('vulcan sync in a terminal', () => {
  const runInTerminal = (opts: {
    root: string;
    args: string[];
    answers: string[];
    env?: Record<string, string>;
  }) => {
    const command = [process.execPath, CLI, ...opts.args]
      .map((part) => `'${part.replaceAll("'", "'\\''")}'`)
      .join(' ');
    const child = spawnSyncBounded({
      cmd: ['script', '-qec', command, '/dev/null'],
      cwd: opts.root,
      env: { ...process.env, TERM: 'dumb', ...opts.env },
      stdin: Buffer.from(`${opts.answers.join('\n')}\n`),
      stdout: 'pipe',
      stderr: 'pipe',
    });

    return { code: child.exitCode, output: child.stdout.toString() };
  };

  test('asks which agents, offers what it detected, and stores the answer', () => {
    const root = createProject({ files: PROJECT });
    const home = createProject({ files: { '.codex/config.toml': '' } });
    const { code, output } = runInTerminal({
      root,
      args: ['sync'],
      answers: ['claude,cursor'],
      env: { HOME: home, PATH: barePath() },
    });

    expect(code).toBe(0);
    expect(output).toContain('Which coding agents do you use in this project?');
    expect(output).toContain('detected: codex');
    expect(output).toContain(
      'available: claude, omp, codex, cursor, copilot-cli, copilot-vscode, antigravity, pi, none',
    );
    expect(localAgents({ root })).toEqual(['claude', 'cursor']);
    expect(existsSync(join(root, 'CLAUDE.md'))).toBe(true);
  });

  test('an empty answer accepts the detected agents', () => {
    const root = createProject({ files: PROJECT });
    const home = createProject({ files: { '.codex/config.toml': '' } });

    runInTerminal({ root, args: ['sync'], answers: [''], env: { HOME: home, PATH: barePath() } });

    expect(localAgents({ root })).toEqual(['codex']);
  });

  test('a second run asks nothing', () => {
    const root = createProject({ files: PROJECT });
    const home = createProject({ files: {} });

    runInTerminal({
      root,
      args: ['sync'],
      answers: ['omp'],
      env: { HOME: home, PATH: barePath() },
    });

    const again = runInTerminal({
      root,
      args: ['sync'],
      answers: [],
      env: { HOME: home, PATH: barePath() },
    });

    expect(again.output).not.toContain('Which coding agents');
  });
});

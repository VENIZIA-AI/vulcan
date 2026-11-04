import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EventLog } from '../../events/log.ts';
import { hermeticEnv } from '../hermetic.helper.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';
import { sampleLines } from './log-lines.helper.ts';

afterAll(removeProjects);

/** Before the day the sample lines are on, so `--since` finds them whatever day the test runs. */
const SINCE = '2026-11-01';

const projectWithLog = (): string => {
  const root = createProject({
    files: { '.agents/vulcan.manifest.json': '{}', '.git/HEAD': 'ref: refs/heads/x\n' },
  });

  for (const event of sampleLines()) {
    EventLog.append({ dir: join(root, '.agents/local/events'), event });
  }

  return root;
};

const board = (opts: { root: string; args?: string[]; env?: Record<string, string> }) =>
  runCli({
    args: ['board', '--no-github', '--since', SINCE, ...(opts.args ?? [])],
    cwd: opts.root,
    env: { ...hermeticEnv(), ...opts.env },
  });

const dataOf = (file: string) => {
  const html = readFileSync(file, 'utf8');
  const block =
    /<script type="application\/json" id="board-data">(.*?)<\/script>/s.exec(html)?.[1] ?? '{}';

  return JSON.parse(block);
};

describe('vulcan board', () => {
  test('writes .agents/local/reports/board.html from the event log and prints its path', () => {
    const root = projectWithLog();
    const result = board({ root });

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe(join(root, '.agents/local/reports/board.html'));

    const data = dataOf(result.stdout.trim());

    expect(data.flows.map((flow: { id: string }) => flow.id).sort()).toEqual([
      'F-1',
      'F-2',
      'F-3',
      'F-4',
      'F-5',
      'Unsorted',
    ]);
    expect(data.flows[0].state).toBe('you');
    expect(result.stderr).toContain('event log: 18 line(s)');
    expect(result.stderr).toContain('github: left out (--no-github)');
  });

  test('--out names the file, --dir names the events folder, events.dir from the manifest is the default', () => {
    const shared = createProject({ files: {} });

    for (const event of sampleLines()) {
      EventLog.append({ dir: shared, event });
    }

    const configured = createProject({
      files: {
        '.agents/vulcan.manifest.json': JSON.stringify({ events: { log: true, dir: shared } }),
        '.git/HEAD': 'x',
      },
    });
    const viaManifest = board({ root: configured, args: ['--out', 'out/b.html'] });

    expect(viaManifest.code, viaManifest.stderr).toBe(0);
    expect(dataOf(join(configured, 'out/b.html')).flows).toHaveLength(6);

    const bare = createProject({
      files: { '.agents/vulcan.manifest.json': '{}', '.git/HEAD': 'x' },
    });
    const viaDir = board({ root: bare, args: ['--dir', shared] });

    expect(dataOf(viaDir.stdout.trim()).flows).toHaveLength(6);
  });

  test('--since keeps the lines at or after it; a folder with no log is an empty board, not an error', () => {
    const root = projectWithLog();
    const after = runCli({
      args: ['board', '--no-github', '--since', '2026-11-03T08:50:00Z'],
      cwd: root,
      env: hermeticEnv(),
    });
    const kept = dataOf(after.stdout.trim())
      .flows.map((flow: { id: string }) => flow.id)
      .sort();

    // Only the lines from minute 50 on: F-4's merge, F-5, the unsorted commit.
    expect(kept).toEqual(['F-4', 'F-5', 'Unsorted']);

    const future = runCli({
      args: ['board', '--no-github', '--since', '2026-11-04'],
      cwd: root,
      env: hermeticEnv(),
    });

    expect(dataOf(future.stdout.trim()).flows).toEqual([]);

    const none = createProject({
      files: { '.agents/vulcan.manifest.json': '{}', '.git/HEAD': 'x' },
    });
    const result = runCli({ args: ['board', '--no-github'], cwd: none, env: hermeticEnv() });

    expect(result.code, result.stderr).toBe(0);
    expect(dataOf(result.stdout.trim()).flows).toEqual([]);
  });

  test('run from a subfolder it uses the project of that folder', () => {
    const root = projectWithLog();

    mkdirSync(join(root, 'packages/api'), { recursive: true });

    const result = runCli({
      args: ['board', '--no-github', '--since', SINCE],
      cwd: join(root, 'packages/api'),
      env: hermeticEnv(),
    });

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe(join(root, '.agents/local/reports/board.html'));
  });

  test('without gh the board still builds and says why GitHub was skipped', () => {
    const root = projectWithLog();
    const bin = createProject({ files: {} });

    symlinkSync(process.execPath, join(bin, 'bun'));

    const result = runCli({
      args: ['board', '--since', SINCE],
      cwd: root,
      env: { ...hermeticEnv(), PATH: bin },
    });

    expect(result.code, result.stderr).toBe(0);
    expect(result.stderr).toContain('github: skipped, gh is not installed');
    expect(dataOf(result.stdout.trim()).sources[1]).toBe('github: skipped, gh is not installed');
  });

  test('bad input is exit 2 and writes no file', () => {
    const root = projectWithLog();
    const bad: string[][] = [
      ['--since', 'yesterdayish'],
      ['--repo', 'not-a-repo'],
      ['--repo'],
      ['--out'],
      ['--out', 'a.html', '--out', 'b.html'],
      ['--bogus'],
      ['extra'],
    ];

    for (const args of bad) {
      const result = board({ root, args });

      expect(result.code, args.join(' ')).toBe(2);
      expect(result.stdout, args.join(' ')).toBe('');
    }

    expect(existsSync(join(root, '.agents/local/reports/board.html'))).toBe(false);
  });

  test('--repo may be given more than once', () => {
    const root = projectWithLog();
    const result = runCli({
      args: ['board', '--no-github', '--repo', 'a/b', '--repo', 'c/d', '--since', SINCE],
      cwd: root,
      env: hermeticEnv(),
    });

    expect(result.code, result.stderr).toBe(0);
  });

  test('help lists the command', () => {
    expect(runCli({ args: ['help'], cwd: createProject({ files: {} }) }).stdout).toContain(
      'board [--out <file>]',
    );
  });
});

describe('vulcan board with board.agents in the manifest', () => {
  test('the roster and the lanes reach the page; with nothing listed neither does', () => {
    const root = projectWithLog();
    const plain = dataOf(board({ root }).stdout.trim());

    expect(plain.roster).toBeUndefined();
    expect(plain.lanes).toBeUndefined();

    writeFileSync(
      join(root, '.agents/vulcan.manifest.json'),
      JSON.stringify({
        board: { agents: { 'veni-forge': 'banana', 'pnt-ignis-1': { lane: 'veni-forge' } } },
      }),
    );

    const listed = dataOf(board({ root }).stdout.trim());

    expect(listed.roster).toEqual(['veni-forge']);
    expect(listed.lanes).toEqual({ 'pnt-ignis-1': 'veni-forge' });
    expect(listed.shapes).toEqual({ 'veni-forge': 'banana' });
  });
});

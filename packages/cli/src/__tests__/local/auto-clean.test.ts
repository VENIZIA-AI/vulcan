import { afterAll, describe, expect, test } from 'bun:test';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { spawnSyncBounded } from '@venizia/dev-configs/testing';
import { EventLog } from '../../events/log.ts';
import { LocalAutoClean } from '../../local/auto-clean.ts';
import { AutoCleanRun } from '../../local/auto-clean-run.ts';
import { LocalScan } from '../../local/index.ts';
import { git } from '../git-repo.helper.ts';
import { createProject, removeProjects } from '../project.helper.ts';

afterAll(removeProjects);

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-11-03T12:00:00');
const SCRIPT = join(import.meta.dir, '..', '..', '..', 'base', 'hooks', 'auto-clean.ts');
const SESSION_START = join(import.meta.dir, '..', '..', '..', 'base', 'hooks', 'session-start.ts');
const day = (ago: number): string => EventLog.dayOf({ time: NOW - ago * DAY });

/** A git project with a manifest, the local folders and the files of an agent's week. `old` ages a path. */
const project = (opts: { manifest?: object } = {}): string => {
  const root = createProject({
    files: {
      '.agents/vulcan.manifest.json': JSON.stringify(opts.manifest ?? { events: { log: true } }),
      '.gitignore': '.agents/local/\n',
      'package.json': '{}',
    },
  });

  for (const name of ['tmp', 'worktrees', 'clones', 'cache', 'reports', 'prototypes']) {
    mkdirSync(join(root, '.agents/local', name), { recursive: true });
  }

  git({ cwd: root, args: ['init', '-q', '-b', 'develop'] });
  git({ cwd: root, args: ['config', 'user.email', 'a@example.com'] });
  git({ cwd: root, args: ['config', 'user.name', 'a'] });
  git({ cwd: root, args: ['add', '.'] });
  git({ cwd: root, args: ['commit', '-q', '-m', 'init'] });

  return root;
};
const put = (opts: { root: string; path: string; text?: string; ago?: number }): void => {
  const target = join(opts.root, '.agents/local', opts.path);

  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, opts.text ?? 'x'.repeat(2048));

  if (opts.ago !== undefined) {
    const then = new Date(NOW - opts.ago);

    utimesSync(target, then, then);

    for (const parent of [join(target, '..')]) {
      if (!parent.endsWith('.agents/local')) {
        utimesSync(parent, then, then);
      }
    }
  }
};
/** Gives a file and everything under it the time of `ago` milliseconds before NOW, links not followed. */
const ageTree = (opts: { path: string; ago: number }): void => {
  const then = new Date(NOW - opts.ago);

  if (lstatSync(opts.path).isDirectory()) {
    for (const name of readdirSync(opts.path)) {
      ageTree({ path: join(opts.path, name), ago: opts.ago });
    }
  }

  utimesSync(opts.path, then, then);
};
const has = (opts: { root: string; path: string }): boolean =>
  existsSync(join(opts.root, '.agents/local', opts.path));

describe('LocalAutoClean.tick: once a day, only when asked for', () => {
  const starts = (): { calls: string[]; start: (o: { root: string }) => void } => {
    const calls: string[] = [];

    return { calls, start: (o) => calls.push(o.root) };
  };

  test('the first session of a day starts the clean and leaves a stamp; the next ones that day do not', () => {
    const root = project();
    const spy = starts();

    expect(LocalAutoClean.tick({ root, now: NOW, env: {}, start: spy.start })).toBeUndefined();
    expect(spy.calls).toEqual([root]);
    expect(LocalAutoClean.readStamp({ root })).toMatchObject({
      day: day(0),
      removedFiles: 0,
      removedBytes: 0,
    });

    for (let session = 0; session < 5; session++) {
      LocalAutoClean.tick({ root, now: NOW + session * HOUR, env: {}, start: spy.start });
    }

    expect(spy.calls).toHaveLength(1);
  });

  test('the next day starts it again, once', () => {
    const root = project();
    const spy = starts();

    LocalAutoClean.tick({ root, now: NOW, env: {}, start: spy.start });
    LocalAutoClean.tick({ root, now: NOW + DAY, env: {}, start: spy.start });
    LocalAutoClean.tick({ root, now: NOW + DAY + HOUR, env: {}, start: spy.start });

    expect(spy.calls).toHaveLength(2);
    expect(LocalAutoClean.readStamp({ root })?.day).toBe(day(-1));
  });

  test('a stamp that is not ours, or unreadable, means it is due', () => {
    for (const text of ['{ nope', '[]', '{"day": 5}', '']) {
      const root = project();
      const spy = starts();

      writeFileSync(join(root, LocalAutoClean.STAMP), text);
      LocalAutoClean.tick({ root, now: NOW, env: {}, start: spy.start });

      expect(spy.calls, text).toHaveLength(1);
    }
  });

  test('nothing happens without .agents/local, with local.autoClean false, or with VULCAN_AUTO_CLEAN=off', () => {
    const spy = starts();
    const bare = createProject({ files: {} });
    const off = project({ manifest: { local: { autoClean: false } } });
    const env = project();

    expect(
      LocalAutoClean.tick({ root: bare, now: NOW, env: {}, start: spy.start }),
    ).toBeUndefined();
    expect(existsSync(join(bare, '.agents'))).toBe(false);
    LocalAutoClean.tick({ root: off, now: NOW, env: {}, start: spy.start });
    LocalAutoClean.tick({
      root: env,
      now: NOW,
      env: { VULCAN_AUTO_CLEAN: 'off' },
      start: spy.start,
    });

    expect(spy.calls).toEqual([]);
    expect(existsSync(join(off, LocalAutoClean.STAMP))).toBe(false);
    expect(existsSync(join(env, LocalAutoClean.STAMP))).toBe(false);
  });

  test('a manifest that is not JSON, or says nothing about it, leaves the clean on', () => {
    const spy = starts();
    const root = createProject({
      files: { '.agents/vulcan.manifest.json': '{ nope', '.agents/local/tmp/.keep': '' },
    });

    LocalAutoClean.tick({ root, now: NOW, env: {}, start: spy.start });
    LocalAutoClean.tick({ root: project({ manifest: {} }), now: NOW, env: {}, start: spy.start });

    expect(spy.calls).toHaveLength(2);
  });

  test('what the last run removed is said once, in one line, by the next session', () => {
    const root = project();
    const spy = starts();

    LocalAutoClean.writeStamp({
      root,
      stamp: {
        day: day(1),
        startedAt: 'x',
        removedFiles: 3,
        removedBytes: 12 * 1024 * 1024,
        reported: false,
      },
    });

    // The next day: the run starts and the line of the last one is printed.
    expect(LocalAutoClean.tick({ root, now: NOW, env: {}, start: spy.start })).toBe(
      'vulcan: cleaned 12.0 MB from .agents/local',
    );
    expect(
      LocalAutoClean.tick({ root, now: NOW + HOUR, env: {}, start: spy.start }),
    ).toBeUndefined();

    // A run that finishes later in the day is said by the next session of that day, once.
    LocalAutoClean.writeStamp({
      root,
      stamp: {
        day: day(0),
        startedAt: 'x',
        removedFiles: 1,
        removedBytes: 5 * 1024,
        reported: false,
      },
    });

    expect(LocalAutoClean.tick({ root, now: NOW + 2 * HOUR, env: {}, start: spy.start })).toBe(
      'vulcan: cleaned 5.0 KB from .agents/local',
    );
    expect(
      LocalAutoClean.tick({ root, now: NOW + 3 * HOUR, env: {}, start: spy.start }),
    ).toBeUndefined();
    expect(spy.calls).toHaveLength(1);
  });

  test('a run that removed nothing prints nothing', () => {
    const root = project();

    LocalAutoClean.writeStamp({
      root,
      stamp: { day: day(0), startedAt: 'x', removedFiles: 0, removedBytes: 0, reported: false },
    });

    expect(LocalAutoClean.tick({ root, now: NOW, env: {}, start: () => {} })).toBeUndefined();
  });

  test('when nothing is due it is a stat and two small reads: far under 100 ms', () => {
    const root = project();

    LocalAutoClean.tick({ root, now: NOW, env: {}, start: () => {} });

    const started = performance.now();

    for (let index = 0; index < 200; index++) {
      LocalAutoClean.tick({ root, now: NOW + index, env: {}, start: () => {} });
    }

    expect((performance.now() - started) / 200).toBeLessThan(20);
  });
});

describe('AutoCleanRun.run: the safe part, and nothing else', () => {
  const week = (): string => {
    const root = project();

    // tmp: one past its day, one fresh.
    put({ root, path: 'tmp/old/a.txt', ago: 3 * DAY });
    put({ root, path: 'tmp/fresh/a.txt', ago: HOUR });
    // A browser's folders: old and young, shown and hidden.
    put({ root, path: 'com.google.Chrome.old1/SingletonSocket', ago: 5 * HOUR });
    put({ root, path: '.com.google.Chrome.hid1/x', ago: 5 * HOUR });
    put({ root, path: 'com.google.Chrome.young/SingletonSocket', ago: 5 * 60_000 });
    // Release candidates: one tagged, one not, one that is not a version.
    git({ cwd: root, args: ['tag', 'v1.0.0'] });
    put({ root, path: 'release-candidates/1.0.0/a.txt' });
    put({ root, path: 'release-candidates/2.0.0/a.txt' });
    put({ root, path: 'release-candidates/notes/a.txt' });
    // Events: past the age, within the limits, today.
    put({ root, path: `events/${EventLog.dayOf({ time: NOW - 60 * DAY })}.jsonl` });
    put({ root, path: `events/${EventLog.dayOf({ time: NOW - 3 * DAY })}.jsonl` });
    put({ root, path: `events/${EventLog.dayOf({ time: NOW })}.jsonl` });
    // What it must never touch, however old: reports, prototypes, a clone, the cache, an unknown file, and a worktree.
    put({ root, path: 'reports/r.md', ago: 90 * DAY });
    put({ root, path: 'prototypes/p.html', ago: 90 * DAY });
    put({ root, path: 'clones/other/README.md', ago: 90 * DAY });
    put({ root, path: 'cache/index', ago: 90 * DAY });
    put({ root, path: 'diag.ts', ago: 90 * DAY });
    git({
      cwd: root,
      args: ['worktree', 'add', '-q', join(root, '.agents/local/worktrees/done'), '-b', 'done'],
    });
    writeFileSync(join(root, '.agents/local/worktrees/done/work.txt'), 'x');
    git({ cwd: join(root, '.agents/local/worktrees/done'), args: ['add', '.'] });
    git({ cwd: join(root, '.agents/local/worktrees/done'), args: ['commit', '-q', '-m', 'work'] });
    git({ cwd: root, args: ['merge', '-q', '--no-ff', '-m', 'merge', 'done'] });
    utimesSync(
      join(root, '.agents/local/worktrees/done'),
      new Date(NOW - 90 * DAY),
      new Date(NOW - 90 * DAY),
    );

    return root;
  };

  test('removes stale tmp, old browser folders, shipped candidates and event files past the limits', () => {
    const root = week();
    const result = AutoCleanRun.run({ root, now: NOW });

    expect(has({ root, path: 'tmp/old' })).toBe(false);
    expect(has({ root, path: 'com.google.Chrome.old1' })).toBe(false);
    expect(has({ root, path: '.com.google.Chrome.hid1' })).toBe(false);
    expect(has({ root, path: 'release-candidates/1.0.0' })).toBe(false);
    expect(has({ root, path: `events/${EventLog.dayOf({ time: NOW - 60 * DAY })}.jsonl` })).toBe(
      false,
    );
    expect(result.files).toBe(5);
    expect(result.bytes).toBeGreaterThan(4 * 2048);
  });

  test('keeps what is fresh, young, unreleased, within the limits or today', () => {
    const root = week();

    AutoCleanRun.run({ root, now: NOW });

    expect(has({ root, path: 'tmp/fresh/a.txt' })).toBe(true);
    expect(has({ root, path: 'com.google.Chrome.young' })).toBe(true);
    expect(has({ root, path: 'release-candidates/2.0.0' })).toBe(true);
    expect(has({ root, path: 'release-candidates/notes' })).toBe(true);
    expect(has({ root, path: `events/${EventLog.dayOf({ time: NOW - 3 * DAY })}.jsonl` })).toBe(
      true,
    );
    expect(has({ root, path: `events/${EventLog.dayOf({ time: NOW })}.jsonl` })).toBe(true);
  });

  test('never a worktree, a clone, the cache, reports, prototypes or an unknown file, however old and however merged', () => {
    const root = week();

    AutoCleanRun.run({ root, now: NOW });

    for (const path of [
      'worktrees/done/work.txt',
      'clones/other/README.md',
      'cache/index',
      'reports/r.md',
      'prototypes/p.html',
      'diag.ts',
    ]) {
      expect(has({ root, path }), path).toBe(true);
    }

    expect(git({ cwd: root, args: ['worktree', 'list'] })).toContain('worktrees/done');
  });

  test("a folder in tmp that holds a repository is somebody's work: a clone, a worktree, a repository deeper down", () => {
    const root = project();
    const old = 3 * DAY;

    // A scratch clone with a commit that was never pushed.
    put({ root, path: 'tmp/clone/README.md', ago: old });
    git({ cwd: join(root, '.agents/local/tmp/clone'), args: ['init', '-q', '-b', 'main'] });
    git({
      cwd: join(root, '.agents/local/tmp/clone'),
      args: ['config', 'user.email', 'a@example.com'],
    });
    git({ cwd: join(root, '.agents/local/tmp/clone'), args: ['config', 'user.name', 'a'] });
    git({ cwd: join(root, '.agents/local/tmp/clone'), args: ['add', '.'] });
    git({
      cwd: join(root, '.agents/local/tmp/clone'),
      args: ['commit', '-q', '-m', 'unpushed work'],
    });
    // A worktree added straight into tmp: its .git is a file.
    git({
      cwd: root,
      args: ['worktree', 'add', '-q', join(root, '.agents/local/tmp/wt'), '-b', 'wt'],
    });
    // A repository two levels down.
    put({ root, path: 'tmp/outer/inner/file.txt', ago: old });
    git({ cwd: join(root, '.agents/local/tmp/outer/inner'), args: ['init', '-q'] });
    // Stale scratch that holds no repository; a .git inside node_modules is a package's, not work.
    put({ root, path: 'tmp/plain/a.txt', ago: old });
    put({ root, path: 'tmp/pkg/node_modules/dep/.git/HEAD', ago: old });

    for (const path of ['tmp/clone', 'tmp/wt', 'tmp/outer', 'tmp/plain', 'tmp/pkg']) {
      ageTree({ path: join(root, '.agents/local', path), ago: old });
    }

    AutoCleanRun.run({ root, now: NOW });

    expect(has({ root, path: 'tmp/clone/.git' })).toBe(true);
    expect(
      git({ cwd: join(root, '.agents/local/tmp/clone'), args: ['log', '--format=%s'] }).trim(),
    ).toBe('unpushed work');
    expect(has({ root, path: 'tmp/wt/.git' })).toBe(true);
    expect(git({ cwd: root, args: ['worktree', 'list'] })).toContain('tmp/wt');
    expect(has({ root, path: 'tmp/outer/inner/.git' })).toBe(true);
    expect(has({ root, path: 'tmp/plain' })).toBe(false);
    expect(has({ root, path: 'tmp/pkg' })).toBe(false);
  });

  test('a folder too big to look through counts as holding a repository, and one that cannot be read stays', () => {
    const big = createProject({ files: {} });

    mkdirSync(join(big, 'a'), { recursive: true });
    writeFileSync(join(big, 'a', 'one'), 'x');
    writeFileSync(join(big, 'a', 'two'), 'x');

    expect(AutoCleanRun.holdsRepository({ path: big })).toBe(false);
    expect(AutoCleanRun.holdsRepository({ path: big, budget: { left: 1 } })).toBe(true);
    expect(AutoCleanRun.holdsRepository({ path: join(big, 'missing') })).toBe(true);
    expect(AutoCleanRun.holdsRepository({ path: join(big, 'a', 'one') })).toBe(false);
  });

  test('the scan the clean uses never looks at worktrees: no git call for them, and none of their entries', () => {
    const root = week();
    const entries = LocalScan.scan({ root, now: NOW, only: ['tmp', 'release-candidates'] });

    expect(new Set(entries.map((entry) => entry.scope))).toEqual(
      new Set(['tmp', 'release-candidates']),
    );
  });

  test('the limits of the project decide the events: maxFiles 2 keeps the newest two', () => {
    const root = project({ manifest: { events: { log: true, maxFiles: 2 } } });

    for (const ago of [4, 3, 2, 1, 0]) {
      put({ root, path: `events/${EventLog.dayOf({ time: NOW - ago * DAY })}.jsonl` });
    }

    AutoCleanRun.run({ root, now: NOW });

    expect(
      [4, 3, 2, 1, 0].filter((ago) =>
        has({ root, path: `events/${EventLog.dayOf({ time: NOW - ago * DAY })}.jsonl` }),
      ),
    ).toEqual([1, 0]);
  });

  test('events are left alone when the log is off and the project set no limit', () => {
    const root = project({ manifest: {} });

    put({ root, path: `events/${EventLog.dayOf({ time: NOW - 60 * DAY })}.jsonl` });
    AutoCleanRun.run({ root, now: NOW });

    expect(has({ root, path: `events/${EventLog.dayOf({ time: NOW - 60 * DAY })}.jsonl` })).toBe(
      true,
    );
  });

  test('a shared events.dir outside the project is kept within the same limits', () => {
    const shared = createProject({ files: {} });
    const root = project({ manifest: { events: { log: true, dir: shared, maxAgeDays: 10 } } });

    writeFileSync(join(shared, `${EventLog.dayOf({ time: NOW - 20 * DAY })}.jsonl`), 'x');
    writeFileSync(join(shared, `${EventLog.dayOf({ time: NOW - 2 * DAY })}.jsonl`), 'x');
    AutoCleanRun.run({ root, now: NOW });

    expect(existsSync(join(shared, `${EventLog.dayOf({ time: NOW - 20 * DAY })}.jsonl`))).toBe(
      false,
    );
    expect(existsSync(join(shared, `${EventLog.dayOf({ time: NOW - 2 * DAY })}.jsonl`))).toBe(true);
  });

  test('the stamp says what went and that nobody has said it yet', () => {
    const root = week();

    LocalAutoClean.writeStamp({
      root,
      stamp: { day: day(0), startedAt: 'x', removedFiles: 0, removedBytes: 0, reported: true },
    });
    AutoCleanRun.run({ root, now: NOW });

    expect(LocalAutoClean.readStamp({ root })).toMatchObject({
      day: day(0),
      removedFiles: 5,
      reported: false,
    });
    expect(LocalAutoClean.readStamp({ root })?.removedBytes).toBeGreaterThan(0);
  });
});

describe('the detached script and the session-start hook', () => {
  const settle = async (check: () => boolean): Promise<boolean> => {
    for (let attempt = 0; attempt < 60; attempt++) {
      if (check()) {
        return true;
      }

      await Bun.sleep(100);
    }

    return false;
  };

  test('the script removes the safe part and fails open on a root that is wrong or missing', () => {
    const root = project();

    put({ root, path: 'tmp/old/a.txt', ago: 3 * DAY });
    put({ root, path: 'tmp/fresh/a.txt', ago: 5 * 60_000 });

    const ok = spawnSyncBounded({
      cmd: [process.execPath, SCRIPT, root],
      stdout: 'pipe',
      stderr: 'pipe',
    });

    expect(ok.exitCode).toBe(0);
    expect(has({ root, path: 'tmp/old' })).toBe(false);
    expect(has({ root, path: 'tmp/fresh/a.txt' })).toBe(true);
    expect(
      spawnSyncBounded({ cmd: [process.execPath, SCRIPT], stdout: 'pipe', stderr: 'pipe' })
        .exitCode,
    ).toBe(0);
    expect(
      spawnSyncBounded({
        cmd: [process.execPath, SCRIPT, join(root, 'nope')],
        stdout: 'pipe',
        stderr: 'pipe',
      }).exitCode,
    ).toBe(0);
  });

  test('a session start cleans in the background, says so once at the next one, and the hook itself does not wait', async () => {
    const root = project();

    put({ root, path: 'tmp/old/a.txt', ago: 3 * DAY });

    const start = (): { code: number; stderr: string; ms: number } => {
      const began = performance.now();
      const child = spawnSyncBounded({
        cmd: [process.execPath, SESSION_START],
        env: { ...process.env, CLAUDE_PROJECT_DIR: root, VULCAN_AUTO_CLEAN: '' },
        stdout: 'pipe',
        stderr: 'pipe',
      });

      return {
        code: child.exitCode ?? 1,
        stderr: child.stderr.toString(),
        ms: performance.now() - began,
      };
    };
    const first = start();

    expect(first.code).toBe(0);
    expect(first.stderr).not.toContain('cleaned');
    expect(existsSync(join(root, LocalAutoClean.STAMP))).toBe(true);
    // The clean is a process of its own: wait for it, then the old folder is gone.
    const result = await settle(
      () =>
        !has({ root, path: 'tmp/old' }) &&
        (LocalAutoClean.readStamp({ root })?.removedBytes ?? 0) > 0,
    );
    expect(result).toBe(true);

    const second = start();
    const third = start();

    expect(second.stderr).toContain('vulcan: cleaned 2.0 KB from .agents/local');
    expect(third.stderr).not.toContain('cleaned');
    expect(readFileSync(join(root, LocalAutoClean.STAMP), 'utf8')).toContain('"reported":true');
  });

  test('a session start with the clean off does not make a stamp', () => {
    const root = project({ manifest: { local: { autoClean: false } } });

    put({ root, path: 'tmp/old/a.txt', ago: 3 * DAY });

    const child = spawnSyncBounded({
      cmd: [process.execPath, SESSION_START],
      env: { ...process.env, CLAUDE_PROJECT_DIR: root },
      stdout: 'pipe',
      stderr: 'pipe',
    });

    expect(child.exitCode).toBe(0);
    expect(existsSync(join(root, LocalAutoClean.STAMP))).toBe(false);
    expect(has({ root, path: 'tmp/old' })).toBe(true);
  });
});

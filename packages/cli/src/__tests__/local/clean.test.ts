import { afterAll, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  truncateSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { ProjectLayout } from '../../common/index.ts';
import { EventLog } from '../../events/log.ts';
import { DoctorRunner } from '../../doctor/index.ts';
import { SocketWarning } from '../doctor/socket-warning.helper.ts';
import { CleanScopes, LocalClean, LocalConstants, LocalScan } from '../../local/index.ts';
import { CLAUDE_LAUNCH_FILE, LaunchSettings } from '../../sync/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';

afterAll(removeProjects);

const CONFIG = "export default { name: 'acme', rules: { 'V-W-01': 'on-user-word' } };\n";
const DAY = 24 * 60 * 60 * 1000;

const git = (opts: { cwd: string; args: string[] }): string => {
  const result = Bun.spawnSync(['git', ...opts.args], { cwd: opts.cwd });

  expect(result.exitCode, `git ${opts.args.join(' ')}: ${result.stderr.toString()}`).toBe(0);

  return result.stdout.toString();
};

/** A git project with the local workspace, on develop with one commit. */
const repository = (): string => {
  const root = createProject({
    files: {
      '.configs/vulcan.config.mts': CONFIG,
      '.gitignore': '.agents/local/\n',
      'package.json': '{}',
    },
  });

  for (const name of ['tmp', 'worktrees', 'clones', 'cache', 'reports', 'prototypes']) {
    mkdirSync(join(root, '.agents/local', name), { recursive: true });
  }

  // What sync leaves in the local folder, so the local-workspace check has nothing to say.
  writeFileSync(join(root, CLAUDE_LAUNCH_FILE), LaunchSettings.renderClaude({ root }));

  git({ cwd: root, args: ['init', '-q', '-b', 'develop'] });
  git({ cwd: root, args: ['config', 'user.email', 'a@example.com'] });
  git({ cwd: root, args: ['config', 'user.name', 'a'] });
  git({ cwd: root, args: ['add', '.'] });
  git({ cwd: root, args: ['commit', '-q', '-m', 'init'] });

  return root;
};

const file = (opts: { root: string; path: string; text?: string; ageDays?: number }): void => {
  const target = join(opts.root, '.agents/local', opts.path);

  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, opts.text ?? 'x');

  if (opts.ageDays !== undefined) {
    const then = new Date(Date.now() - opts.ageDays * DAY);
    const local = join(opts.root, '.agents/local');

    utimesSync(target, then, then);

    // The age of an item is its newest change anywhere inside it: its folders get the date too.
    for (let folder = join(target, '..'); dirname(folder) !== local; folder = dirname(folder)) {
      utimesSync(folder, then, then);
    }
  }
};

/**
 * A worktree on a new branch. `commit` adds a commit of its own; `merged` also merges the branch into the root's
 * branch with a merge commit, the way a pull request lands. A branch with no commit of its own is never merged.
 */
const worktree = (opts: {
  root: string;
  name: string;
  commit?: boolean;
  merged?: boolean;
}): void => {
  git({
    cwd: opts.root,
    args: ['worktree', 'add', '-q', join('.agents/local/worktrees', opts.name), '-b', opts.name],
  });

  if (opts.commit === true || opts.merged === true) {
    const inside = join(opts.root, '.agents/local/worktrees', opts.name);

    writeFileSync(join(inside, `${opts.name}.txt`), 'new');
    git({ cwd: inside, args: ['add', '.'] });
    git({ cwd: inside, args: ['commit', '-q', '-m', 'work'] });
  }

  if (opts.merged === true) {
    git({
      cwd: opts.root,
      args: ['merge', '-q', '--no-ff', '-m', `merge ${opts.name}`, opts.name],
    });
  }
};

const names = (opts: { entries: { scope: string; name: string }[] }): string[] =>
  opts.entries.map((entry) => `${entry.scope}/${entry.name}`).sort();

describe('LocalScan.scan', () => {
  test('lists children with size and age, marks tmp older than a day stale, skips .gitkeep', () => {
    const root = repository();

    file({ root, path: 'tmp/fresh/a.txt', text: 'hello' });
    file({ root, path: 'tmp/old/a.txt', text: 'hello', ageDays: 3 });
    utimesSync(
      join(root, '.agents/local/tmp/old'),
      new Date(Date.now() - 3 * DAY),
      new Date(Date.now() - 3 * DAY),
    );
    file({ root, path: 'tmp/.gitkeep', text: '' });
    file({ root, path: 'clones/r/x.txt', ageDays: 20 });
    utimesSync(
      join(root, '.agents/local/clones/r'),
      new Date(Date.now() - 20 * DAY),
      new Date(Date.now() - 20 * DAY),
    );

    const entries = LocalScan.scan({ root });
    const state = Object.fromEntries(
      entries.map((entry) => [`${entry.scope}/${entry.name}`, entry.state]),
    );

    expect(state).toEqual({ 'tmp/fresh': 'ok', 'tmp/old': 'stale', 'clones/r': 'stale' });
    expect(entries.find((entry) => entry.name === 'fresh')?.bytes).toBe(5);
  });

  test('classifies worktrees: merged, unmerged, gone, orphan', () => {
    const root = repository();

    worktree({ root, name: 'merged-one', merged: true });
    worktree({ root, name: 'unmerged-one', commit: true });
    worktree({ root, name: 'gone-one' });
    git({ cwd: root, args: ['update-ref', '-d', 'refs/heads/gone-one'] });
    mkdirSync(join(root, '.agents/local/worktrees/orphan-one'));

    const state = Object.fromEntries(
      LocalScan.scan({ root })
        .filter((entry) => entry.scope === 'worktrees')
        .map((entry) => [entry.name, [entry.state, entry.removable]]),
    );

    expect(state).toEqual({
      'merged-one': ['merged', true],
      'unmerged-one': ['unmerged', false],
      'gone-one': ['gone', true],
      'orphan-one': ['orphan', true],
    });
  });

  test('a merged worktree with uncommitted or untracked files is dirty and never removable', () => {
    const root = repository();

    worktree({ root, name: 'merged-clean', merged: true });
    worktree({ root, name: 'merged-dirty', merged: true });
    worktree({ root, name: 'merged-untracked', merged: true });
    writeFileSync(join(root, '.agents/local/worktrees/merged-dirty/a.txt'), 'edited');
    writeFileSync(join(root, '.agents/local/worktrees/merged-untracked/new.txt'), 'new');

    const state = Object.fromEntries(
      LocalScan.scan({ root }).map((entry) => [entry.name, [entry.state, entry.removable]]),
    );

    expect(state).toEqual({
      'merged-clean': ['merged', true],
      'merged-dirty': ['dirty', false],
      'merged-untracked': ['dirty', false],
    });

    const result = LocalClean.run({ root, plan: LocalClean.plan({ root, scopes: ['worktrees'] }) });

    expect(names({ entries: result.removed })).toEqual(['worktrees/merged-clean']);
    expect(readFileSync(join(root, '.agents/local/worktrees/merged-dirty/a.txt'), 'utf8')).toBe(
      'edited',
    );
  });

  test('age is the newest change anywhere inside an item, not the folder own time', () => {
    const root = repository();

    file({ root, path: 'tmp/long-task/deep/out.log', text: 'still writing' });
    utimesSync(
      join(root, '.agents/local/tmp/long-task'),
      new Date(Date.now() - 5 * DAY),
      new Date(Date.now() - 5 * DAY),
    );

    const [entry] = LocalScan.scan({ root }).filter((item) => item.name === 'long-task');

    expect(entry?.state).toBe('ok');
  });

  test('a symlinked .agents/local is not scanned', () => {
    const root = createProject({ files: {} });
    const outside = createProject({ files: { 'tmp/a.txt': 'x' } });

    mkdirSync(join(root, '.agents'), { recursive: true });
    symlinkSync(outside, join(root, '.agents/local'));

    expect(LocalScan.scan({ root })).toEqual([]);
  });
});

describe('a link can never move clean out of the project', () => {
  test('a symlinked .agents is not trusted: nothing is scanned, nothing outside is removed', () => {
    const root = createProject({ files: { 'package.json': '{}' } });
    const outside = createProject({ files: { 'local/tmp/x/keep.txt': 'precious' } });

    symlinkSync(outside, join(root, '.agents'));

    expect(LocalScan.localRootOf({ root })).toBeUndefined();
    expect(LocalScan.scan({ root })).toEqual([]);
    expect(LocalScan.isInside({ root, path: join(root, '.agents/local/tmp/x') })).toBe(false);

    const entry = {
      scope: 'tmp',
      name: 'x',
      where: 'tmp/x',
      path: join(root, '.agents/local/tmp/x'),
      bytes: 1,
      ageMs: 0,
      state: 'ok',
      removable: true,
      isSymlink: false,
      registered: false,
      note: '',
    };
    const result = LocalClean.run({ root, plan: { remove: [entry], keep: [] } });

    expect(result.removed).toEqual([]);
    expect(readFileSync(join(outside, 'local/tmp/x/keep.txt'), 'utf8')).toBe('precious');
  });

  test('.agents/local resolves inside the project to be trusted, and only then', () => {
    const root = repository();

    expect(LocalScan.localRootOf({ root })?.endsWith('/.agents/local')).toBe(true);
    expect(LocalScan.localRootOf({ root: createProject({ files: {} }) })).toBeUndefined();
  });

  test('a scope folder that is a file, or a link, is skipped without throwing, in clean and in doctor', async () => {
    const root = repository();
    const outside = createProject({ files: { 'a.txt': 'x' } });

    rmSync(join(root, '.agents/local/tmp'), { recursive: true });
    writeFileSync(join(root, '.agents/local/tmp'), 'not a folder');
    rmSync(join(root, '.agents/local/clones'), { recursive: true });
    symlinkSync(outside, join(root, '.agents/local/clones'));

    expect(() => LocalScan.scan({ root })).not.toThrow();
    expect(
      LocalScan.scan({ root }).filter((entry) => ['tmp', 'clones'].includes(entry.scope)),
    ).toEqual([]);
    expect(() => DoctorRunner.runWarnings({ root })).not.toThrow();
    const result = await DoctorRunner.runNotes({ root });
    expect(result.filter((entry) => entry.file === '.agents/local')).toEqual([]);
  });
});

describe('LocalScan.parseWorktreeList', () => {
  test('reads NUL separated records, a path with a line break whole', () => {
    const output =
      [
        [
          'worktree /repo',
          'HEAD 1111111111111111111111111111111111111111',
          'branch refs/heads/develop',
        ].join('\0'),
        [
          'worktree /repo/.agents/local/worktrees/odd\nname',
          'HEAD 2222222222222222222222222222222222222222',
          'branch refs/heads/odd',
        ].join('\0'),
        [
          'worktree /repo/.agents/local/worktrees/loose',
          'HEAD 3333333333333333333333333333333333333333',
          'detached',
        ].join('\0'),
      ].join('\0\0') + '\0\0';
    const map = LocalScan.parseWorktreeList({ output });

    expect(map.get('/repo/.agents/local/worktrees/odd\nname')?.branch).toBe('odd');
    expect(map.get('/repo/.agents/local/worktrees/loose')).toEqual({
      branch: undefined,
      head: '3333333333333333333333333333333333333333',
    });
    expect(map.get('/repo')?.branch).toBe('develop');
  });
});

describe('LocalClean.plan and runClean', () => {
  test('--all takes tmp, worktrees, clones and cache, never reports, prototypes or the profile; they must be named', () => {
    const root = repository();

    for (const path of [
      'tmp/a/x',
      'clones/c/x',
      'cache/k/x',
      'reports/r.md',
      'prototypes/p.html',
      'profile.json',
    ]) {
      file({ root, path });
    }

    const all = LocalClean.plan({
      root,
      scopes: ['tmp', 'worktrees', 'clones', 'cache'],
      includeFresh: true,
    });

    expect(names({ entries: all.remove })).toEqual(['cache/k', 'clones/c', 'tmp/a']);

    const named = LocalClean.plan({ root, scopes: ['reports', 'prototypes', 'profile'] });

    expect(names({ entries: named.remove })).toEqual([
      'profile/profile.json',
      'prototypes/p.html',
      'reports/r.md',
    ]);
  });

  test('removes a merged, a gone and an orphan worktree, keeps an unmerged one, and prunes git', () => {
    const root = repository();

    worktree({ root, name: 'merged-one', merged: true });
    worktree({ root, name: 'unmerged-one', commit: true });
    worktree({ root, name: 'gone-one' });
    git({ cwd: root, args: ['update-ref', '-d', 'refs/heads/gone-one'] });
    mkdirSync(join(root, '.agents/local/worktrees/orphan-one'));

    const plan = LocalClean.plan({ root, scopes: ['worktrees'] });

    expect(names({ entries: plan.keep })).toEqual(['worktrees/unmerged-one']);

    const result = LocalClean.run({ root, plan });

    expect(result.failed).toEqual([]);
    expect(names({ entries: result.removed })).toEqual([
      'worktrees/gone-one',
      'worktrees/merged-one',
      'worktrees/orphan-one',
    ]);
    expect(existsSync(join(root, '.agents/local/worktrees/merged-one'))).toBe(false);
    expect(existsSync(join(root, '.agents/local/worktrees/unmerged-one'))).toBe(true);

    const listed = git({ cwd: root, args: ['worktree', 'list', '--porcelain'] });

    expect(listed).toContain('/worktrees/unmerged-one');
    expect(listed).not.toContain('/worktrees/merged-one');
    expect(listed).not.toContain('/worktrees/gone-one');
  });

  test('a symlink in a scope is unlinked, its target is never followed or touched', () => {
    const root = repository();
    const outside = createProject({ files: { 'keep.txt': 'precious' } });

    symlinkSync(outside, join(root, '.agents/local/tmp/link'));

    const plan = LocalClean.plan({ root, scopes: ['tmp'], includeFresh: true });
    const result = LocalClean.run({ root, plan });

    expect(result.removed).toHaveLength(1);
    expect(existsSync(join(root, '.agents/local/tmp/link'))).toBe(false);
    expect(readFileSync(join(outside, 'keep.txt'), 'utf8')).toBe('precious');
  });

  test('a path outside .agents/local/ is refused even if a plan names it', () => {
    const root = repository();
    const outside = createProject({ files: { 'keep.txt': 'precious' } });

    expect(LocalScan.isInside({ root, path: join(outside, 'keep.txt') })).toBe(false);
    expect(LocalScan.isInside({ root, path: join(root, 'package.json') })).toBe(false);
    expect(LocalScan.isInside({ root, path: join(root, '.agents/local/tmp/a') })).toBe(true);

    const entry = {
      scope: 'tmp',
      name: 'x',
      where: 'tmp/x',
      path: join(outside, 'keep.txt'),
      bytes: 1,
      ageMs: 0,
      state: 'ok',
      removable: true,
      isSymlink: false,
      registered: false,
      note: '',
    };
    const result = LocalClean.run({ root, plan: { remove: [entry], keep: [] } });

    expect(result.removed).toEqual([]);
    expect(result.failed[0]?.error).toContain('not inside .agents/local');
    expect(readFileSync(join(outside, 'keep.txt'), 'utf8')).toBe('precious');
  });
});

describe('vulcan clean', () => {
  test('is a dry run by default: it lists, and removes nothing', () => {
    const root = repository();

    file({ root, path: 'tmp/job/a.txt', text: 'hello', ageDays: 3 });

    const result = runCli({ args: ['clean'], cwd: root });

    expect(result.code).toBe(0);
    expect(result.stderr).toContain('dry run');
    expect(result.stderr).toContain('tmp/job');
    expect(result.stderr).toContain('would remove 1 item(s)');
    expect(existsSync(join(root, '.agents/local/tmp/job'))).toBe(true);
  });

  test('--yes removes the default scope (tmp) and leaves the other scopes', () => {
    const root = repository();

    file({ root, path: 'tmp/job/a.txt', ageDays: 3 });
    file({ root, path: 'cache/k/a.txt' });
    file({ root, path: 'reports/r.md' });

    const result = runCli({ args: ['clean', '--yes'], cwd: root });

    expect(result.code).toBe(0);
    expect(result.stderr).toContain('removed 1 item(s)');
    expect(existsSync(join(root, '.agents/local/tmp/job'))).toBe(false);
    expect(existsSync(join(root, '.agents/local/cache/k'))).toBe(true);
    expect(existsSync(join(root, '.agents/local/reports/r.md'))).toBe(true);
  });

  test('by default only stale items go: a fresh one is kept with the reason, and --include-fresh takes it', () => {
    const root = repository();

    file({ root, path: 'tmp/old/a.txt', ageDays: 3 });
    file({ root, path: 'tmp/live/a.txt' });
    file({ root, path: 'clones/recent/a.txt', ageDays: 3 });
    file({ root, path: 'clones/old/a.txt', ageDays: 20 });

    const plan = LocalClean.plan({ root, scopes: ['tmp', 'clones'] });

    expect(names({ entries: plan.remove })).toEqual(['clones/old', 'tmp/old']);
    expect(names({ entries: plan.keep })).toEqual(['clones/recent', 'tmp/live']);
    expect(plan.keep.map((entry) => entry.note)).toEqual([
      'fresh (0m): may be in use; --include-fresh removes it',
      'fresh (3d): may be in use; --include-fresh removes it',
    ]);

    const everything = LocalClean.plan({ root, scopes: ['tmp', 'clones'], includeFresh: true });

    expect(names({ entries: everything.remove })).toEqual([
      'clones/old',
      'clones/recent',
      'tmp/live',
      'tmp/old',
    ]);
  });

  test("Claude Code's task folder and the hooks' signals file are never removed, stale or not, with or without the flag", () => {
    const root = repository();

    file({ root, path: 'tmp/claude-1000/tasks/out.txt', ageDays: 9 });
    file({ root, path: 'tmp/b945/x' });
    file({ root, path: 'cache/signals.jsonl', ageDays: 9 });
    file({ root, path: 'cache/atlas/x' });

    for (const includeFresh of [false, true]) {
      const plan = LocalClean.plan({ root, scopes: ['tmp', 'cache'], includeFresh });

      expect(
        names({ entries: plan.keep }).filter(
          (name) => name.includes('claude-') || name.includes('signals'),
        ),
      ).toEqual(['cache/signals.jsonl', 'tmp/claude-1000']);
      expect(
        names({ entries: plan.remove }).filter(
          (name) => name.includes('claude-') || name.includes('signals'),
        ),
      ).toEqual([]);
    }

    const result = runCli({ args: ['clean', '--all', '--include-fresh', '--yes'], cwd: root });

    expect(result.code).toBe(0);
    expect(result.stderr).toContain('in use');
    expect(existsSync(join(root, '.agents/local/tmp/claude-1000/tasks/out.txt'))).toBe(true);
    expect(existsSync(join(root, '.agents/local/cache/signals.jsonl'))).toBe(true);
    expect(existsSync(join(root, '.agents/local/tmp/b945'))).toBe(false);
    expect(existsSync(join(root, '.agents/local/cache/atlas'))).toBe(false);
  });

  test('vulcan clean --yes leaves a fresh item and says why; --include-fresh --yes takes it', () => {
    const root = repository();

    file({ root, path: 'tmp/live/a.txt' });

    const kept = runCli({ args: ['clean', '--yes'], cwd: root });

    expect(kept.code).toBe(0);
    expect(kept.stderr).toContain('kept tmp/live');
    expect(kept.stderr).toContain('--include-fresh');
    expect(existsSync(join(root, '.agents/local/tmp/live'))).toBe(true);

    const taken = runCli({ args: ['clean', '--include-fresh', '--yes'], cwd: root });

    expect(taken.code).toBe(0);
    expect(taken.stderr).toContain('removed 1 item(s)');
    expect(existsSync(join(root, '.agents/local/tmp/live'))).toBe(false);
  });

  test('--all --yes sweeps what can be recreated and keeps reports; --reports names them', () => {
    const root = repository();

    file({ root, path: 'tmp/a/x', ageDays: 3 });
    file({ root, path: 'cache/k/x' });
    file({ root, path: 'reports/r.md' });

    expect(runCli({ args: ['clean', '--all', '--yes'], cwd: root }).code).toBe(0);
    expect(existsSync(join(root, '.agents/local/cache/k'))).toBe(false);
    expect(existsSync(join(root, '.agents/local/reports/r.md'))).toBe(true);
    expect(runCli({ args: ['clean', '--reports', '--yes'], cwd: root }).code).toBe(0);
    expect(existsSync(join(root, '.agents/local/reports/r.md'))).toBe(false);
  });

  test('says what is kept and why, and refuses an unknown flag', () => {
    const root = repository();

    worktree({ root, name: 'busy', commit: true });

    const kept = runCli({ args: ['clean', '--worktrees', '--yes'], cwd: root });

    expect(kept.stderr).toContain('kept worktrees/busy');
    expect(kept.stderr).toContain('not merged');
    expect(existsSync(join(root, '.agents/local/worktrees/busy'))).toBe(true);
    expect(runCli({ args: ['clean', '--everything'], cwd: root }).code).not.toBe(0);
  });

  test('with nothing there it says so', () => {
    const root = repository();
    const result = runCli({ args: ['clean'], cwd: root });

    expect(result.code).toBe(0);
    expect(result.stderr).toContain('nothing to remove');
  });
});

describe('doctor and what an agent left behind', () => {
  test('warns about stale tmp, a merged worktree and an old clone, each with the command', async () => {
    const root = repository();

    file({ root, path: 'tmp/old/a.txt', ageDays: 3 });
    utimesSync(
      join(root, '.agents/local/tmp/old'),
      new Date(Date.now() - 3 * DAY),
      new Date(Date.now() - 3 * DAY),
    );
    worktree({ root, name: 'done', merged: true });

    const result2 = await DoctorRunner.runWarnings({ root });
    const result = SocketWarning.without({ warnings: result2 });
    const warnings = result.filter((entry) => entry.file.startsWith('.agents/local/'));

    expect(warnings.map((entry) => entry.file).sort()).toEqual([
      '.agents/local/tmp/old',
      '.agents/local/worktrees/done',
    ]);
    expect(warnings.find((entry) => entry.file.endsWith('tmp/old'))?.message).toContain(
      'vulcan clean --tmp --yes',
    );
    expect(warnings.find((entry) => entry.file.endsWith('done'))?.message).toContain(
      'vulcan clean --worktrees --yes',
    );
  });

  test('is quiet about fresh tmp and an unmerged worktree', async () => {
    const root = repository();

    file({ root, path: 'tmp/fresh/a.txt' });
    worktree({ root, name: 'busy', commit: true });

    const result2 = await DoctorRunner.runWarnings({ root });
    const result = SocketWarning.without({ warnings: result2 });
    expect(result.filter((entry) => entry.file.startsWith('.agents/local/'))).toEqual([]);
  });

  test('prints the size of .agents/local/ once it is large, with where it went', async () => {
    const root = repository();

    file({ root, path: 'cache/big', text: '' });
    truncateSync(join(root, '.agents/local/cache/big'), 60 * 1024 * 1024);

    const notes = await DoctorRunner.runNotes({ root });
    const [note] = notes.filter((entry) => entry.file === '.agents/local');

    expect(note?.message).toContain('holds 60.0 MB');
    expect(note?.message).toContain('cache 60.0 MB');
    const result = await DoctorRunner.runNotes({ root: repository() });
    expect(result.filter((entry) => entry.file === '.agents/local')).toEqual([]);
  });
});

describe("the layout: on-demand folders, release candidates, events and a browser's scratch folders", () => {
  const HOUR = 60 * 60 * 1000;
  const tagged = (opts: { root: string; version: string }): void => {
    git({ cwd: opts.root, args: ['tag', `v${opts.version}`] });
  };
  const old = (opts: { root: string; path: string; hours: number }): void => {
    const target = join(opts.root, '.agents/local', opts.path);
    const then = new Date(Date.now() - opts.hours * HOUR);

    utimesSync(join(target, 'SingletonSocket'), then, then);
    utimesSync(target, then, then);
  };
  const chrome = (opts: { root: string; name: string; hours: number }): void => {
    file({ root: opts.root, path: `${opts.name}/SingletonSocket`, text: 's' });
    old({ root: opts.root, path: opts.name, hours: opts.hours });
  };

  test('agents, events and release-candidates are layout folders that sync does not create', () => {
    const layoutNames = ProjectLayout.LOCAL_LAYOUT.map((entry) => entry.name);

    expect(layoutNames).toEqual(expect.arrayContaining(['agents', 'events', 'release-candidates']));
    expect(
      ProjectLayout.LOCAL_LAYOUT.filter((entry) => 'onDemand' in entry).map((entry) => entry.name),
    ).toEqual(['agents', 'events', 'release-candidates']);
  });

  test('a release candidate is removable once its version is tagged, kept until then, and never in --all', () => {
    const root = repository();

    file({ root, path: 'release-candidates/0.4.6/a.txt' });
    file({ root, path: 'release-candidates/0.4.7/a.txt' });
    tagged({ root, version: '0.4.6' });

    const entries = LocalScan.scan({ root }).filter(
      (entry) => entry.scope === 'release-candidates',
    );
    const byName = Object.fromEntries(entries.map((entry) => [entry.name, entry]));

    expect(byName['0.4.6']).toMatchObject({ state: 'shipped', removable: true });
    expect(byName['0.4.7']).toMatchObject({ state: 'ok', removable: false });
    expect(byName['0.4.7'].note).toContain('not tagged yet');
    expect(
      LocalClean.plan({ root, scopes: ['tmp', 'worktrees', 'clones', 'cache'] }).remove,
    ).toEqual([]);

    const dry = runCli({ args: ['clean', '--release-candidates'], cwd: root });

    expect(dry.stderr).toContain('release-candidates/0.4.6');
    expect(dry.stderr).toContain('kept release-candidates/0.4.7');
    expect(existsSync(join(root, '.agents/local/release-candidates/0.4.6'))).toBe(true);

    expect(runCli({ args: ['clean', '--release-candidates', '--yes'], cwd: root }).code).toBe(0);
    expect(existsSync(join(root, '.agents/local/release-candidates/0.4.6'))).toBe(false);
    expect(existsSync(join(root, '.agents/local/release-candidates/0.4.7'))).toBe(true);
  });

  test('a tag without the v counts, and doctor says a shipped candidate can go', async () => {
    const root = repository();

    file({ root, path: 'release-candidates/1.0.0/a.txt' });
    git({ cwd: root, args: ['tag', '1.0.0'] });

    const result = await DoctorRunner.runWarnings({ root });
    const warnings = result.filter((entry) => entry.file.includes('release-candidates'));

    expect(warnings).toHaveLength(1);
    expect(warnings[0].file).toBe('.agents/local/release-candidates/1.0.0');
    expect(warnings[0].message).toContain('the release shipped');
    expect(warnings[0].message).toContain('vulcan clean --release-candidates --yes');
  });

  test('only a version can be a release candidate, and only a tag of that exact name ships it', () => {
    const root = repository();

    git({ cwd: root, args: ['tag', '1.0.0'] });
    git({ cwd: root, args: ['tag', 'v2.0.0-rc.1'] });

    for (const name of [
      '1.0.0',
      '1.0.0~0',
      '1.0.0^',
      'v2.0.0-rc.1',
      'latest',
      '1.0',
      'HEAD',
      'v1.0.0',
    ]) {
      file({ root, path: `release-candidates/${name}/a.txt` });
    }

    const byName = Object.fromEntries(
      LocalScan.scan({ root })
        .filter((entry) => entry.scope === 'release-candidates')
        .map((entry) => [entry.name, entry]),
    );

    // v1.0.0 has no tag of its own, but 1.0.0 does: either spelling of the version names the same release.
    expect(
      Object.entries(byName)
        .filter(([, entry]) => entry.removable)
        .map(([name]) => name)
        .sort(),
    ).toEqual(['1.0.0', 'v1.0.0', 'v2.0.0-rc.1']);

    for (const name of ['1.0.0~0', '1.0.0^', 'latest', '1.0', 'HEAD']) {
      expect(byName[name], name).toMatchObject({ state: 'ok', removable: false });
      expect(byName[name].note, name).toContain('is not a version');
    }

    runCli({ args: ['clean', '--release-candidates', '--yes'], cwd: root });

    expect(existsSync(join(root, '.agents/local/release-candidates/1.0.0~0/a.txt'))).toBe(true);
    expect(existsSync(join(root, '.agents/local/release-candidates/HEAD/a.txt'))).toBe(true);
    expect(existsSync(join(root, '.agents/local/release-candidates/1.0.0'))).toBe(false);
  });

  test('a new branch with no commit of its own is never merged, and clean keeps its worktree and its .env', () => {
    const root = repository();

    worktree({ root, name: 'fresh' });
    writeFileSync(join(root, '.agents/local/worktrees/fresh/.env'), 'SECRET=1');

    const entry = LocalScan.scan({ root }).find((candidate) => candidate.name === 'fresh');

    expect(entry).toMatchObject({ state: 'unmerged', removable: false });
    expect(entry?.note).toContain('has no commits of its own yet');
    expect(runCli({ args: ['clean', '--worktrees'], cwd: root }).stderr).toContain(
      'kept worktrees/fresh',
    );
    expect(runCli({ args: ['clean', '--worktrees', '--yes'], cwd: root }).code).toBe(0);
    expect(readFileSync(join(root, '.agents/local/worktrees/fresh/.env'), 'utf8')).toBe('SECRET=1');
  });

  test('a merged worktree is kept when it holds an ignored file a build cannot make again, and the note names it', () => {
    const root = repository();

    writeFileSync(
      join(root, '.gitignore'),
      '.agents/local/\n.env\n*.db\nnode_modules/\ndist/\n.turbo/\ncoverage/\n.cache/\n*.tsbuildinfo\n',
    );
    git({ cwd: root, args: ['commit', '-q', '-am', 'ignore'] });
    worktree({ root, name: 'rebuildable', merged: true });
    worktree({ root, name: 'secret', merged: true });
    worktree({ root, name: 'many', merged: true });
    worktree({ root, name: 'gone-secret' });

    const inside = (name: string, path: string, text = 'x'): void => {
      const target = join(root, '.agents/local/worktrees', name, path);

      mkdirSync(join(target, '..'), { recursive: true });
      writeFileSync(target, text);
    };

    for (const name of ['rebuildable', 'secret', 'many']) {
      inside(name, 'node_modules/dep/index.js');
      inside(name, 'packages/a/node_modules/x.js');
      inside(name, 'dist/out.js');
      inside(name, '.turbo/cache');
      inside(name, 'coverage/lcov.info');
      inside(name, '.cache/z');
      inside(name, 'packages/a/tsconfig.tsbuildinfo');
    }

    inside('secret', '.env', 'SECRET=1');
    inside('many', '.env');
    inside('many', 'a.db');
    inside('many', 'b.db');
    inside('many', 'c.db');
    inside('many', 'd.db');
    inside('many', 'e.db');
    inside('gone-secret', '.env', 'SECRET=2');
    git({ cwd: root, args: ['update-ref', '-d', 'refs/heads/gone-secret'] });

    const byName = Object.fromEntries(
      LocalScan.scan({ root })
        .filter((entry) => entry.scope === 'worktrees')
        .map((entry) => [entry.name, entry]),
    );

    expect(byName.rebuildable).toMatchObject({ state: 'merged', removable: true });
    expect(byName.secret).toMatchObject({ state: 'dirty', removable: false });
    expect(byName.secret.note).toContain('ignored files that are not rebuildable: .env');
    expect(byName.secret.note).not.toContain('node_modules');
    expect(byName.many.note).toContain('and 1 more');
    expect(byName['gone-secret']).toMatchObject({ state: 'dirty', removable: false });
    expect(byName['gone-secret'].note).toContain('.env');

    const dry = runCli({ args: ['clean', '--worktrees'], cwd: root }).stderr;

    expect(dry).toContain('kept worktrees/secret');
    expect(dry).toContain('.env');

    runCli({ args: ['clean', '--worktrees', '--yes'], cwd: root });

    expect(existsSync(join(root, '.agents/local/worktrees/rebuildable'))).toBe(false);
    expect(readFileSync(join(root, '.agents/local/worktrees/secret/.env'), 'utf8')).toBe(
      'SECRET=1',
    );
    expect(readFileSync(join(root, '.agents/local/worktrees/gone-secret/.env'), 'utf8')).toBe(
      'SECRET=2',
    );
  });

  test('a path in the note of a kept worktree is named once, however git lists it', () => {
    const root = repository();

    writeFileSync(join(root, '.gitignore'), '.agents/local/\n.env\nnode_modules/\n');
    git({ cwd: root, args: ['commit', '-q', '-am', 'ignore'] });
    worktree({ root, name: 'deep', merged: true });

    for (const path of ['apps/web/.env', 'apps/web/node_modules/dep/index.js', '.env']) {
      const target = join(root, '.agents/local/worktrees/deep', path);

      mkdirSync(join(target, '..'), { recursive: true });
      writeFileSync(target, 'x');
    }

    const note = LocalScan.scan({ root }).find((entry) => entry.name === 'deep')?.note ?? '';
    const listed = note.split('not rebuildable: ')[1]?.split(', ') ?? [];

    expect(listed.sort()).toEqual(['.env', 'apps/web/.env']);
  });

  test('either spelling of the tag ships the folder: 3.0.0 goes when only v3.0.0 exists', () => {
    const root = repository();

    git({ cwd: root, args: ['tag', 'v3.0.0'] });
    file({ root, path: 'release-candidates/3.0.0/a.txt' });

    expect(LocalScan.scan({ root }).find((entry) => entry.name === '3.0.0')).toMatchObject({
      state: 'shipped',
      removable: true,
    });
  });

  test('events are removed only when named, never by --all, and then only what the limits say: not today, not a recent day', () => {
    const root = repository();
    const day = (ago: number): string => EventLog.dayOf({ time: Date.now() - ago * DAY });
    const files = [`events/${day(60)}.jsonl`, `events/${day(5)}.jsonl`, `events/${day(0)}.jsonl`];

    for (const path of files) {
      file({ root, path, text: '{}\n' });
    }

    const exists = (path: string): boolean => existsSync(join(root, '.agents/local', path));

    expect(
      LocalClean.plan({ root, scopes: ['tmp', 'worktrees', 'clones', 'cache'] }).remove,
    ).toEqual([]);
    expect(runCli({ args: ['clean', '--all', '--yes'], cwd: root }).code).toBe(0);
    expect(files.every(exists)).toBe(true);

    const dry = runCli({ args: ['clean', '--events'], cwd: root }).stderr;

    expect(dry).toContain(`events/${day(60)}.jsonl`);
    expect(dry).toContain('older than 30 days');
    expect(dry).toContain(`kept events/${day(5)}.jsonl`);
    expect(runCli({ args: ['clean', '--events', '--yes'], cwd: root }).code).toBe(0);
    expect(exists(files[0])).toBe(false);
    expect(exists(files[1])).toBe(true);
    expect(exists(files[2])).toBe(true);
  });

  test("a browser's scratch folder under .agents/local: tmp scope, by its own name, old ones only", () => {
    const root = repository();

    chrome({ root, name: 'com.google.Chrome.old111', hours: 5 });
    chrome({ root, name: 'org.chromium.Chromium.old222', hours: 5 });
    chrome({ root, name: '.com.google.Chrome.hidden4', hours: 5 });
    chrome({ root, name: 'com.google.Chrome.new333', hours: 0 });
    file({ root, path: 'not-a-browser/x.txt', text: 'x' });

    const entries = LocalScan.scan({ root }).filter((entry) => entry.scope === 'tmp');
    const byName = Object.fromEntries(entries.map((entry) => [entry.name, entry]));

    expect(Object.keys(byName).sort()).toEqual([
      '.com.google.Chrome.hidden4',
      'com.google.Chrome.new333',
      'com.google.Chrome.old111',
      'org.chromium.Chromium.old222',
    ]);
    expect(byName['com.google.Chrome.old111']).toMatchObject({
      removable: true,
      state: 'stale',
      where: 'com.google.Chrome.old111',
    });
    expect(byName['com.google.Chrome.new333']).toMatchObject({ removable: false, state: 'ok' });
    expect(byName['com.google.Chrome.new333'].note).toContain('may be using it');

    const dry = runCli({ args: ['clean'], cwd: root });

    expect(dry.stderr).toContain('  com.google.Chrome.old111  ');
    expect(dry.stderr).toContain('kept com.google.Chrome.new333');
    expect(existsSync(join(root, '.agents/local/com.google.Chrome.old111'))).toBe(true);

    expect(runCli({ args: ['clean', '--yes'], cwd: root }).code).toBe(0);
    expect(existsSync(join(root, '.agents/local/com.google.Chrome.old111'))).toBe(false);
    expect(existsSync(join(root, '.agents/local/org.chromium.Chromium.old222'))).toBe(false);
    expect(existsSync(join(root, '.agents/local/.com.google.Chrome.hidden4'))).toBe(false);
    expect(existsSync(join(root, '.agents/local/com.google.Chrome.new333'))).toBe(true);
    expect(existsSync(join(root, '.agents/local/not-a-browser/x.txt'))).toBe(true);
  });

  test('doctor warns about entries it does not know, by name and size, and never removes them', async () => {
    const root = repository();

    file({ root, path: 'diag.ts', text: 'x'.repeat(2048) });
    file({ root, path: 'scope.txt', text: 'x' });
    file({ root, path: 'audit/report.md', text: 'x' });
    file({ root, path: 'profile.json', text: '{}' });
    file({ root, path: 'violations.jsonl', text: '' });
    chrome({ root, name: 'com.google.Chrome.xyz', hours: 5 });

    expect(LocalScan.unknown({ root }).map((entry) => entry.name)).toEqual([
      'audit',
      'diag.ts',
      'scope.txt',
    ]);

    const result = await DoctorRunner.runWarnings({ root });
    const warnings = result.filter((entry) => entry.file.startsWith('.agents/local/'));
    const unknown = warnings.filter((entry) =>
      entry.message.startsWith('not an entry VULCAN knows'),
    );

    expect(unknown.map((entry) => entry.file)).toEqual([
      '.agents/local/audit',
      '.agents/local/diag.ts',
      '.agents/local/scope.txt',
    ]);
    expect(unknown.find((entry) => entry.file.endsWith('diag.ts'))?.message).toContain('2.0 KB');
    expect(unknown[0].message).toContain(
      'put scratch in tmp/ and what you want to keep in reports/',
    );
    expect(unknown[0].message).toContain('what one agent keeps for itself in agents/<name>/');
    expect(unknown[0].message).toContain(
      'a script the team relies on belongs in the tracked tree (scripts/)',
    );

    // The browser folder is expired tmp, not unknown, and the command that takes it is named.
    const chromeWarning = warnings.find((entry) => entry.file.endsWith('com.google.Chrome.xyz'));

    expect(chromeWarning?.message).toContain('vulcan clean --tmp --yes');
    expect(existsSync(join(root, '.agents/local/diag.ts'))).toBe(true);
    expect(runCli({ args: ['clean', '--all', '--yes'], cwd: root }).code).toBe(0);
    expect(existsSync(join(root, '.agents/local/diag.ts'))).toBe(true);
    expect(existsSync(join(root, '.agents/local/audit/report.md'))).toBe(true);
  });

  test('the folder of one agent is known, kept by every clean, and never a warning', async () => {
    const root = repository();

    file({ root, path: 'agents/scout/notes.md', text: 'x'.repeat(2048), ageDays: 90 });

    const warnings = await DoctorRunner.runWarnings({ root });

    expect(LocalScan.unknown({ root })).toEqual([]);
    expect(warnings.filter((entry) => entry.file.includes('agents/scout'))).toEqual([]);
    expect(runCli({ args: ['clean', '--all', '--yes'], cwd: root }).code).toBe(0);
    expect(existsSync(join(root, '.agents/local/agents/scout/notes.md'))).toBe(true);
  });

  test('a repository with only the layout folders has nothing unknown', async () => {
    const root = repository();

    mkdirSync(join(root, '.agents/local/events'), { recursive: true });
    mkdirSync(join(root, '.agents/local/release-candidates'), { recursive: true });

    expect(LocalScan.unknown({ root })).toEqual([]);
  });

  test('a worktree whose branch is merged into origin/develop is removable though the root is on another branch', () => {
    const root = repository();
    const remote = createProject({ files: {} });

    git({ cwd: remote, args: ['init', '-q', '--bare', '-b', 'develop'] });
    git({ cwd: root, args: ['remote', 'add', 'origin', remote] });
    git({ cwd: root, args: ['push', '-q', 'origin', 'develop'] });
    git({ cwd: root, args: ['fetch', '-q', 'origin'] });
    worktree({ root, name: 'shipped', commit: true });
    git({ cwd: root, args: ['checkout', '-q', '-b', 'elsewhere'] });
    // The branch lands on origin/develop (as a merged pull request would), the root never merged it.
    git({ cwd: root, args: ['push', '-q', 'origin', 'shipped:develop'] });
    git({ cwd: root, args: ['fetch', '-q', 'origin'] });

    const entry = LocalScan.scan({ root }).find((candidate) => candidate.name === 'shipped');

    expect(entry).toMatchObject({ state: 'merged', removable: true });
    expect(entry?.note).toContain('merged into origin/develop');
  });

  test('the layout, the clean flags and the docs agree', () => {
    const REPO = join(import.meta.dir, '..', '..', '..', '..', '..');
    const page = readFileSync(
      join(REPO, 'docs/wiki/content/guides/core-concepts/the-agents-folder.md'),
      'utf8',
    );
    const clean = readFileSync(
      join(REPO, 'docs/wiki/content/references/commands/clean.md'),
      'utf8',
    );
    const concept = readFileSync(
      join(REPO, '.agents/knowledge/architecture/agents-folder.md'),
      'utf8',
    );

    for (const entry of ProjectLayout.LOCAL_LAYOUT) {
      // The tree, the table of lifetimes and the knowledge concept each name the folder.
      expect(page, entry.name).toContain(
        `├── ${entry.name}/`.replace('├', page.includes(`└── ${entry.name}/`) ? '└' : '├'),
      );
      expect(page, entry.name).toContain(`| \`${entry.name}/\` |`);
      expect(concept, entry.name).toContain(entry.name);
    }

    // Every folder with a scope has a flag the clean page documents, and the router accepts it.
    for (const scope of CleanScopes.SCHEME_SET) {
      expect(clean, scope).toContain(`--${scope}`);
      expect(
        runCli({ args: ['clean', `--${scope}`], cwd: repository() }).stderr,
        scope,
      ).not.toContain('unknown argument');
    }

    for (const name of LocalConstants.KNOWN_FILES) {
      if (name !== '.gitkeep') {
        expect(page, name).toContain(name);
      }
    }
  });

  test('a worktree with uncommitted work or an unmerged branch is still kept', () => {
    const root = repository();

    worktree({ root, name: 'unmerged', commit: true });
    worktree({ root, name: 'dirty', merged: true });
    writeFileSync(join(root, '.agents/local/worktrees/dirty/scratch.txt'), 'x');

    const byName = Object.fromEntries(
      LocalScan.scan({ root })
        .filter((entry) => entry.scope === 'worktrees')
        .map((entry) => [entry.name, entry]),
    );

    expect(byName.unmerged).toMatchObject({ state: 'unmerged', removable: false });
    expect(byName.dirty).toMatchObject({ state: 'dirty', removable: false });
  });
});

describe('vulcan clean --events and the configured log', () => {
  const day = (ago: number): string => EventLog.dayOf({ time: Date.now() - ago * DAY });
  const shared = (opts: { manifest?: object; days: number[] }): { root: string; dir: string } => {
    const dir = createProject({ files: {} });
    const root = repository();

    writeFileSync(
      join(root, '.agents/vulcan.manifest.json'),
      JSON.stringify({ events: { log: true, dir, ...opts.manifest } }),
    );

    for (const ago of opts.days) {
      writeFileSync(join(dir, `${day(ago)}.jsonl`), '{}\n');
    }

    return { root, dir };
  };

  test('the day files of events.dir are listed by their path and removed by the limits of the project', () => {
    const { root, dir } = shared({ days: [60, 5, 0] });
    const dry = runCli({ args: ['clean', '--events'], cwd: root }).stderr;

    expect(dry).toContain(`${dir}/${day(60)}.jsonl`);
    expect(dry).toContain('older than 30 days');
    expect(existsSync(join(dir, `${day(60)}.jsonl`))).toBe(true);
    expect(runCli({ args: ['clean', '--events', '--yes'], cwd: root }).code).toBe(0);
    expect(existsSync(join(dir, `${day(60)}.jsonl`))).toBe(false);
    expect(existsSync(join(dir, `${day(5)}.jsonl`))).toBe(true);
    expect(existsSync(join(dir, `${day(0)}.jsonl`))).toBe(true);
  });

  test('the limits of the manifest apply: maxFiles 1 keeps only today', () => {
    const { root, dir } = shared({ manifest: { maxFiles: 1 }, days: [4, 3, 0] });

    runCli({ args: ['clean', '--events', '--yes'], cwd: root });

    expect([4, 3, 0].filter((ago) => existsSync(join(dir, `${day(ago)}.jsonl`)))).toEqual([0]);
  });

  test('--all never reaches it, and a project folder named events/ is not read when events.dir is set', () => {
    const { root, dir } = shared({ days: [60] });

    file({ root, path: `events/${day(60)}.jsonl`, text: '{}\n' });
    runCli({ args: ['clean', '--all', '--yes'], cwd: root });

    expect(existsSync(join(dir, `${day(60)}.jsonl`))).toBe(true);

    runCli({ args: ['clean', '--events', '--yes'], cwd: root });

    expect(existsSync(join(dir, `${day(60)}.jsonl`))).toBe(false);
    expect(existsSync(join(root, `.agents/local/events/${day(60)}.jsonl`))).toBe(true);
  });

  test('a plan that names anything but a day file in that folder is refused', () => {
    const { root, dir } = shared({ days: [0] });

    writeFileSync(join(dir, 'notes.txt'), 'keep');
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'sub', `${day(60)}.jsonl`), 'keep');

    const entry = (path: string) => ({
      scope: 'events',
      name: 'x',
      where: path,
      path,
      bytes: 1,
      ageMs: 0,
      state: 'ok',
      removable: true,
      isSymlink: false,
      registered: false,
      note: '',
      outside: true,
    });
    const result = LocalClean.run({
      root,
      plan: {
        remove: [
          entry(join(dir, 'notes.txt')),
          entry(join(dir, 'sub', `${day(60)}.jsonl`)),
          entry(join(root, 'package.json')),
        ],
        keep: [],
      },
    });

    expect(result.removed).toEqual([]);
    expect(result.failed).toHaveLength(3);
    expect(readFileSync(join(dir, 'notes.txt'), 'utf8')).toBe('keep');
    expect(existsSync(join(root, 'package.json'))).toBe(true);
  });
});

describe('what a live session uses is not stale to doctor either', () => {
  test('a stale task folder of Claude Code is kept by clean and not reported by doctor; a look-alike name is a normal item', async () => {
    const root = repository();

    file({ root, path: 'tmp/claude-1000/tasks/out.txt', ageDays: 9 });
    file({ root, path: 'tmp/claude-notes/a.txt', ageDays: 9 });

    const plan = LocalClean.plan({ root, scopes: ['tmp'] });

    expect(names({ entries: plan.keep })).toEqual(['tmp/claude-1000']);
    expect(names({ entries: plan.remove })).toEqual(['tmp/claude-notes']);

    const result = await DoctorRunner.runWarnings({ root });
    const warned = SocketWarning.without({ warnings: result }).map((entry) => entry.file);

    expect(warned).toContain('.agents/local/tmp/claude-notes');
    expect(warned.some((path) => path.includes('claude-1000'))).toBe(false);
  });
});

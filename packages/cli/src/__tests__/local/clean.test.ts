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
import { join } from 'node:path';
import { runDoctorNotes, runDoctorWarnings } from '../../doctor/index.ts';
import {
  isInsideLocal,
  localRootOf,
  parseWorktreeList,
  planClean,
  runClean,
  scanLocal,
} from '../../local/index.ts';
import { CLAUDE_LAUNCH_FILE, renderClaudeLaunch } from '../../sync/index.ts';
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
      '.configs/vulcan.config.ts': CONFIG,
      '.gitignore': '.agents/local/\n',
      'package.json': '{}',
    },
  });

  for (const name of ['tmp', 'worktrees', 'clones', 'cache', 'reports', 'prototypes']) {
    mkdirSync(join(root, '.agents/local', name), { recursive: true });
  }

  // What sync leaves in the local folder, so the local-workspace check has nothing to say.
  writeFileSync(join(root, CLAUDE_LAUNCH_FILE), renderClaudeLaunch({ root }));

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

    utimesSync(target, then, then);
  }
};

const worktree = (opts: { root: string; name: string; commit?: boolean }): void => {
  git({
    cwd: opts.root,
    args: ['worktree', 'add', '-q', join('.agents/local/worktrees', opts.name), '-b', opts.name],
  });

  if (opts.commit === true) {
    const inside = join(opts.root, '.agents/local/worktrees', opts.name);

    writeFileSync(join(inside, 'new.txt'), 'new');
    git({ cwd: inside, args: ['add', '.'] });
    git({ cwd: inside, args: ['commit', '-q', '-m', 'work'] });
  }
};

const names = (opts: { entries: { scope: string; name: string }[] }): string[] =>
  opts.entries.map((entry) => `${entry.scope}/${entry.name}`).sort();

describe('scanLocal', () => {
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

    const entries = scanLocal({ root });
    const state = Object.fromEntries(
      entries.map((entry) => [`${entry.scope}/${entry.name}`, entry.state]),
    );

    expect(state).toEqual({ 'tmp/fresh': 'ok', 'tmp/old': 'stale', 'clones/r': 'stale' });
    expect(entries.find((entry) => entry.name === 'fresh')?.bytes).toBe(5);
  });

  test('classifies worktrees: merged, unmerged, gone, orphan', () => {
    const root = repository();

    worktree({ root, name: 'merged-one' });
    worktree({ root, name: 'unmerged-one', commit: true });
    worktree({ root, name: 'gone-one' });
    git({ cwd: root, args: ['update-ref', '-d', 'refs/heads/gone-one'] });
    mkdirSync(join(root, '.agents/local/worktrees/orphan-one'));

    const state = Object.fromEntries(
      scanLocal({ root })
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

    worktree({ root, name: 'merged-clean' });
    worktree({ root, name: 'merged-dirty' });
    worktree({ root, name: 'merged-untracked' });
    writeFileSync(join(root, '.agents/local/worktrees/merged-dirty/a.txt'), 'edited');
    writeFileSync(join(root, '.agents/local/worktrees/merged-untracked/new.txt'), 'new');

    const state = Object.fromEntries(
      scanLocal({ root }).map((entry) => [entry.name, [entry.state, entry.removable]]),
    );

    expect(state).toEqual({
      'merged-clean': ['merged', true],
      'merged-dirty': ['dirty', false],
      'merged-untracked': ['dirty', false],
    });

    const result = runClean({ root, plan: planClean({ root, scopes: ['worktrees'] }) });

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

    const [entry] = scanLocal({ root }).filter((item) => item.name === 'long-task');

    expect(entry?.state).toBe('ok');
  });

  test('a symlinked .agents/local is not scanned', () => {
    const root = createProject({ files: {} });
    const outside = createProject({ files: { 'tmp/a.txt': 'x' } });

    mkdirSync(join(root, '.agents'), { recursive: true });
    symlinkSync(outside, join(root, '.agents/local'));

    expect(scanLocal({ root })).toEqual([]);
  });
});

describe('a link can never move clean out of the project', () => {
  test('a symlinked .agents is not trusted: nothing is scanned, nothing outside is removed', () => {
    const root = createProject({ files: { 'package.json': '{}' } });
    const outside = createProject({ files: { 'local/tmp/x/keep.txt': 'precious' } });

    symlinkSync(outside, join(root, '.agents'));

    expect(localRootOf({ root })).toBeUndefined();
    expect(scanLocal({ root })).toEqual([]);
    expect(isInsideLocal({ root, path: join(root, '.agents/local/tmp/x') })).toBe(false);

    const entry = {
      scope: 'tmp',
      name: 'x',
      path: join(root, '.agents/local/tmp/x'),
      bytes: 1,
      ageMs: 0,
      state: 'ok',
      removable: true,
      isSymlink: false,
      registered: false,
      note: '',
    };
    const result = runClean({ root, plan: { remove: [entry], keep: [] } });

    expect(result.removed).toEqual([]);
    expect(readFileSync(join(outside, 'local/tmp/x/keep.txt'), 'utf8')).toBe('precious');
  });

  test('.agents/local resolves inside the project to be trusted, and only then', () => {
    const root = repository();

    expect(localRootOf({ root })?.endsWith('/.agents/local')).toBe(true);
    expect(localRootOf({ root: createProject({ files: {} }) })).toBeUndefined();
  });

  test('a scope folder that is a file, or a link, is skipped without throwing, in clean and in doctor', async () => {
    const root = repository();
    const outside = createProject({ files: { 'a.txt': 'x' } });

    rmSync(join(root, '.agents/local/tmp'), { recursive: true });
    writeFileSync(join(root, '.agents/local/tmp'), 'not a folder');
    rmSync(join(root, '.agents/local/clones'), { recursive: true });
    symlinkSync(outside, join(root, '.agents/local/clones'));

    expect(() => scanLocal({ root })).not.toThrow();
    expect(scanLocal({ root }).filter((entry) => ['tmp', 'clones'].includes(entry.scope))).toEqual(
      [],
    );
    expect(() => runDoctorWarnings({ root })).not.toThrow();
    const result = await runDoctorNotes({ root });
    expect(result.filter((entry) => entry.file === '.agents/local')).toEqual([]);
  });
});

describe('parseWorktreeList', () => {
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
    const map = parseWorktreeList({ output });

    expect(map.get('/repo/.agents/local/worktrees/odd\nname')?.branch).toBe('odd');
    expect(map.get('/repo/.agents/local/worktrees/loose')).toEqual({
      branch: undefined,
      head: '3333333333333333333333333333333333333333',
    });
    expect(map.get('/repo')?.branch).toBe('develop');
  });
});

describe('planClean and runClean', () => {
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

    const all = planClean({ root, scopes: ['tmp', 'worktrees', 'clones', 'cache'] });

    expect(names({ entries: all.remove })).toEqual(['cache/k', 'clones/c', 'tmp/a']);

    const named = planClean({ root, scopes: ['reports', 'prototypes', 'profile'] });

    expect(names({ entries: named.remove })).toEqual([
      'profile/profile.json',
      'prototypes/p.html',
      'reports/r.md',
    ]);
  });

  test('removes a merged, a gone and an orphan worktree, keeps an unmerged one, and prunes git', () => {
    const root = repository();

    worktree({ root, name: 'merged-one' });
    worktree({ root, name: 'unmerged-one', commit: true });
    worktree({ root, name: 'gone-one' });
    git({ cwd: root, args: ['update-ref', '-d', 'refs/heads/gone-one'] });
    mkdirSync(join(root, '.agents/local/worktrees/orphan-one'));

    const plan = planClean({ root, scopes: ['worktrees'] });

    expect(names({ entries: plan.keep })).toEqual(['worktrees/unmerged-one']);

    const result = runClean({ root, plan });

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

    const plan = planClean({ root, scopes: ['tmp'] });
    const result = runClean({ root, plan });

    expect(result.removed).toHaveLength(1);
    expect(existsSync(join(root, '.agents/local/tmp/link'))).toBe(false);
    expect(readFileSync(join(outside, 'keep.txt'), 'utf8')).toBe('precious');
  });

  test('a path outside .agents/local/ is refused even if a plan names it', () => {
    const root = repository();
    const outside = createProject({ files: { 'keep.txt': 'precious' } });

    expect(isInsideLocal({ root, path: join(outside, 'keep.txt') })).toBe(false);
    expect(isInsideLocal({ root, path: join(root, 'package.json') })).toBe(false);
    expect(isInsideLocal({ root, path: join(root, '.agents/local/tmp/a') })).toBe(true);

    const entry = {
      scope: 'tmp',
      name: 'x',
      path: join(outside, 'keep.txt'),
      bytes: 1,
      ageMs: 0,
      state: 'ok',
      removable: true,
      isSymlink: false,
      registered: false,
      note: '',
    };
    const result = runClean({ root, plan: { remove: [entry], keep: [] } });

    expect(result.removed).toEqual([]);
    expect(result.failed[0]?.error).toContain('not inside .agents/local');
    expect(readFileSync(join(outside, 'keep.txt'), 'utf8')).toBe('precious');
  });
});

describe('vulcan clean', () => {
  test('is a dry run by default: it lists, and removes nothing', () => {
    const root = repository();

    file({ root, path: 'tmp/job/a.txt', text: 'hello' });

    const result = runCli({ args: ['clean'], cwd: root });

    expect(result.code).toBe(0);
    expect(result.stderr).toContain('dry run');
    expect(result.stderr).toContain('tmp/job');
    expect(result.stderr).toContain('would remove 1 item(s)');
    expect(existsSync(join(root, '.agents/local/tmp/job'))).toBe(true);
  });

  test('--yes removes the default scope (tmp) and leaves the other scopes', () => {
    const root = repository();

    file({ root, path: 'tmp/job/a.txt' });
    file({ root, path: 'cache/k/a.txt' });
    file({ root, path: 'reports/r.md' });

    const result = runCli({ args: ['clean', '--yes'], cwd: root });

    expect(result.code).toBe(0);
    expect(result.stderr).toContain('removed 1 item(s)');
    expect(existsSync(join(root, '.agents/local/tmp/job'))).toBe(false);
    expect(existsSync(join(root, '.agents/local/cache/k'))).toBe(true);
    expect(existsSync(join(root, '.agents/local/reports/r.md'))).toBe(true);
  });

  test('--all --yes sweeps what can be recreated and keeps reports; --reports names them', () => {
    const root = repository();

    file({ root, path: 'tmp/a/x' });
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
    worktree({ root, name: 'done' });

    const result = await runDoctorWarnings({ root });
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

    const result = await runDoctorWarnings({ root });
    expect(result.filter((entry) => entry.file.startsWith('.agents/local/'))).toEqual([]);
  });

  test('prints the size of .agents/local/ once it is large, with where it went', async () => {
    const root = repository();

    file({ root, path: 'cache/big', text: '' });
    truncateSync(join(root, '.agents/local/cache/big'), 60 * 1024 * 1024);

    const notes = await runDoctorNotes({ root });
    const [note] = notes.filter((entry) => entry.file === '.agents/local');

    expect(note?.message).toContain('holds 60.0 MB');
    expect(note?.message).toContain('cache 60.0 MB');
    const result = await runDoctorNotes({ root: repository() });
    expect(result.filter((entry) => entry.file === '.agents/local')).toEqual([]);
  });
});

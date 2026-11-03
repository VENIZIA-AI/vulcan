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
import { ProjectLayout } from '../../common/index.ts';
import { DoctorRunner } from '../../doctor/index.ts';
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

    worktree({ root, name: 'merged-one' });
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

    worktree({ root, name: 'merged-clean' });
    worktree({ root, name: 'merged-dirty' });
    worktree({ root, name: 'merged-untracked' });
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

    const all = LocalClean.plan({ root, scopes: ['tmp', 'worktrees', 'clones', 'cache'] });

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

    worktree({ root, name: 'merged-one' });
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

    const plan = LocalClean.plan({ root, scopes: ['tmp'] });
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

    const result = await DoctorRunner.runWarnings({ root });
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

    const result = await DoctorRunner.runWarnings({ root });
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

  test('events and release-candidates are layout folders that sync does not create', () => {
    const layoutNames = ProjectLayout.LOCAL_LAYOUT.map((entry) => entry.name);

    expect(layoutNames).toEqual(expect.arrayContaining(['events', 'release-candidates']));
    expect(
      ProjectLayout.LOCAL_LAYOUT.filter((entry) => 'onDemand' in entry).map((entry) => entry.name),
    ).toEqual(['events', 'release-candidates']);
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

  test('events are removed only when named, never by --all', () => {
    const root = repository();

    file({ root, path: 'events/2026-11-03.jsonl', text: '{}\n' });

    expect(
      LocalClean.plan({ root, scopes: ['tmp', 'worktrees', 'clones', 'cache'] }).remove,
    ).toEqual([]);
    expect(runCli({ args: ['clean', '--all', '--yes'], cwd: root }).code).toBe(0);
    expect(existsSync(join(root, '.agents/local/events/2026-11-03.jsonl'))).toBe(true);
    expect(runCli({ args: ['clean', '--events', '--yes'], cwd: root }).code).toBe(0);
    expect(existsSync(join(root, '.agents/local/events/2026-11-03.jsonl'))).toBe(false);
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

    // The browser folder is expired tmp, not unknown, and the command that takes it is named.
    const chromeWarning = warnings.find((entry) => entry.file.endsWith('com.google.Chrome.xyz'));

    expect(chromeWarning?.message).toContain('vulcan clean --tmp --yes');
    expect(existsSync(join(root, '.agents/local/diag.ts'))).toBe(true);
    expect(runCli({ args: ['clean', '--all', '--yes'], cwd: root }).code).toBe(0);
    expect(existsSync(join(root, '.agents/local/diag.ts'))).toBe(true);
    expect(existsSync(join(root, '.agents/local/audit/report.md'))).toBe(true);
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
    worktree({ root, name: 'dirty' });
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

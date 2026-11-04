import { afterAll, describe, expect, test } from 'bun:test';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { CommitHook, CommitHookPlan, CommitHookStates } from '../../commit/index.ts';
import { VULCAN_CONFIG_SCHEMA } from '../../config/index.ts';
import { SyncStatuses } from '../../sync/index.ts';
import { git } from '../git-repo.helper.ts';
import { createProject, removeProjects } from '../project.helper.ts';

afterAll(removeProjects);

const DENY = VULCAN_CONFIG_SCHEMA.parse({
  commit: { message: { agent: { signature: 'deny' } } },
});
const SUBJECT_ONLY = VULCAN_CONFIG_SCHEMA.parse({
  commit: { message: { subject: { pattern: '^x' } } },
});
const OFF = VULCAN_CONFIG_SCHEMA.parse({});

const repo = (opts: { files?: Record<string, string> } = {}): string => {
  const root = createProject({ files: opts.files ?? {} });

  git({ cwd: root, args: ['init', '--quiet'] });

  return root;
};

const hookFile = (opts: { root: string }): string => join(opts.root, '.git/hooks/commit-msg');

const planOf = (opts: { root: string; config: typeof DENY }) =>
  CommitHookPlan.plan({ root: opts.root, config: opts.config });

const write = (opts: { path: string; text: string }): void => {
  mkdirSync(dirname(opts.path), { recursive: true });
  writeFileSync(opts.path, opts.text);
  chmodSync(opts.path, 0o755);
};

describe('CommitHookPlan: where the hook goes', () => {
  test('a clone with no hook gets the managed one, executable, and a second run changes nothing', () => {
    const root = repo();
    const [created] = planOf({ root, config: DENY });

    expect(created.status).toBe(SyncStatuses.CREATED);
    expect(existsSync(hookFile({ root }))).toBe(false);

    created.apply();

    const text = readFileSync(hookFile({ root }), 'utf8');

    expect(text.startsWith('#!/bin/sh\n')).toBe(true);
    expect(text).toContain('# vulcan:commit-msg');
    expect(text).toContain('vulcan commit-check');
    expect(lstatSync(hookFile({ root })).mode & 0o111).not.toBe(0);
    expect(planOf({ root, config: DENY }).map((action) => action.status)).toEqual([
      SyncStatuses.UNCHANGED,
    ]);
  });

  test('a subject shape alone also installs it', () => {
    expect(planOf({ root: repo(), config: SUBJECT_ONLY })[0].status).toBe(SyncStatuses.CREATED);
  });

  test('a project with no check turned on gets nothing', () => {
    const root = repo();

    expect(planOf({ root, config: OFF })).toEqual([]);
    expect(CommitHook.stateOf({ root, config: OFF }).state).toBe(CommitHookStates.OFF);
  });

  test('a directory that is not a git repository gets nothing', () => {
    const root = createProject({ files: {} });

    expect(planOf({ root, config: DENY })).toEqual([]);
    expect(CommitHook.stateOf({ root, config: DENY }).state).toBe(CommitHookStates.NOT_GIT);
  });

  test('a managed hook the template has moved past is replaced', () => {
    const root = repo();

    write({ path: hookFile({ root }), text: '#!/bin/sh\n# vulcan:commit-msg\necho old\n' });

    const [action] = planOf({ root, config: DENY });

    expect(action.status).toBe(SyncStatuses.REPLACED);

    action.apply();

    expect(readFileSync(hookFile({ root }), 'utf8')).not.toContain('echo old');
  });

  test('a managed hook is taken back when the project turns the checks off', () => {
    const root = repo();

    planOf({ root, config: DENY })[0].apply();

    const [action] = planOf({ root, config: OFF });

    expect(action.status).toBe(SyncStatuses.REMOVED);

    action.apply();

    expect(existsSync(hookFile({ root }))).toBe(false);
  });

  test('a project below the git top level calls the check from its own folder', () => {
    const top = repo();
    const root = join(top, 'apps', 'web');

    mkdirSync(root, { recursive: true });
    planOf({ root, config: DENY })[0].apply();

    expect(readFileSync(hookFile({ root: top }), 'utf8')).toContain('apps/web');
  });

  test('a folder name with a quote or a command substitution is data, not shell', () => {
    const top = repo();
    const marker = join(createProject({ files: {} }), 'pwned');
    const root = join(top, `it's $(touch ${marker}) \`touch ${marker}\``);

    mkdirSync(root, { recursive: true });
    planOf({ root, config: DENY })[0].apply();

    const text = readFileSync(hookFile({ root: top }), 'utf8');

    expect(text).toContain("it'\\''s");
  });

  test('a linked worktree installs into the hooks of the repository it belongs to', () => {
    const main = repo();

    git({ cwd: main, args: ['config', 'user.name', 'T'] });
    git({ cwd: main, args: ['config', 'user.email', 't@example.dev'] });
    git({ cwd: main, args: ['commit', '--allow-empty', '-q', '-m', 'x'] });

    const linked = join(createProject({ files: {} }), 'linked');

    git({ cwd: main, args: ['worktree', 'add', '-q', linked] });
    planOf({ root: linked, config: DENY })[0].apply();

    expect(existsSync(hookFile({ root: main }))).toBe(true);
  });
});

describe('CommitHookPlan: a hook that is not ours is never overwritten', () => {
  test('a hook of the developer is left as it is and the line to add is printed', () => {
    const root = repo();
    const mine = '#!/bin/sh\necho mine\n';

    write({ path: hookFile({ root }), text: mine });

    const [action] = planOf({ root, config: DENY });

    expect(action.status).toBe(SyncStatuses.SKIPPED);
    expect(action.note).toContain('bun x --no-install vulcan commit-check "$1"');

    action.apply();

    expect(readFileSync(hookFile({ root }), 'utf8')).toBe(mine);
  });

  test('a hook that already calls vulcan commit-check is theirs and counts as wired', () => {
    const root = repo();

    write({
      path: hookFile({ root }),
      text: '#!/bin/sh\nexec bun x --no-install vulcan commit-check "$1"\n',
    });

    expect(planOf({ root, config: DENY })[0].status).toBe(SyncStatuses.UNCHANGED);
    expect(CommitHook.stateOf({ root, config: DENY }).state).toBe(CommitHookStates.WIRED);
  });

  test('a symbolic link in the place of the hook is not followed or replaced', () => {
    const root = repo();
    const target = join(createProject({ files: {} }), 'elsewhere');

    write({ path: target, text: '#!/bin/sh\n' });
    mkdirSync(dirname(hookFile({ root })), { recursive: true });
    symlinkSync(target, hookFile({ root }));

    const [action] = planOf({ root, config: DENY });

    expect(action.status).toBe(SyncStatuses.SKIPPED);

    action.apply();

    expect(lstatSync(hookFile({ root })).isSymbolicLink()).toBe(true);
    expect(readFileSync(target, 'utf8')).toBe('#!/bin/sh\n');
  });

  test('a managed-looking file with the marker but not executable is still ours and is replaced', () => {
    const root = repo();

    mkdirSync(dirname(hookFile({ root })), { recursive: true });
    writeFileSync(hookFile({ root }), '#!/bin/sh\n# vulcan:commit-msg\n');

    expect(planOf({ root, config: DENY })[0].status).toBe(SyncStatuses.REPLACED);
  });
});

describe('CommitHookPlan: a file is ours only when the marker is its second line', () => {
  test('a hook of the developer that mentions the marker further down is theirs', () => {
    const root = repo();
    const mine = '#!/bin/sh\necho mine\n# remove the # vulcan:commit-msg block by hand\n';

    write({ path: hookFile({ root }), text: mine });

    const [action] = planOf({ root, config: DENY });

    expect(action.status).toBe(SyncStatuses.SKIPPED);

    action.apply();

    expect(readFileSync(hookFile({ root }), 'utf8')).toBe(mine);
  });

  test('and it is not taken back when the checks go off', () => {
    const root = repo();

    write({ path: hookFile({ root }), text: '#!/bin/sh\necho mine\n# vulcan:commit-msg\n' });

    expect(planOf({ root, config: OFF })).toEqual([]);
  });
});

describe('CommitHookPlan: a project that sets core.hooksPath owns its hooks', () => {
  const withHooksPath = (opts: { hook?: string }): string => {
    const root = repo({
      files: opts.hook === undefined ? {} : { '.githooks/commit-msg': opts.hook },
    });

    git({ cwd: root, args: ['config', 'core.hooksPath', '.githooks'] });

    return root;
  };

  test('nothing is written there, and the line to add is printed', () => {
    const root = withHooksPath({});
    const [action] = planOf({ root, config: DENY });

    expect(action.status).toBe(SyncStatuses.SKIPPED);
    expect(action.note).toContain('core.hooksPath');
    expect(action.note).toContain('bun x --no-install vulcan commit-check "$1"');

    action.apply();

    expect(existsSync(join(root, '.githooks/commit-msg'))).toBe(false);
    expect(existsSync(hookFile({ root }))).toBe(false);
  });

  test('a hook there that calls the command is wired', () => {
    const root = withHooksPath({
      hook: '#!/bin/sh\nexec bun x --no-install vulcan commit-check "$1"\n',
    });

    expect(planOf({ root, config: DENY })[0].status).toBe(SyncStatuses.UNCHANGED);
  });

  test('a hook there that does not call it is told to, and left alone', () => {
    const root = withHooksPath({ hook: '#!/bin/sh\necho other\n' });
    const [action] = planOf({ root, config: DENY });

    expect(action.status).toBe(SyncStatuses.SKIPPED);

    action.apply();

    expect(readFileSync(join(root, '.githooks/commit-msg'), 'utf8')).toBe(
      '#!/bin/sh\necho other\n',
    );
  });

  test('a managed hook left in .git/hooks is not removed while core.hooksPath hides it', () => {
    const root = withHooksPath({});

    write({ path: hookFile({ root }), text: '#!/bin/sh\n# vulcan:commit-msg\n' });

    expect(planOf({ root, config: OFF })).toEqual([]);
  });
});

describe('the hook script', () => {
  const run = (opts: {
    root: string;
    /** The folder holding `.git`, when the project sits below it. */
    top?: string;
    /** Where `node_modules/@venizia/vulcan` is, when not in `root`. */
    modulesAt?: string;
    bun?: string;
    withModules?: boolean;
    message?: string;
  }): { code: number; stderr: string; calls: string } => {
    planOf({ root: opts.root, config: DENY })[0].apply();

    if (opts.withModules !== false) {
      mkdirSync(join(opts.modulesAt ?? opts.root, 'node_modules/@venizia/vulcan'), {
        recursive: true,
      });
    }

    const bin = createProject({ files: {} });
    const calls = join(bin, 'calls');

    if (opts.bun !== undefined) {
      writeFileSync(
        join(bin, 'bun'),
        `#!/bin/sh\npwd >> "${calls}"\necho "$@" >> "${calls}"\n${opts.bun}\n`,
      );
      chmodSync(join(bin, 'bun'), 0o755);
    }

    writeFileSync(join(opts.root, 'MSG'), opts.message ?? 'x\n');

    const result = Bun.spawnSync(['/bin/sh', hookFile({ root: opts.top ?? opts.root }), 'MSG'], {
      cwd: opts.root,
      env: { PATH: `${bin}:/usr/bin:/bin`, HOME: bin },
      stdout: 'pipe',
      stderr: 'pipe',
    });

    return {
      code: result.exitCode,
      stderr: result.stderr.toString(),
      calls: existsSync(calls) ? readFileSync(calls, 'utf8') : '',
    };
  };

  test('it hands the message file to vulcan commit-check and passes its verdict on', () => {
    const passed = run({ root: repo(), bun: 'exit 0' });
    const blocked = run({ root: repo(), bun: 'exit 1' });

    expect(passed.code).toBe(0);
    expect(passed.calls).toContain('x --no-install vulcan commit-check');
    expect(passed.calls).toMatch(/commit-check \/.*\/MSG/);
    expect(blocked.code).toBe(1);
  });

  test('it runs the check from the project folder', () => {
    const top = repo();
    const root = join(top, 'apps', 'web');

    mkdirSync(root, { recursive: true });

    const result = run({ root, top, bun: 'exit 0' });

    expect(result.calls.split('\n')[0]).toEndWith('apps/web');
  });

  test('with a vulcan too old to know the command it lets the commit through and says so', () => {
    const result = run({
      root: repo(),
      bun: "echo \"vulcan: unknown command 'commit-check' - run 'bun x vulcan help'\"; exit 1",
    });

    expect(result.code).toBe(0);
    expect(result.stderr).toContain('has no commit-check command');
  });

  test('a problem the check reports reaches the person committing', () => {
    const result = run({ root: repo(), bun: 'echo "commit-check: 1 problem(s)"; exit 1' });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('commit-check: 1 problem(s)');
  });

  test('text in the message that reads "unknown command" does not skip the check', () => {
    const result = run({
      root: repo(),
      bun: `printf '%s\\n' 'commit-check: 1 problem(s) in the commit message:' '  commit message, line 1: "unknown command" signs the commit'; exit 1`,
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('1 problem(s)');
  });

  test('a package hoisted to the git top level is found from the project folder', () => {
    const top = repo();
    const root = join(top, 'apps', 'web');

    mkdirSync(root, { recursive: true });

    const result = run({ root, top, modulesAt: top, bun: 'exit 1' });

    expect(result.code).toBe(1);
    expect(result.calls).toContain('commit-check');
  });

  test('without bun it lets the commit through and says so', () => {
    const result = run({ root: repo() });

    expect(result.code).toBe(0);
    expect(result.stderr).toContain('bun is not installed');
  });

  test('without node_modules/@venizia/vulcan it lets the commit through and says so', () => {
    const result = run({ root: repo(), bun: 'exit 1', withModules: false });

    expect(result.code).toBe(0);
    expect(result.stderr).toContain('run bun install');
    expect(result.calls).toBe('');
  });
});

describe('CommitHook.stateOf, what vulcan doctor reports', () => {
  test('missing, wired, stale, hand-made and checks-off are told apart', () => {
    const missing = repo();

    expect(CommitHook.stateOf({ root: missing, config: DENY }).state).toBe(
      CommitHookStates.MISSING,
    );

    planOf({ root: missing, config: DENY })[0].apply();

    expect(CommitHook.stateOf({ root: missing, config: DENY }).state).toBe(CommitHookStates.WIRED);

    write({ path: hookFile({ root: missing }), text: '#!/bin/sh\n# vulcan:commit-msg\nold\n' });

    expect(CommitHook.stateOf({ root: missing, config: DENY }).state).toBe(CommitHookStates.STALE);

    const handMade = repo();

    write({ path: hookFile({ root: handMade }), text: '#!/bin/sh\necho mine\n' });

    expect(CommitHook.stateOf({ root: handMade, config: DENY }).state).toBe(
      CommitHookStates.UNWIRED,
    );
  });
});

describe('CommitHookPlan: a repository has one hook and it belongs to the project that wrote it', () => {
  const nested = (): { top: string; sandbox: string } => {
    const top = repo();
    const sandbox = join(top, 'sandbox');

    mkdirSync(sandbox, { recursive: true });

    return { top, sandbox };
  };

  test('a project inside the repository, with the check off, does not remove the hook of the top level', () => {
    const { top, sandbox } = nested();

    planOf({ root: top, config: DENY })[0].apply();

    const before = readFileSync(hookFile({ root: top }), 'utf8');

    expect(planOf({ root: sandbox, config: OFF })).toEqual([]);
    expect(readFileSync(hookFile({ root: top }), 'utf8')).toBe(before);
  });

  test('a project inside the repository, with the check on, does not rewrite the hook of the top level', () => {
    const { top, sandbox } = nested();

    planOf({ root: top, config: DENY })[0].apply();

    const before = readFileSync(hookFile({ root: top }), 'utf8');
    const [action] = planOf({ root: sandbox, config: DENY });

    expect(action.status).toBe(SyncStatuses.SKIPPED);
    expect(action.note).toContain('the project at the top of the repository');

    action.apply();

    expect(readFileSync(hookFile({ root: top }), 'utf8')).toBe(before);
  });

  test('the top level does not take back or rewrite the hook of a project inside it', () => {
    const { top, sandbox } = nested();

    planOf({ root: sandbox, config: DENY })[0].apply();

    const before = readFileSync(hookFile({ root: top }), 'utf8');
    const [action] = planOf({ root: top, config: DENY });

    expect(before).toContain('[sandbox]');
    expect(action.status).toBe(SyncStatuses.SKIPPED);
    expect(action.note).toContain('the project in sandbox');
    expect(planOf({ root: top, config: OFF })).toEqual([]);
    expect(readFileSync(hookFile({ root: top }), 'utf8')).toBe(before);
  });

  test('a project keeps its own hook up to date and takes it back when the check goes off', () => {
    const { top, sandbox } = nested();

    planOf({ root: sandbox, config: DENY })[0].apply();

    expect(planOf({ root: sandbox, config: DENY })[0].status).toBe(SyncStatuses.UNCHANGED);

    const [removal] = planOf({ root: sandbox, config: OFF });

    expect(removal.status).toBe(SyncStatuses.REMOVED);

    removal.apply();

    expect(existsSync(hookFile({ root: top }))).toBe(false);
  });

  test("a hook of an earlier release has no folder and is the top level's", () => {
    const { top, sandbox } = nested();

    write({
      path: hookFile({ root: top }),
      text: '#!/bin/sh\n# vulcan:commit-msg - old\necho old\n',
    });

    expect(planOf({ root: sandbox, config: OFF })).toEqual([]);
    expect(planOf({ root: sandbox, config: DENY })[0].status).toBe(SyncStatuses.SKIPPED);
    expect(planOf({ root: top, config: DENY })[0].status).toBe(SyncStatuses.REPLACED);
    expect(planOf({ root: top, config: OFF })[0].status).toBe(SyncStatuses.REMOVED);
  });

  test('the doctor state of a hook that belongs to another project is unwired, with the reason', () => {
    const { top, sandbox } = nested();

    planOf({ root: top, config: DENY })[0].apply();

    const state = CommitHook.stateOf({ root: sandbox, config: DENY });

    expect(state.state).toBe(CommitHookStates.UNWIRED);
    expect(state.note).toContain('belongs to');
  });
});

describe('CommitHook.ownerOf', () => {
  test.each([
    ['#!/bin/sh\n# vulcan:commit-msg [] - x\n', ''],
    ['#!/bin/sh\n# vulcan:commit-msg [apps/web] - x\n', 'apps/web'],
    ['#!/bin/sh\n# vulcan:commit-msg - x\n', ''],
    ['#!/bin/sh\necho mine\n# vulcan:commit-msg [a]\n', undefined],
    ['#!/bin/sh\n# something else\n', undefined],
  ])('%j is owned by %j', (text, owner) => {
    expect(CommitHook.ownerOf({ text })).toBe(owner);
  });
});

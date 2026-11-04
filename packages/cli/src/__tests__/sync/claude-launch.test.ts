import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SessionDigest } from '../../hooks/index.ts';
import { ClaudeLaunch, CLAUDE_LAUNCH_FILE } from '../../sync/claude-launch.ts';
import { isolateOwnerReplySwitch } from '../owner-reply-env.helper.ts';
import { createProject, removeProjects } from '../project.helper.ts';

afterAll(removeProjects);
isolateOwnerReplySwitch();

const WIKI = join(import.meta.dir, '..', '..', '..', '..', '..', 'docs', 'wiki', 'content');
const LAUNCH_COMMAND = 'claude --settings .agents/local/claude.launch.settings.json';

const withLaunchFile = (): string =>
  createProject({ files: { [CLAUDE_LAUNCH_FILE]: '{}\n', '.agents/rules.md': '' } });

describe('ClaudeLaunch.missWarning', () => {
  test('the command is the one the docs give', () => {
    expect(ClaudeLaunch.COMMAND).toBe(LAUNCH_COMMAND);
    expect(readFileSync(join(WIKI, 'references', 'agents.md'), 'utf8')).toContain(LAUNCH_COMMAND);
  });

  test('a Claude Code session with the variable unset is told how to start it', () => {
    const root = withLaunchFile();
    const warning = ClaudeLaunch.missWarning({ root, env: { CLAUDE_PROJECT_DIR: root } });

    expect(warning).toContain('CLAUDE_CODE_TMPDIR is not set');
    expect(warning).toContain(`start Claude Code with: ${LAUNCH_COMMAND}`);
    expect(warning).toContain('asked to approve');
  });

  test('a folder outside the project is named', () => {
    const root = withLaunchFile();
    const warning = ClaudeLaunch.missWarning({
      root,
      env: { CLAUDE_PROJECT_DIR: root, CLAUDE_CODE_TMPDIR: '/var/tmp/claude' },
    });

    expect(warning).toContain('CLAUDE_CODE_TMPDIR is /var/tmp/claude, outside the project');
  });

  test('a folder inside the project says nothing', () => {
    const root = withLaunchFile();

    expect(
      ClaudeLaunch.missWarning({
        root,
        env: { CLAUDE_PROJECT_DIR: root, CLAUDE_CODE_TMPDIR: join(root, '.agents/local/tmp') },
      }),
    ).toBeUndefined();
  });

  test('an empty variable counts as not set', () => {
    const root = withLaunchFile();

    expect(
      ClaudeLaunch.missWarning({ root, env: { CLAUDE_PROJECT_DIR: root, CLAUDE_CODE_TMPDIR: '' } }),
    ).toContain('not set');
  });

  test('another agent (no CLAUDE_PROJECT_DIR) and a project without the file say nothing', () => {
    const root = withLaunchFile();
    const bare = createProject({ files: { '.agents/rules.md': '' } });

    expect(ClaudeLaunch.missWarning({ root, env: {} })).toBeUndefined();
    expect(
      ClaudeLaunch.missWarning({ root: bare, env: { CLAUDE_PROJECT_DIR: bare } }),
    ).toBeUndefined();
  });
});

/**
 * A checkout that is on no disk: `tmpOf` answers from the path alone, so these cases give the same answer
 * wherever the tests run. A fixture made under the temp folder would not: in a worktree that folder is
 * `<checkout>/.agents/local/worktrees/<name>/.agents/local/tmp/tests`, and the checkout above it is a home.
 */
const CHECKOUT = '/srv/vulcan-fixture/checkout';

const tmpStateOf = (opts: { root: string; folder: string }): string =>
  ClaudeLaunch.tmpOf({ root: opts.root, env: { CLAUDE_CODE_TMPDIR: opts.folder } }).state;

describe('ClaudeLaunch.tmpOf', () => {
  test('a sibling folder that only shares the prefix of the root counts as outside', () => {
    expect(tmpStateOf({ root: CHECKOUT, folder: `${CHECKOUT}-other/.agents/local/tmp` })).toBe(
      'outside',
    );
  });

  test('a worktree may use the folder of the checkout it hangs from, and no other folder above it', () => {
    const worktree = `${CHECKOUT}/.agents/local/worktrees/one`;

    expect(tmpStateOf({ root: worktree, folder: `${CHECKOUT}/.agents/local/tmp` })).toBe('inside');
    expect(tmpStateOf({ root: worktree, folder: `${CHECKOUT}/src` })).toBe('outside');
    expect(tmpStateOf({ root: worktree, folder: '/var/tmp/x' })).toBe('outside');
    expect(ClaudeLaunch.tmpOf({ root: CHECKOUT, env: {} }).state).toBe('unset');
  });

  test('a worktree on a real disk uses the folder of the checkout it hangs from', () => {
    const root = withLaunchFile();
    const worktree = join(root, '.agents/local/worktrees/one');

    mkdirSync(worktree, { recursive: true });

    expect(tmpStateOf({ root: worktree, folder: join(root, '.agents/local/tmp') })).toBe('inside');
  });

  test('a project that is not a worktree does not borrow the folder of a checkout above it', () => {
    const nested = `${CHECKOUT}/packages/inner`;

    expect(tmpStateOf({ root: nested, folder: `${CHECKOUT}/.agents/local/tmp` })).toBe('outside');
  });

  test('a project made in the temp folder of a worktree answers the same as one made anywhere', () => {
    const tests = `${CHECKOUT}/.agents/local/worktrees/wt/.agents/local/tmp/tests`;
    const root = `${tests}/vulcan-project-abc`;

    expect(tmpStateOf({ root, folder: `${root}/.agents/local/tmp` })).toBe('inside');
    expect(tmpStateOf({ root, folder: `${CHECKOUT}/.agents/local/tmp` })).toBe('inside');
    expect(tmpStateOf({ root, folder: '/srv/vulcan-fixture/elsewhere/.agents/local/tmp' })).toBe(
      'outside',
    );
    expect(tmpStateOf({ root, folder: `${CHECKOUT}-other/.agents/local/tmp` })).toBe('outside');
  });
});

describe('the session digest and the launch file', () => {
  test('the warning leads the digest when the session was started without the launch file', async () => {
    const root = withLaunchFile();
    const digest = await SessionDigest.build({
      projectRoot: root,
      env: { CLAUDE_PROJECT_DIR: root },
    });

    expect(digest.indexOf('## Launch warning')).toBeGreaterThan(-1);
    expect(digest.indexOf('## Launch warning')).toBeLessThan(digest.indexOf('## Write boundaries'));
    expect(digest).toContain(LAUNCH_COMMAND);
  });

  test('a session that uses the project folder gets no warning section', async () => {
    const root = withLaunchFile();
    const digest = await SessionDigest.build({
      projectRoot: root,
      env: { CLAUDE_PROJECT_DIR: root, CLAUDE_CODE_TMPDIR: join(root, '.agents/local/tmp') },
    });

    expect(digest).not.toContain('Launch warning');
  });
});

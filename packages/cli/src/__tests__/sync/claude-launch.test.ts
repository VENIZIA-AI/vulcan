import { afterAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSessionDigest } from '../../hooks/index.ts';
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

  test('a sibling folder that only shares the prefix of the root counts as outside', () => {
    const root = withLaunchFile();

    expect(
      ClaudeLaunch.missWarning({
        root,
        env: { CLAUDE_PROJECT_DIR: root, CLAUDE_CODE_TMPDIR: `${root}-other/tmp` },
      }),
    ).toContain('outside the project');
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

describe('the session digest and the launch file', () => {
  test('the warning leads the digest when the session was started without the launch file', async () => {
    const root = withLaunchFile();
    const digest = await buildSessionDigest({
      projectRoot: root,
      env: { CLAUDE_PROJECT_DIR: root },
    });

    expect(digest.indexOf('## Launch warning')).toBeGreaterThan(-1);
    expect(digest.indexOf('## Launch warning')).toBeLessThan(digest.indexOf('## Write boundaries'));
    expect(digest).toContain(LAUNCH_COMMAND);
  });

  test('a session that uses the project folder gets no warning section', async () => {
    const root = withLaunchFile();
    const digest = await buildSessionDigest({
      projectRoot: root,
      env: { CLAUDE_PROJECT_DIR: root, CLAUDE_CODE_TMPDIR: join(root, '.agents/local/tmp') },
    });

    expect(digest).not.toContain('Launch warning');
  });
});

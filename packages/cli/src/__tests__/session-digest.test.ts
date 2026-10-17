import { afterAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { buildSessionDigest } from '../hooks/index.ts';
import { createProject, removeProjects } from './helpers/project.ts';

afterAll(removeProjects);

const HOOK = join(import.meta.dir, '..', '..', 'base', 'hooks', 'session-start.ts');

describe('buildSessionDigest', () => {
  test('the base W rules, the slot choice and the project extensions', async () => {
    const root = createProject({
      files: {
        '.configs/vulcan.config.ts': "export default { rules: { 'V-W-01': 'read-only' } };\n",
        '.agents/rules.md':
          '| ID | Rule | Enforced by |\n|---|---|---|\n| W-06 | stay home | SOFT |\n',
      },
    });
    const digest = await buildSessionDigest({ projectRoot: root });

    expect(digest).toContain('| V-W-02 |');
    expect(digest).toContain('| V-W-01 | this project: `read-only`');
    expect(digest).toContain('| W-06 | stay home |');
    expect(digest).toContain('| V-C-02 |');
  });

  test('a project without a config still gets the digest, and sees the slot is not chosen', async () => {
    const digest = await buildSessionDigest({ projectRoot: createProject({ files: {} }) });

    expect(digest).toContain('not chosen');
  });
});

test('the session-start hook prints the digest for CLAUDE_PROJECT_DIR', () => {
  const root = createProject({
    files: {
      '.configs/vulcan.config.ts': "export default { rules: { 'V-W-01': 'on-user-word' } };\n",
    },
  });
  const child = Bun.spawnSync([process.execPath, HOOK], {
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    stdout: 'pipe',
  });

  expect(child.exitCode).toBe(0);
  expect(child.stdout.toString()).toContain('this project: `on-user-word`');
});

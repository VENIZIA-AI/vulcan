import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSyncBounded } from '@venizia/dev-configs/testing';
import { ProjectLayout } from '../../common/index.ts';
import { exportProjectTmp, HookConstants, projectTmpOf } from '../../hooks/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';

afterAll(removeProjects);

const HOOK = join(import.meta.dir, '..', '..', '..', 'base', 'hooks', 'session-start.ts');

describe('projectTmpOf', () => {
  test('is the tmp folder of the local layout every other command reads', () => {
    expect(HookConstants.PROJECT_TMP).toBe(`${ProjectLayout.LOCAL_DIRECTORY}/tmp`);
    expect(ProjectLayout.LOCAL_LAYOUT.map((entry) => entry.name)).toContain('tmp');
  });

  test('is .agents/local/tmp of the project, absolute', () => {
    expect(projectTmpOf({ root: '/work/acme' })).toBe('/work/acme/.agents/local/tmp');
  });
});

describe('exportProjectTmp', () => {
  const envFileOf = (): string => join(createProject({ files: {} }), 'env-file.sh');

  test('appends one export of TMPDIR to the file the harness sources, and makes the folder', () => {
    const root = createProject({ files: {} });
    const envFile = join(root, 'env-file.sh');

    writeFileSync(envFile, 'export KEEP=1\n');

    expect(exportProjectTmp({ root, envFile })).toBe(true);
    expect(readFileSync(envFile, 'utf8')).toBe(
      `export KEEP=1\nexport TMPDIR='${join(root, '.agents/local/tmp')}'\n`,
    );
    expect(existsSync(join(root, '.agents/local/tmp'))).toBe(true);
  });

  test('does nothing without a file: another agent, or a run outside Claude Code', () => {
    const root = createProject({ files: {} });

    expect(exportProjectTmp({ root, envFile: undefined })).toBe(false);
    expect(exportProjectTmp({ root, envFile: '' })).toBe(false);
    expect(existsSync(join(root, '.agents/local/tmp'))).toBe(false);
  });

  test('the line is shell-safe: a path with a space or a quote still gives that exact folder', () => {
    const base = createProject({ files: {} });
    const root = join(base, "my project's folder");
    const envFile = envFileOf();

    mkdirSync(root, { recursive: true });
    expect(exportProjectTmp({ root, envFile })).toBe(true);

    const shell = spawnSyncBounded({
      cmd: ['sh', '-c', `. '${envFile}'; printf '%s' "$TMPDIR"`],
      stdout: 'pipe',
    });

    expect(shell.stdout.toString()).toBe(join(root, '.agents/local/tmp'));
  });

  test('a path with a newline is refused, not written: a line of shell must never come from a folder name', () => {
    const base = createProject({ files: {} });
    const root = join(base, 'a\nb');
    const envFile = envFileOf();

    mkdirSync(root, { recursive: true });
    expect(exportProjectTmp({ root, envFile })).toBe(false);
    expect(existsSync(envFile)).toBe(false);
  });

  test('sourced by a shell, mktemp and node land in the project folder', () => {
    const root = createProject({ files: {} });
    const envFile = join(root, 'env-file.sh');

    exportProjectTmp({ root, envFile });

    const shell = spawnSyncBounded({
      cmd: [
        'sh',
        '-c',
        `unset TMPDIR; . '${envFile}'; made=$(mktemp -d); printf '%s\\n' "$made"; ${JSON.stringify(process.execPath)} -e 'console.log(require("node:os").tmpdir())'`,
      ],
      stdout: 'pipe',
    });
    const [made, tmpdir] = shell.stdout.toString().trim().split('\n');

    expect(made.startsWith(join(root, '.agents/local/tmp'))).toBe(true);
    expect(tmpdir).toBe(join(root, '.agents/local/tmp'));
  });
});

describe('the session-start hook', () => {
  test('writes the export when Claude Code gives it a file, and still prints the digest', () => {
    const root = createProject({ files: {} });
    const envFile = join(root, 'env-file.sh');
    const child = spawnSyncBounded({
      cmd: [process.execPath, HOOK],
      env: { ...process.env, CLAUDE_PROJECT_DIR: root, CLAUDE_ENV_FILE: envFile },
      stdout: 'pipe',
    });

    expect(child.exitCode).toBe(0);
    expect(child.stdout.toString()).toContain('# VULCAN rules');
    expect(readFileSync(envFile, 'utf8')).toBe(
      `export TMPDIR='${join(root, '.agents/local/tmp')}'\n`,
    );
  });

  test('without CLAUDE_ENV_FILE it only prints the digest', () => {
    const root = createProject({ files: {} });
    const env: Record<string, string | undefined> = { ...process.env, CLAUDE_PROJECT_DIR: root };

    delete env.CLAUDE_ENV_FILE;

    const child = spawnSyncBounded({ cmd: [process.execPath, HOOK], env, stdout: 'pipe' });

    expect(child.exitCode).toBe(0);
    expect(existsSync(join(root, '.agents/local/tmp'))).toBe(false);
  });
});

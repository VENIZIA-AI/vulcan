import { afterAll, describe, expect, test } from 'bun:test';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';

afterAll(removeProjects);

describe('vulcan graph', () => {
  test('is vulcan x atlas graph: atlas answers, with its own usage line and exit code (no sub command)', () => {
    const root = createProject({ files: {} });
    const result = runCli({ args: ['graph'], cwd: root });

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('usage: vulcan x atlas graph build [--full] | status [--json]');
  });

  test('a flag the table does not list is refused by the router, with the usage exit code', () => {
    const root = createProject({ files: {} });
    const result = runCli({ args: ['graph', 'status', '--nope', 'x'], cwd: root });

    expect(result.code).toBe(2);
  });
});

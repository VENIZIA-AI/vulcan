import { afterAll, describe, expect, test } from 'bun:test';
import { VULCAN_CONFIG_SCHEMA } from '../../config/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';

afterAll(removeProjects);

describe('the code graph is gone', () => {
  test('vulcan graph is not a command, and the help does not list it', () => {
    const root = createProject({ files: { 'package.json': '{}' } });
    const graph = runCli({ args: ['graph', 'build'], cwd: root });
    const help = runCli({ args: ['--help'], cwd: root });

    expect(graph.code).not.toBe(0);
    expect(graph.stderr).toContain("unknown command 'graph'");
    expect(`${help.stdout}${help.stderr}`).not.toMatch(/\bgraph\b/);
  });

  test('a graph key in the config is refused, as any key VULCAN does not know', () => {
    expect(VULCAN_CONFIG_SCHEMA.safeParse({ graph: { aliases: { '@/': 'src/' } } }).success).toBe(
      false,
    );
    expect(VULCAN_CONFIG_SCHEMA.safeParse({}).success).toBe(true);
  });
});

import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AgentConstants, readAgentTable } from '../../agents/index.ts';
import { BASE_DIRECTORY } from '../../common/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';

afterAll(removeProjects);

const PROJECT = {
  '.configs/vulcan.config.ts': "export default { rules: { 'V-W-01': 'read-only' } };\n",
  'AGENTS.md': '# x\n',
};
const TEMPLATE = readFileSync(
  join(BASE_DIRECTORY, AgentConstants.GUARD_EXTENSION_TEMPLATE),
  'utf8',
);
const OMP = '.omp/hooks/pre/vulcan-guards.ts';
const PI = '.pi/extensions/vulcan-guards.ts';

const sync = (opts: { root: string; agents: string }) =>
  runCli({ args: ['sync', '--agents', opts.agents], cwd: opts.root });

describe('the guard extension of an agent that takes one', () => {
  test('the table gives omp and pi an extension and nobody else', () => {
    const guarded = readAgentTable()
      .filter((entry) => entry.guards !== null)
      .map((entry) => [entry.id, entry.guards?.kind, entry.guards?.path]);

    expect(guarded).toEqual([
      ['omp', 'extension', OMP],
      ['pi', 'extension', PI],
    ]);
  });

  test('the shipped template starts with the marker sync recognises', () => {
    expect(TEMPLATE.startsWith(AgentConstants.GUARD_EXTENSION_MARKER)).toBe(true);
  });

  test('sync writes it for a chosen omp or pi, the same bytes as the template, and nothing for the others', () => {
    const root = createProject({ files: PROJECT });
    const result = sync({ root, agents: 'omp,pi,codex' });

    expect(result.code).toBe(0);
    expect(readFileSync(join(root, OMP), 'utf8')).toBe(TEMPLATE);
    expect(readFileSync(join(root, PI), 'utf8')).toBe(TEMPLATE);
    expect(result.stderr).toContain(`created   ${OMP}`);
    expect(result.stderr).toContain(`created   ${PI}`);
    expect(existsSync(join(root, '.codex', 'extensions'))).toBe(false);
  });

  test('an agent that is not chosen gets none, and Claude has its hooks in settings.json instead', () => {
    const root = createProject({ files: PROJECT });

    sync({ root, agents: 'claude' });

    expect(existsSync(join(root, OMP))).toBe(false);
    expect(existsSync(join(root, PI))).toBe(false);
  });

  test('a second run reports it unchanged; an out-of-date copy of sync is replaced', () => {
    const root = createProject({ files: PROJECT });

    sync({ root, agents: 'omp' });

    expect(sync({ root, agents: 'omp' }).stderr).toContain(`unchanged ${OMP}`);

    writeFileSync(join(root, OMP), `${AgentConstants.GUARD_EXTENSION_MARKER} - an older release\n`);

    expect(sync({ root, agents: 'omp' }).stderr).toContain(`replaced  ${OMP}`);
    expect(readFileSync(join(root, OMP), 'utf8')).toBe(TEMPLATE);
  });

  test('a file of the user at that path is left alone, and the line says how to add the guards', () => {
    const root = createProject({ files: PROJECT });

    mkdirSync(join(root, '.omp', 'hooks', 'pre'), { recursive: true });
    writeFileSync(join(root, OMP), 'export default function () {}\n');

    const result = sync({ root, agents: 'omp' });

    expect(result.code).toBe(0);
    expect(readFileSync(join(root, OMP), 'utf8')).toBe('export default function () {}\n');
    expect(result.stderr).toContain('a file of your own is there - left alone');
  });

  test('it is hidden from git on this machine, like the other files sync writes', () => {
    const root = createProject({ files: PROJECT });

    Bun.spawnSync(['git', 'init', '-q'], { cwd: root });
    sync({ root, agents: 'omp' });

    const exclude = readFileSync(join(root, '.git', 'info', 'exclude'), 'utf8');

    expect(exclude).toContain(`/${OMP}`);
  });

  test('choosing the agent away takes the file and its empty folders back; a file of the user stays', () => {
    const root = createProject({ files: PROJECT });

    sync({ root, agents: 'omp,pi' });
    sync({ root, agents: 'pi' });

    expect(existsSync(join(root, OMP))).toBe(false);
    expect(existsSync(join(root, '.omp'))).toBe(false);
    expect(existsSync(join(root, PI))).toBe(true);

    const mine = createProject({ files: PROJECT });

    sync({ root: mine, agents: 'omp' });
    writeFileSync(join(mine, OMP), 'export default function () {}\n');
    sync({ root: mine, agents: 'pi' });

    expect(readFileSync(join(mine, OMP), 'utf8')).toBe('export default function () {}\n');
  });
});

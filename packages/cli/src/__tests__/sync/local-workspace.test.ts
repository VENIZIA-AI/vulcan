import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ProjectLayout } from '../../common/index.ts';
import { VULCAN_CONFIG_SCHEMA } from '../../config/index.ts';
import { checkLocalWorkspace } from '../../doctor/checks.ts';
import { planLocalWorkspace } from '../../sync/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';

afterAll(removeProjects);

const CONFIG = VULCAN_CONFIG_SCHEMA.parse({});

const apply = (opts: { root: string }): void => {
  for (const action of planLocalWorkspace(opts)) {
    action.apply();
  }
};

describe('the Claude Code launch file', () => {
  const LAUNCH = '.agents/local/claude.launch.settings.json';
  const launchOf = (opts: { root: string }) =>
    JSON.parse(readFileSync(join(opts.root, LAUNCH), 'utf8'));

  test('sync writes it: the project temp folder, absolute, as TMPDIR and CLAUDE_CODE_TMPDIR', () => {
    const root = createProject({ files: { '.gitignore': 'node_modules/\n' } });

    apply({ root });

    const folder = join(root, '.agents/local/tmp');

    expect(launchOf({ root })).toEqual({ env: { TMPDIR: folder, CLAUDE_CODE_TMPDIR: folder } });
  });

  test('it is under the gitignored folder, so it is personal and never committed', () => {
    const root = createProject({ files: { '.gitignore': 'node_modules/\n' } });

    apply({ root });
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toContain('.agents/local/');
    expect(LAUNCH.startsWith('.agents/local/')).toBe(true);
  });

  test('a second run changes nothing; a file written for another path is replaced', () => {
    const root = createProject({ files: { '.gitignore': 'node_modules/\n' } });

    apply({ root });
    expect(planLocalWorkspace({ root }).map((action) => action.status)).toEqual(['unchanged']);

    writeFileSync(join(root, LAUNCH), JSON.stringify({ env: { TMPDIR: '/elsewhere' } }));
    expect(planLocalWorkspace({ root }).map((action) => action.status)).toContain('replaced');

    apply({ root });
    expect(launchOf({ root }).env.TMPDIR).toBe(join(root, '.agents/local/tmp'));
  });

  test('doctor reports a missing or stale launch file and says sync fixes it', () => {
    const root = createProject({ files: { '.gitignore': '.agents/local/\n' } });

    apply({ root });
    expect(checkLocalWorkspace({ root, config: CONFIG, configFile: '' })).toEqual([]);

    rmSync(join(root, LAUNCH));

    const missing = checkLocalWorkspace({ root, config: CONFIG, configFile: '' });

    expect(missing.length).toBe(1);
    expect(missing[0].message).toContain('vulcan sync');
    expect(missing[0].file).toContain('claude.launch.settings.json');
  });
});

describe('planLocalWorkspace', () => {
  test('gitignores .agents/local/ and creates its subdirectories', () => {
    const root = createProject({ files: { '.gitignore': 'node_modules/\n' } });

    apply({ root });

    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toBe('node_modules/\n.agents/local/\n');

    for (const { name } of ProjectLayout.LOCAL_LAYOUT) {
      expect(existsSync(join(root, '.agents/local', name))).toBe(true);
    }
  });

  test('a second run changes nothing', () => {
    const root = createProject({ files: { '.gitignore': 'node_modules/\n' } });

    apply({ root });

    expect(planLocalWorkspace({ root }).map((action) => action.status)).toEqual(['unchanged']);
  });

  test('a project without a .gitignore keeps none, and still gets the directories', () => {
    const root = createProject({ files: {} });

    apply({ root });

    expect(existsSync(join(root, '.gitignore'))).toBe(false);
    expect(existsSync(join(root, '.agents/local/tmp'))).toBe(true);
  });

  test('a line already there is not added twice', () => {
    const root = createProject({ files: { '.gitignore': '.agents/local/\n' } });

    // The directories and the launch file are made; the .gitignore line is already there and is left alone.
    expect(
      planLocalWorkspace({ root }).filter((action) => action.path.endsWith('.gitignore')),
    ).toEqual([]);
  });

  test('every directory declares when it goes, and the agent-created ones are removed', () => {
    const lifetimes = Object.fromEntries(
      ProjectLayout.LOCAL_LAYOUT.map((entry) => [entry.name, entry.lifetime]),
    );

    expect(lifetimes).toEqual({
      tmp: 'task',
      worktrees: 'branch',
      clones: 'research',
      cache: 'kept',
      reports: 'kept',
      prototypes: 'kept',
    });
  });

  test('the generated .gitignore of a new project lists it', () => {
    expect(ProjectLayout.GITIGNORE_ENTRIES).toContain('.agents/local/');
  });
});

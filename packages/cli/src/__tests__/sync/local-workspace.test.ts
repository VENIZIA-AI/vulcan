import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ProjectLayout } from '../../common/index.ts';
import { planLocalWorkspace } from '../../sync/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';

afterAll(removeProjects);

const apply = (opts: { root: string }): void => {
  for (const action of planLocalWorkspace(opts)) {
    action.apply();
  }
};

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

    expect(planLocalWorkspace({ root }).map((action) => action.status)).toEqual(['created']);
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

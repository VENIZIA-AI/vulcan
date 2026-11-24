import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { ProjectLayout } from '../../common/index.ts';
import { VULCAN_CONFIG_SCHEMA } from '../../config/index.ts';
import { ProjectContract } from '../../doctor/checks.ts';
import { LocalPlan } from '../../sync/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';

afterAll(removeProjects);

const CONFIG = VULCAN_CONFIG_SCHEMA.parse({});

const apply = (opts: { root: string }): void => {
  for (const action of LocalPlan.planWorkspace(opts)) {
    action.apply();
  }
};

describe('the launch file of an earlier release', () => {
  const LAUNCH = '.agents/local/claude.launch.settings.json';

  test('sync writes no launch file', () => {
    const root = createProject({ files: { '.gitignore': 'node_modules/\n' } });

    apply({ root });
    expect(existsSync(join(root, LAUNCH))).toBe(false);
  });

  test('a leftover that git does not track is removed by sync, and doctor says sync does it', () => {
    const root = createProject({
      files: { '.gitignore': '.agents/local/\n', [LAUNCH]: '{"env":{}}\n' },
    });

    Bun.spawnSync(['git', 'init', '-q'], { cwd: root });
    const found = ProjectContract.checkLocalWorkspace({
      root,
      config: CONFIG,
      configFile: '',
    }).filter((entry) => entry.file === LAUNCH);

    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain('no longer used');
    expect(found[0]?.message).toContain('vulcan sync');
    apply({ root });
    expect(existsSync(join(root, LAUNCH))).toBe(false);
    expect(ProjectContract.checkLocalWorkspace({ root, config: CONFIG, configFile: '' })).toEqual(
      [],
    );
  });

  test('a symlinked .agents/local: the leftover is removed where the link leads, and the link stays', () => {
    const root = createProject({ files: { 'elsewhere/claude.launch.settings.json': '{}\n' } });

    Bun.spawnSync(['git', 'init', '-q'], { cwd: root });

    mkdirSync(join(root, '.agents'), { recursive: true });
    symlinkSync(join(root, 'elsewhere'), join(root, '.agents/local'));
    apply({ root });
    expect(existsSync(join(root, 'elsewhere/claude.launch.settings.json'))).toBe(false);
    expect(lstatSync(join(root, '.agents/local')).isSymbolicLink()).toBe(true);
  });

  test('a leftover that git tracks is never removed, and the note names the git command', () => {
    const root = createProject({ files: { [LAUNCH]: '{}\n' } });

    Bun.spawnSync(['git', 'init', '-q'], { cwd: root });
    Bun.spawnSync(['git', 'add', '-f', LAUNCH], { cwd: root });

    const [action] = LocalPlan.planLegacyLaunch({ root });

    expect(action?.status).toBe('skipped');
    expect(action?.note).toContain(`git rm --cached ${LAUNCH}`);
    action?.apply();
    expect(existsSync(join(root, LAUNCH))).toBe(true);
  });
});

describe('LocalPlan.planWorkspace', () => {
  test('gitignores .agents/local/ and creates its subdirectories', () => {
    const root = createProject({ files: { '.gitignore': 'node_modules/\n' } });

    apply({ root });

    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toBe(
      'node_modules/\n.agents/local/\n/.claude/settings.json\n/.agents/tmp/\n',
    );

    for (const entry of ProjectLayout.LOCAL_LAYOUT) {
      // On-demand folders (events, release-candidates) appear when something writes there, not on sync.
      // `tmp` is the scratch folder `.agents/tmp` now, not a folder of `.agents/local`.
      expect(existsSync(join(root, '.agents/local', entry.name)), entry.name).toBe(
        !('onDemand' in entry) && entry.name !== 'tmp',
      );
    }

    expect(existsSync(join(root, '.agents/tmp'))).toBe(true);
  });

  test('a second run changes nothing', () => {
    const root = createProject({ files: { '.gitignore': 'node_modules/\n' } });

    apply({ root });

    expect(LocalPlan.planWorkspace({ root }).map((action) => action.status)).toEqual([
      'unchanged',
      'unchanged',
    ]);
  });

  test('a project without a .gitignore keeps none, and still gets the directories', () => {
    const root = createProject({ files: {} });

    apply({ root });

    expect(existsSync(join(root, '.gitignore'))).toBe(false);
    expect(existsSync(join(root, '.agents/tmp'))).toBe(true);
  });

  test('a line already there is not added twice', () => {
    const root = createProject({ files: { '.gitignore': '.agents/local/\n' } });

    // The directories are made; the .gitignore line is already there and is left alone, and only the Claude settings line is new.
    expect(
      LocalPlan.planWorkspace({ root })
        .filter((action) => action.path.endsWith('.gitignore'))
        .map((action) => action.note),
    ).toEqual(['added /.claude/settings.json', 'added /.agents/tmp/']);

    const covered = createProject({
      files: { '.gitignore': '.agents/local/\n.claude/\n/.agents/tmp/\n' },
    });

    expect(
      LocalPlan.planWorkspace({ root: covered }).filter((action) =>
        action.path.endsWith('.gitignore'),
      ),
    ).toEqual([]);
  });

  test('a parent folder line or the bare folder name already covers the tmp folder: no near-duplicate is added', () => {
    for (const line of ['.agents/', '/.agents/', '.agents/tmp', '.agents/tmp/', '/.agents/tmp']) {
      const root = createProject({
        files: { '.gitignore': `.agents/local/\n.claude/\n${line}\n` },
      });

      expect(
        LocalPlan.planWorkspace({ root })
          .filter((action) => action.path.endsWith('.gitignore'))
          .map((action) => action.note),
        line,
      ).toEqual([]);
    }
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
      agents: 'kept',
      events: 'kept',
      'release-candidates': 'release',
    });
  });

  test('the generated .gitignore of a new project lists it', () => {
    expect(ProjectLayout.GITIGNORE_ENTRIES).toContain('.agents/local/');
    expect(ProjectLayout.GITIGNORE_ENTRIES).toContain('.agents/tmp/');
  });
});

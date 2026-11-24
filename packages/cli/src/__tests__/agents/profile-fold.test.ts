import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AgentConstants } from '../../agents/common/constants.ts';
import { LocalChoice } from '../../agents/index.ts';
import { LocalSettings } from '../../common/local-settings.ts';
import { EventSettings } from '../../events/index.ts';
import { OwnerProfile } from '../../owner/index.ts';
import { LocalPlan } from '../../sync/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';

afterAll(removeProjects);

const LEGACY = AgentConstants.LEGACY_LOCAL_FILE;
const PROFILE = AgentConstants.LOCAL_FILE;
const OLD = {
  $generated: 'by vulcan project sync',
  schemaVersion: 1,
  agents: ['claude', 'omp'],
  board: { agents: { bun: 'flame' }, serve: { autoStart: true } },
  local: { tmp: 't' },
  events: { dir: '/srv/vulcan-fixture/events' },
};
const PROJECT = {
  '.configs/vulcan.config.mts': "export default { name: 'acme' };\n",
  'package.json': '{ "name": "@x/acme-workspace" }',
  '.gitignore': 'node_modules\n',
};
const withOld = (extra: Record<string, string> = {}): string =>
  createProject({ files: { ...PROJECT, [LEGACY]: JSON.stringify(OLD), ...extra } });
const git = (root: string): void => {
  Bun.spawnSync(['git', 'init', '-q'], { cwd: root });
};

describe('the file of the releases before 0.5.0 is still read until sync has moved it', () => {
  test('the choice, the roster, the tmp folder, autoStart and the events folder come from it when the profile has none', () => {
    const root = withOld();

    expect(LocalChoice.read({ root })).toEqual({ ok: true, agents: ['claude', 'omp'] });
    expect(LocalSettings.read({ root })).toEqual({
      tmp: 't',
      boardAgents: { bun: 'flame' },
      autoStart: true,
    });
    expect(EventSettings.localDir({ root })).toBe('/srv/vulcan-fixture/events');
  });

  test('a key the profile has wins over the old file, key by key', () => {
    const root = withOld({
      [PROFILE]: JSON.stringify({
        schemaVersion: 1,
        local: { tmp: 'other' },
        events: { dir: '/srv/own/events' },
      }),
    });

    expect(LocalSettings.read({ root }).tmp).toBe('other');
    expect(LocalSettings.read({ root }).autoStart).toBe(true);
    expect(EventSettings.localDir({ root })).toBe('/srv/own/events');
  });
});

describe('sync moves the keys of the old file into the profile', () => {
  test('the keys land in the profile, the owner keys stay, the old file is removed, and the choice is kept', () => {
    const root = withOld({
      [PROFILE]: JSON.stringify({ schemaVersion: 1, language: 'vi', tone: 'terse' }),
    });

    git(root);

    const run = runCli({ args: ['project', 'sync'], cwd: root });
    const profile = JSON.parse(readFileSync(join(root, PROFILE), 'utf8'));

    expect(run.code, run.stderr).toBe(0);
    expect(existsSync(join(root, LEGACY))).toBe(false);
    expect(profile).toMatchObject({
      schemaVersion: 1,
      language: 'vi',
      tone: 'terse',
      agents: ['claude', 'omp'],
      board: { agents: { bun: 'flame' }, serve: { autoStart: true } },
      local: { tmp: 't' },
      events: { dir: '/srv/vulcan-fixture/events' },
    });
    expect(profile.$generated).toBeUndefined();
    expect(OwnerProfile.read({ root }).ok).toBe(true);
  });

  test('where both have a key the profile value stays, and the note names it', () => {
    const root = withOld({
      [PROFILE]: JSON.stringify({ schemaVersion: 1, local: { tmp: 'mine' } }),
    });

    git(root);

    const [action] = LocalPlan.planLegacyLocal({ root });

    expect(action?.status).toBe('removed');
    expect(action?.note).toContain('kept for local');
    action?.apply();
    expect(JSON.parse(readFileSync(join(root, PROFILE), 'utf8')).local).toEqual({ tmp: 'mine' });
  });

  test('a file that git tracks keeps its place: the keys move first, then the note names git rm --cached', () => {
    const tracked = withOld();

    git(tracked);
    Bun.spawnSync(['git', 'add', '-f', LEGACY], { cwd: tracked });

    const [action] = LocalPlan.planLegacyLocal({ root: tracked });

    expect(action?.status).toBe('replaced');
    expect(action?.note).toContain(`git rm --cached ${LEGACY}`);
    action?.apply();
    expect(existsSync(join(tracked, LEGACY))).toBe(true);
    expect(JSON.parse(readFileSync(join(tracked, PROFILE), 'utf8')).agents).toEqual([
      'claude',
      'omp',
    ]);
  });

  test('where git cannot say, the keys move and the file stays, with a note', () => {
    const notGit = withOld();
    const [action] = LocalPlan.planLegacyLocal({ root: notGit });

    expect(action?.status).toBe('replaced');
    expect(action?.note).toContain('could not say');
    action?.apply();
    expect(existsSync(join(notGit, LEGACY))).toBe(true);
    expect(JSON.parse(readFileSync(join(notGit, PROFILE), 'utf8')).local).toEqual({ tmp: 't' });
  });

  test('board, local and events merge one level down: a profile with board.serve still takes board.agents from the old file', () => {
    const root = withOld({
      [PROFILE]: JSON.stringify({
        schemaVersion: 1,
        board: { serve: { autoStart: false }, agents: { rock: 'ember' } },
      }),
    });

    git(root);

    const [action] = LocalPlan.planLegacyLocal({ root });

    action?.apply();
    expect(JSON.parse(readFileSync(join(root, PROFILE), 'utf8')).board).toEqual({
      agents: { rock: 'ember' },
      serve: { autoStart: false },
    });
    expect(action?.note).toContain('board.agents');
    expect(action?.note).toContain('board.serve');
  });

  test('the old board.agents is kept when the profile has board.serve only', () => {
    const root = withOld({
      [PROFILE]: JSON.stringify({ schemaVersion: 1, board: { serve: { autoStart: false } } }),
    });

    git(root);
    LocalPlan.planLegacyLocal({ root })[0]?.apply();
    expect(JSON.parse(readFileSync(join(root, PROFILE), 'utf8')).board.agents).toEqual({
      bun: 'flame',
    });
  });

  test('a key the profile does not take is not copied: it stays in the old file, which stays, and the owner card still reads', () => {
    const root = createProject({
      files: {
        ...PROJECT,
        [LEGACY]: JSON.stringify({ ...OLD, boards: { typo: true } }),
        [PROFILE]: JSON.stringify({ schemaVersion: 1, tone: 'terse' }),
      },
    });

    git(root);

    const [action] = LocalPlan.planLegacyLocal({ root });

    expect(action?.status).toBe('replaced');
    expect(action?.note).toContain('boards');
    action?.apply();
    expect(existsSync(join(root, LEGACY))).toBe(true);
    expect(JSON.parse(readFileSync(join(root, PROFILE), 'utf8')).boards).toBeUndefined();
    expect(OwnerProfile.read({ root }).ok).toBe(true);
  });

  test('a profile that is not valid JSON blames the profile and the old file is not used as a fallback', () => {
    const root = withOld({ [PROFILE]: '{ nope' });

    git(root);

    const [action] = LocalPlan.planLegacyLocal({ root });

    expect(action?.status).toBe('skipped');
    expect(action?.path).toBe(join(root, PROFILE));
    expect(action?.note).toContain('not moved');
    expect(LocalChoice.read({ root }).ok).toBe(false);
  });

  test('a symlinked .agents/local: nothing is moved or written', () => {
    const root = withOld();

    git(root);
    mkdirSync(join(root, 'elsewhere'));
    mkdirSync(join(root, '.agents'), { recursive: true });
    symlinkSync(join(root, 'elsewhere'), join(root, '.agents', 'local'));

    expect(LocalPlan.planLegacyLocal({ root })[0]?.status).toBe('skipped');
    expect(LocalPlan.planChoice({ root, agents: ['claude'] }).status).toBe('skipped');
  });

  test('doctor warns about the leftover until sync has moved it, and sync is then quiet', () => {
    const root = withOld();

    git(root);
    mkdirSync(join(root, '.agents', 'local'), { recursive: true });
    expect(
      LocalPlan.planWorkspace({ root }).some((action) => action.path.endsWith('vulcan.local.json')),
    ).toBe(true);
    runCli({ args: ['project', 'sync'], cwd: root });
    expect(
      LocalPlan.planWorkspace({ root }).some((action) => action.path.endsWith('vulcan.local.json')),
    ).toBe(false);
  });
});

describe("the profile keeps this machine's keys", () => {
  test("`vulcan profile`'s write keeps agents, board, local and events", () => {
    const root = createProject({
      files: {
        '.gitignore': '.agents/local/\n',
        [PROFILE]: JSON.stringify({ schemaVersion: 1, agents: ['claude'], local: { tmp: 't' } }),
      },
    });
    const written = OwnerProfile.write({ root, profile: { schemaVersion: 1, tone: 'terse' } });
    const after = JSON.parse(readFileSync(join(root, PROFILE), 'utf8'));

    expect(written.ok).toBe(true);
    expect(after).toMatchObject({ tone: 'terse', agents: ['claude'], local: { tmp: 't' } });
  });

  test("`vulcan profile reset` removes the owner's answers and keeps the machine's keys; with none it deletes the file", () => {
    const kept = createProject({
      files: {
        '.gitignore': '.agents/local/\n',
        [PROFILE]: JSON.stringify({ schemaVersion: 1, tone: 'terse', agents: ['claude'] }),
      },
    });

    runCli({ args: ['profile', 'reset', '--yes'], cwd: kept });
    expect(JSON.parse(readFileSync(join(kept, PROFILE), 'utf8'))).toEqual({
      schemaVersion: 1,
      agents: ['claude'],
    });

    const plain = createProject({
      files: {
        '.gitignore': '.agents/local/\n',
        [PROFILE]: JSON.stringify({ schemaVersion: 1, tone: 'terse' }),
      },
    });

    runCli({ args: ['profile', 'reset', '--yes'], cwd: plain });
    expect(existsSync(join(plain, PROFILE))).toBe(false);
  });

  test("`sync --agents` writes the choice into the profile and keeps the owner's keys", () => {
    const root = createProject({
      files: {
        ...PROJECT,
        [PROFILE]: JSON.stringify({ schemaVersion: 1, language: 'vi', tone: 'terse' }),
      },
    });

    writeFileSync(join(root, '.gitignore'), '.agents/local/\nnode_modules\n');
    runCli({ args: ['project', 'sync', '--agents', 'claude'], cwd: root });

    const profile = JSON.parse(readFileSync(join(root, PROFILE), 'utf8'));

    expect(profile).toMatchObject({ agents: ['claude'], language: 'vi', tone: 'terse' });
    expect(OwnerProfile.read({ root }).ok).toBe(true);
  });
});

describe('reset drops a machine key that is not valid, and names it', () => {
  test('a broken events.dir cannot keep the form and the reset in a circle', () => {
    const root = createProject({
      files: {
        '.gitignore': '.agents/local/\n',
        [PROFILE]: JSON.stringify({
          schemaVersion: 1,
          tone: 'terse',
          agents: ['claude'],
          events: { dir: 'relative/path' },
        }),
      },
    });

    expect(OwnerProfile.read({ root }).ok).toBe(false);

    const dry = runCli({ args: ['profile', 'reset'], cwd: root });

    expect(dry.stderr).toContain('events');
    expect(dry.stderr).toContain('not valid');

    const done = runCli({ args: ['profile', 'reset', '--yes'], cwd: root });

    expect(done.stderr).toContain('events');
    expect(JSON.parse(readFileSync(join(root, PROFILE), 'utf8'))).toEqual({
      schemaVersion: 1,
      agents: ['claude'],
    });
    expect(OwnerProfile.read({ root }).ok).toBe(true);
  });

  test('`vulcan project clean --profile --yes` resets like `profile reset`: the answers go, the machine keys stay', () => {
    const root = createProject({
      files: {
        '.gitignore': '.agents/local/\n',
        [PROFILE]: JSON.stringify({ schemaVersion: 1, tone: 'terse', agents: ['claude'] }),
      },
    });

    runCli({ args: ['project', 'clean', '--profile', '--yes'], cwd: root });
    expect(JSON.parse(readFileSync(join(root, PROFILE), 'utf8'))).toEqual({
      schemaVersion: 1,
      agents: ['claude'],
    });
  });
});

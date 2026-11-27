import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AgentConstants } from '../../agents/common/constants.ts';
import { LocalChoice } from '../../agents/index.ts';
import { LocalSettings } from '../../common/local-settings.ts';
import { EventSettings } from '../../events/index.ts';
import { OwnerProfile } from '../../owner/index.ts';
import { ProjectContract } from '../../doctor/checks.ts';
import { VULCAN_CONFIG_SCHEMA } from '../../config/index.ts';
import { LocalPlan } from '../../sync/index.ts';
import { createProject, removeProjects } from '../helpers/project.helper.ts';
import { runCli } from '../helpers/run.helper.ts';

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
  '.configs/vulcan.config.mts': "export default { project: { name: 'acme' } };\n",
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
        common: { local: { tmp: 'other' } },
        board: { events: { dir: '/srv/own/events' } },
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
      agent: { list: ['claude', 'omp'] },
      board: {
        page: { agents: { bun: 'flame' } },
        serve: { autoStart: true },
        events: { dir: '/srv/vulcan-fixture/events' },
      },
      common: { local: { tmp: 't' } },
    });
    expect(profile.$generated).toBeUndefined();
    expect(OwnerProfile.read({ root }).ok).toBe(true);
  });

  test('where both have a key the profile value stays, and the note names it', () => {
    const root = withOld({
      [PROFILE]: JSON.stringify({ schemaVersion: 1, common: { local: { tmp: 'mine' } } }),
    });

    git(root);

    const [action] = LocalPlan.planLegacyLocal({ root });

    expect(action?.status).toBe('removed');
    expect(action?.note).toContain('kept for common.local.tmp');
    action?.apply();
    expect(JSON.parse(readFileSync(join(root, PROFILE), 'utf8')).common.local).toEqual({
      tmp: 'mine',
    });
  });

  test('a file that git tracks keeps its place: the keys move first, then the note names git rm --cached', () => {
    const tracked = withOld();

    git(tracked);
    Bun.spawnSync(['git', 'add', '-f', LEGACY], { cwd: tracked });

    const [action] = LocalPlan.planLegacyLocal({ root: tracked });

    expect(action?.status).toBe('unchanged');
    expect(action?.note).toContain(`git rm --cached ${LEGACY}`);
    action?.apply();
    expect(existsSync(join(tracked, LEGACY))).toBe(true);
    expect(JSON.parse(readFileSync(join(tracked, PROFILE), 'utf8')).agent.list).toEqual([
      'claude',
      'omp',
    ]);
  });

  test('where git cannot say, the keys move and the file stays, with a note', () => {
    const notGit = withOld();
    const [action] = LocalPlan.planLegacyLocal({ root: notGit });

    expect(action?.status).toBe('unchanged');
    expect(action?.note).toContain('could not say');
    action?.apply();
    expect(existsSync(join(notGit, LEGACY))).toBe(true);
    expect(JSON.parse(readFileSync(join(notGit, PROFILE), 'utf8')).common.local).toEqual({
      tmp: 't',
    });
  });

  test('the old keys merge under the new paths: a profile with board.serve still takes the roster from the old file, and its own value wins', () => {
    const root = withOld({
      [PROFILE]: JSON.stringify({
        schemaVersion: 1,
        board: { serve: { autoStart: false }, page: { agents: { rock: 'ember' } } },
      }),
    });

    git(root);

    const [action] = LocalPlan.planLegacyLocal({ root });

    action?.apply();
    expect(JSON.parse(readFileSync(join(root, PROFILE), 'utf8')).board).toMatchObject({
      page: { agents: { rock: 'ember' } },
      serve: { autoStart: false },
    });
    expect(action?.note).toContain('board.page.agents');
    expect(action?.note).toContain('board.serve');
  });

  test('the old roster is kept when the profile has board.serve only', () => {
    const root = withOld({
      [PROFILE]: JSON.stringify({ schemaVersion: 1, board: { serve: { autoStart: false } } }),
    });

    git(root);
    LocalPlan.planLegacyLocal({ root })[0]?.apply();
    expect(JSON.parse(readFileSync(join(root, PROFILE), 'utf8')).board.page.agents).toEqual({
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

    expect(action?.status).toBe('unchanged');
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
  test("`vulcan profile`'s write keeps agent, board and common", () => {
    const root = createProject({
      files: {
        '.gitignore': '.agents/local/\n',
        [PROFILE]: JSON.stringify({
          schemaVersion: 1,
          agent: { list: ['claude'] },
          common: { local: { tmp: 't' } },
        }),
      },
    });
    const written = OwnerProfile.write({ root, profile: { schemaVersion: 1, tone: 'terse' } });
    const after = JSON.parse(readFileSync(join(root, PROFILE), 'utf8'));

    expect(written.ok).toBe(true);
    expect(after).toMatchObject({
      tone: 'terse',
      agent: { list: ['claude'] },
      common: { local: { tmp: 't' } },
    });
  });

  test("`vulcan profile reset` removes the owner's answers and keeps the machine's keys; with none it deletes the file", () => {
    const kept = createProject({
      files: {
        '.gitignore': '.agents/local/\n',
        [PROFILE]: JSON.stringify({ schemaVersion: 1, tone: 'terse', agent: { list: ['claude'] } }),
      },
    });

    runCli({ args: ['profile', 'reset', '--yes'], cwd: kept });
    expect(JSON.parse(readFileSync(join(kept, PROFILE), 'utf8'))).toEqual({
      schemaVersion: 1,
      agent: { list: ['claude'] },
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

    expect(profile).toMatchObject({ agent: { list: ['claude'] }, language: 'vi', tone: 'terse' });
    expect(OwnerProfile.read({ root }).ok).toBe(true);
  });
});

describe('reset drops a machine key that is not valid, and names it', () => {
  test('a broken board.events.dir cannot keep the form and the reset in a circle', () => {
    const root = createProject({
      files: {
        '.gitignore': '.agents/local/\n',
        [PROFILE]: JSON.stringify({
          schemaVersion: 1,
          tone: 'terse',
          agent: { list: ['claude'] },
          board: { events: { dir: 'relative/path' } },
        }),
      },
    });

    expect(OwnerProfile.read({ root }).ok).toBe(false);

    const dry = runCli({ args: ['profile', 'reset'], cwd: root });

    expect(dry.stderr).toContain('board');
    expect(dry.stderr).toContain('not valid');

    const done = runCli({ args: ['profile', 'reset', '--yes'], cwd: root });

    expect(done.stderr).toContain('board');
    expect(JSON.parse(readFileSync(join(root, PROFILE), 'utf8'))).toEqual({
      schemaVersion: 1,
      agent: { list: ['claude'] },
    });
    expect(OwnerProfile.read({ root }).ok).toBe(true);
  });

  test('`vulcan project clean --profile --yes` resets like `profile reset`: the answers go, the machine keys stay', () => {
    const root = createProject({
      files: {
        '.gitignore': '.agents/local/\n',
        [PROFILE]: JSON.stringify({ schemaVersion: 1, tone: 'terse', agent: { list: ['claude'] } }),
      },
    });

    runCli({ args: ['project', 'clean', '--profile', '--yes'], cwd: root });
    expect(JSON.parse(readFileSync(join(root, PROFILE), 'utf8'))).toEqual({
      schemaVersion: 1,
      agent: { list: ['claude'] },
    });
  });
});

describe('sync moves the old machine keys of the profile to the groups, once', () => {
  const OLD_PROFILE = {
    schemaVersion: 1,
    tone: 'terse',
    agents: ['claude'],
    board: { agents: { bun: 'flame' }, serve: { autoStart: true } },
    local: { tmp: 't' },
    events: { dir: '/srv/vulcan-fixture/events' },
  };
  const withProfile = (profile: unknown): string =>
    createProject({ files: { ...PROJECT, [PROFILE]: JSON.stringify(profile) } });

  test('every old key lands at its new path, the owner keys stay, and nothing reads the old shape afterwards', () => {
    const root = withProfile(OLD_PROFILE);
    const before = LocalChoice.read({ root });

    expect(before.ok).toBe(false);
    expect(before.ok ? '' : before.error).toContain('run vulcan project sync to move it');

    const run = runCli({ args: ['project', 'sync'], cwd: root });
    const after = JSON.parse(readFileSync(join(root, PROFILE), 'utf8'));

    expect(run.code, run.stderr).toBe(0);
    expect(after).toEqual({
      schemaVersion: 1,
      tone: 'terse',
      agent: { list: ['claude'] },
      board: {
        page: { agents: { bun: 'flame' } },
        serve: { autoStart: true },
        events: { dir: '/srv/vulcan-fixture/events' },
      },
      common: { local: { tmp: 't' } },
    });
    expect(LocalChoice.read({ root })).toEqual({ ok: true, agents: ['claude'] });
    expect(OwnerProfile.read({ root }).ok).toBe(true);
    expect(LocalPlan.planProfileKeys({ root })).toEqual([]);
  });

  test('the old profile is refused by name everywhere until sync has run', () => {
    const root = withProfile({ schemaVersion: 1, agents: ['claude'] });
    const owner = OwnerProfile.read({ root });

    expect(owner.ok).toBe(false);
    expect(owner.ok ? '' : owner.error).toContain('removed: it is agent.list now');
  });

  test('a value already at the new path stays, and the note names it', () => {
    const root = withProfile({
      schemaVersion: 1,
      agents: ['claude'],
      agent: { list: ['omp'] },
    });
    const [action] = LocalPlan.planProfileKeys({ root });

    expect(action?.note).toContain('the value already there was kept for agent.list');
    action?.apply();
    expect(JSON.parse(readFileSync(join(root, PROFILE), 'utf8')).agent).toEqual({ list: ['omp'] });
  });

  test('a board key it cannot place stays where it is, named, and the rest still moves', () => {
    const root = withProfile({
      schemaVersion: 1,
      agents: ['claude'],
      board: { agents: { bun: 'flame' }, typo: 1 },
    });
    const [action] = LocalPlan.planProfileKeys({ root });

    expect(action?.note).toContain('board.typo not placed');
    action?.apply();

    const after = JSON.parse(readFileSync(join(root, PROFILE), 'utf8'));

    expect(after.board).toEqual({ typo: 1, page: { agents: { bun: 'flame' } } });
    expect(after.agent).toEqual({ list: ['claude'] });
  });

  test('a profile in the new shape and one that is not JSON are left as they are', () => {
    const fresh = withProfile({ schemaVersion: 1, agent: { list: ['claude'] } });
    const broken = createProject({ files: { ...PROJECT, [PROFILE]: '{ nope' } });

    expect(LocalPlan.planProfileKeys({ root: fresh })).toEqual([]);
    expect(LocalPlan.planProfileKeys({ root: broken })).toEqual([]);
  });

  test('a symlinked .agents/local: the keys are not moved', () => {
    const root = createProject({
      files: { ...PROJECT, 'elsewhere/profile.json': JSON.stringify(OLD_PROFILE) },
    });

    mkdirSync(join(root, '.agents'), { recursive: true });
    symlinkSync(join(root, 'elsewhere'), join(root, '.agents', 'local'));

    const [action] = LocalPlan.planProfileKeys({ root });

    expect(action?.status).toBe('skipped');
    expect(JSON.parse(readFileSync(join(root, 'elsewhere/profile.json'), 'utf8')).agents).toEqual([
      'claude',
    ]);
  });

  test('--dry-run lists the move and writes nothing', () => {
    const root = withProfile(OLD_PROFILE);
    const before = readFileSync(join(root, PROFILE), 'utf8');
    const run = runCli({ args: ['project', 'sync', '--dry-run'], cwd: root });

    expect(readFileSync(join(root, PROFILE), 'utf8')).toBe(before);
    expect(run.stdout + run.stderr).toContain('profile.json');
  });

  test('`vulcan profile reset --yes` on a profile sync has not moved keeps its machine keys, at their new paths', () => {
    const root = withProfile({ ...OLD_PROFILE, tone: 'terse' });

    writeFileSync(join(root, '.gitignore'), '.agents/local/\nnode_modules\n');

    const run = runCli({ args: ['profile', 'reset', '--yes'], cwd: root });

    expect(run.code, run.stderr).toBe(0);
    expect(JSON.parse(readFileSync(join(root, PROFILE), 'utf8'))).toEqual({
      schemaVersion: 1,
      agent: { list: ['claude'] },
      board: {
        page: { agents: { bun: 'flame' } },
        serve: { autoStart: true },
        events: { dir: '/srv/vulcan-fixture/events' },
      },
      common: { local: { tmp: 't' } },
    });
  });

  test('doctor tells an old key to run sync, not to reset', () => {
    const root = withProfile({ schemaVersion: 1, agents: ['claude'] });
    const messages = ProjectContract.checkProfile({
      root,
      config: VULCAN_CONFIG_SCHEMA.parse({}),
      configFile: '.configs/vulcan.config.mts',
    }).map((violation) => violation.message);

    expect(messages.join('\n')).toContain('run vulcan project sync to move it');
    expect(messages.join('\n')).not.toContain('profile reset');
  });

  test('the note of the move is printed before anything can fail, and a profile with an unplaceable key still says what it moved', () => {
    const root = withProfile({
      schemaVersion: 1,
      agents: ['claude'],
      agent: { list: ['omp'] },
      board: { typo: 1 },
    });
    const run = runCli({ args: ['project', 'sync'], cwd: root });

    expect(run.stderr).toContain('the value already there was kept for agent.list');
    expect(run.stderr).toContain('board.typo not placed');
  });

  test('--dry-run on an old profile lists the move and resolves the choice against it: exit 0, nothing written', () => {
    const root = withProfile(OLD_PROFILE);
    const before = readFileSync(join(root, PROFILE), 'utf8');
    const run = runCli({ args: ['project', 'sync', '--dry-run'], cwd: root });

    expect(run.code, run.stderr).toBe(0);
    expect(run.stderr).toContain('profile.json');
    expect(readFileSync(join(root, PROFILE), 'utf8')).toBe(before);
  });

  test('the note of a symlinked old profile is printed first', () => {
    const root = createProject({
      files: { ...PROJECT, 'elsewhere/profile.json': JSON.stringify(OLD_PROFILE) },
    });

    mkdirSync(join(root, '.agents'), { recursive: true });
    symlinkSync(join(root, 'elsewhere'), join(root, '.agents', 'local'));

    const run = runCli({ args: ['project', 'sync'], cwd: root });

    expect(run.stderr).toContain('is a symlink: its keys were not moved');
  });
});

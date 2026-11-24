import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  $generated: 'by vulcan sync',
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

    const run = runCli({ args: ['sync'], cwd: root });
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

  test('a file that git tracks, or that git cannot be asked about, is never removed', () => {
    const tracked = withOld();

    git(tracked);
    Bun.spawnSync(['git', 'add', '-f', LEGACY], { cwd: tracked });

    const [skipped] = LocalPlan.planLegacyLocal({ root: tracked });

    expect(skipped?.status).toBe('skipped');
    expect(skipped?.note).toContain(`git rm ${LEGACY}`);
    skipped?.apply();
    expect(existsSync(join(tracked, LEGACY))).toBe(true);

    const notGit = withOld();
    const [unknown] = LocalPlan.planLegacyLocal({ root: notGit });

    expect(unknown?.status).toBe('skipped');
    expect(unknown?.note).toContain('could not say');
  });

  test('doctor warns about the leftover until sync has moved it, and sync is then quiet', () => {
    const root = withOld();

    git(root);
    mkdirSync(join(root, '.agents', 'local'), { recursive: true });
    expect(
      LocalPlan.planWorkspace({ root }).some((action) => action.path.endsWith('vulcan.local.json')),
    ).toBe(true);
    runCli({ args: ['sync'], cwd: root });
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
    runCli({ args: ['sync', '--agents', 'claude'], cwd: root });

    const profile = JSON.parse(readFileSync(join(root, PROFILE), 'utf8'));

    expect(profile).toMatchObject({ agents: ['claude'], language: 'vi', tone: 'terse' });
    expect(OwnerProfile.read({ root }).ok).toBe(true);
  });
});

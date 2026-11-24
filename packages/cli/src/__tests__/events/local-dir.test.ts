import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AgentConstants } from '../../agents/common/constants.ts';
import { LocalChoice } from '../../agents/index.ts';
import { VULCAN_CONFIG_SCHEMA } from '../../config/index.ts';
import { OwnerProfile } from '../../owner/index.ts';
import { ProjectContract } from '../../doctor/checks.ts';
import {
  EventConstants,
  EventHook,
  EventLog,
  EventSettings,
  FlowState,
  UsageMeter,
} from '../../events/index.ts';
import { FlowGuard } from '../../hooks/flow-guard.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';
import { wire } from './wire.helper.ts';

afterAll(removeProjects);

const MANIFEST = '.agents/local/vulcan.manifest.json';
const LOCAL = '.agents/local/profile.json';
const ACTOR = 'pnt-vulcan-1';
const shared = (): string => createProject({ files: {} });

const project = (opts: { events?: object; local?: unknown } = {}): string =>
  createProject({
    files: {
      [MANIFEST]: JSON.stringify({
        project: { key: 'ACME' },
        events: opts.events ?? { log: true },
      }),
      ...(opts.local === undefined
        ? {}
        : { [LOCAL]: JSON.stringify({ schemaVersion: 1, ...(opts.local as object) }) }),
    },
  });
const ownLog = (root: string): string => join(root, '.agents/local/events');
const linesIn = (dir: string) => EventLog.read({ dir }).events;
const readdirSyncSafe = (dir: string): string[] => {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
};

describe('events.dir in the local file replaces the manifest value', () => {
  test('the path of the local file is the one the agents code names', () => {
    expect(EventConstants.LOCAL_FILE).toBe(AgentConstants.LOCAL_FILE);
  });

  test('read and dirOf: local over manifest, with the log off too, and --dir over both', () => {
    const own = shared();
    const team = shared();
    const root = project({ events: { log: false, dir: team }, local: { events: { dir: own } } });

    expect(EventSettings.read({ root })).toEqual({ log: false, dir: own });
    expect(EventSettings.dirOf({ root })).toBe(own);
    expect(EventSettings.dirOf({ root, dir: '/somewhere/else' })).toBe('/somewhere/else');
    expect(EventSettings.dirOf({ root: project({ events: { log: true, dir: team } }) })).toBe(team);
  });

  test.each([
    ['a relative path', { events: { dir: 'events' } }],
    ['a ~ path', { events: { dir: '~/events' } }],
    ['a NUL', { events: { dir: '/a\0b' } }],
    ['a number', { events: { dir: 7 } }],
    ['a broken file', undefined],
  ])('%s falls back to the manifest', (_label, local) => {
    const team = shared();
    const root = project({ events: { log: true, dir: team }, local });

    if (local === undefined) {
      writeFileSync(join(root, LOCAL), '{ nope');
    }

    expect(EventSettings.dirOf({ root })).toBe(team);
    expect(EventSettings.read({ root }).log).toBe(true);
  });

  test('a project with no folder anywhere keeps its own', () => {
    const root = project();

    expect(EventSettings.dirOf({ root })).toBe(ownLog(root));
  });
});

describe('every reader of the events folder follows it', () => {
  test('vulcan event add writes there and vulcan event tail reads there', () => {
    const own = shared();
    const root = project({ local: { events: { dir: own } } });
    const added = runCli({
      args: [
        'event',
        'add',
        '--kind',
        'commit',
        '--summary',
        'in the shared folder',
        '--actor',
        ACTOR,
      ],
      cwd: root,
    });
    const tail = runCli({ args: ['event', 'tail', '--json'], cwd: root });

    expect(added.code).toBe(0);
    expect(linesIn(own).map((line) => line.summary)).toEqual(['in the shared folder']);
    expect(readdirSyncSafe(ownLog(root))).toEqual([]);
    expect(tail.stdout).toContain('in the shared folder');
  });

  test('the hooks write there', () => {
    const own = shared();
    const root = project({ local: { events: { dir: own } } });
    const line = EventHook.run({
      root,
      input: wire({ hookEventName: 'SessionStart', source: 'startup', model: 'm' }),
      env: { VULCAN_ACTOR: ACTOR },
    });

    expect(line?.kind).toBe('session-start');
    expect(linesIn(own)).toHaveLength(1);
    expect(readdirSyncSafe(ownLog(root))).toEqual([]);
  });

  test('the board reads there', () => {
    const own = shared();
    const root = project({ local: { events: { dir: own } } });
    const out = join(root, 'board.html');

    EventLog.append({
      dir: own,
      event: EventLog.build({
        kind: 'flow',
        summary: 'A flow of the shared folder',
        actor: ACTOR,
        source: 'cli',
        flowId: 'VULZ-ACME-1',
      }),
    });

    const result = runCli({ args: ['board', '--no-github', '--out', out], cwd: root });

    expect(result.code, result.stderr).toBe(0);
    expect(readFileSync(out, 'utf8')).toContain('A flow of the shared folder');
  });

  test('the flow guard and the usage meter use it', () => {
    const own = shared();
    const root = project({ local: { events: { dir: own } } });
    const ask = () =>
      FlowGuard.inspect({
        root,
        command: 'git commit -m x',
        cwd: root,
        env: { VULCAN_ACTOR: ACTOR },
        isOver: FlowState.isOver,
      });

    expect(ask()).toHaveLength(1);
    EventLog.append({
      dir: own,
      event: EventLog.build({
        kind: 'flow',
        summary: 'F',
        actor: ACTOR,
        source: 'cli',
        flowId: 'VULZ-ACME-1',
      }),
    });
    expect(ask()).toEqual([]);

    const transcript = join(root, 't.jsonl');

    writeFileSync(
      transcript,
      `${JSON.stringify({ type: 'assistant', message: { id: 'm1', model: 'x', usage: wire({ inputTokens: 1, outputTokens: 2 }) } })}\n`,
    );

    const [usage] = UsageMeter.recordSession({
      root,
      input: wire({ sessionId: 's-1', transcriptPath: transcript, cwd: root }) as Record<
        string,
        unknown
      >,
      env: { VULCAN_ACTOR: ACTOR },
      isOver: FlowState.isOver,
    });

    expect(usage?.flowId).toBe('VULZ-ACME-1');
    expect(linesIn(own).filter((line) => line.kind === 'usage')).toHaveLength(1);
    expect(readdirSyncSafe(ownLog(root))).toEqual([]);
  });
});

describe('the local file and doctor', () => {
  const ctx = (root: string) => ({
    root,
    config: VULCAN_CONFIG_SCHEMA.parse({}),
    configFile: '.configs/vulcan.config.mts',
  });

  test('a folder that is not there is reported against the local file, a committed one against the config', () => {
    const root = project({ local: { events: { dir: '/does/not/exist/events' } } });
    const [own] = ProjectContract.checkEventsDir(ctx(root));

    expect(own?.file).toBe(LOCAL);
    expect(own?.message).toContain('/does/not/exist/events');

    const committed = ProjectContract.checkEventsDir({
      ...ctx(project()),
      config: VULCAN_CONFIG_SCHEMA.parse({ events: { dir: '/does/not/exist/team' } }),
    });

    expect(committed[0]?.file).toBe('.configs/vulcan.config.mts');
  });

  test('a value that is not an absolute path is named by file and key, and the committed folder applies', () => {
    const team = shared();
    const root = project({
      events: { log: true, dir: team },
      local: { events: { dir: 'relative/events' } },
    });
    const read = LocalChoice.read({ root });

    expect(read.ok).toBe(false);
    expect(read.ok ? '' : read.error).toContain('profile.json: events.dir');
    expect(EventSettings.dirOf({ root })).toBe(team);

    const messages = ProjectContract.checkAgents(ctx(root)).map((violation) => violation.message);

    expect(messages.join('\n')).toContain('events.dir');
  });

  test('the key is known to the file, and a mistyped one is not', () => {
    const root = project({ local: { events: { dir: shared() }, event: {} } });

    const profile = OwnerProfile.read({ root });

    expect(profile.ok).toBe(false);
    expect(profile.ok ? '' : profile.error).toContain('event');
  });

  test('sync keeps the key and leaves the manifest as it is without it', () => {
    const own = shared();
    const plain = project({ events: { log: true } });
    const withLocal = project({ events: { log: true }, local: { events: { dir: own } } });
    const config =
      "export default { name: 'acme', project: { key: 'ACME' }, events: { log: true } };\n";

    for (const root of [plain, withLocal]) {
      mkdirSync(join(root, '.configs'), { recursive: true });
      writeFileSync(join(root, '.configs/vulcan.config.mts'), config);
      expect(runCli({ args: ['sync', '--agents', 'claude'], cwd: root }).code).toBe(0);
    }

    expect(readFileSync(join(withLocal, MANIFEST), 'utf8')).toBe(
      readFileSync(join(plain, MANIFEST), 'utf8'),
    );
    expect(JSON.parse(readFileSync(join(withLocal, LOCAL), 'utf8')).events).toEqual({ dir: own });
  });
});

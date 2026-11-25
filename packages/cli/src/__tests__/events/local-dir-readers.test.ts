import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AgentConstants } from '../../agents/common/constants.ts';
import { VULCAN_CONFIG_SCHEMA } from '../../config/index.ts';
import { ProjectContract } from '../../doctor/checks.ts';
import { BoardStop, EventLog, FlowState } from '../../events/index.ts';
import { HookConstants } from '../../hooks/common/constants.ts';
import { AutoCleanRun } from '../../local/auto-clean-run.ts';
import { LocalClean } from '../../local/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';
import { wire } from './wire.helper.ts';

afterAll(removeProjects);

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date().setHours(12, 0, 0, 0);
const LOCAL = '.agents/local/profile.json';
const ACTOR = 'pnt-vulcan-1';
const day = (opts: { ago: number }): string => EventLog.dayOf({ time: NOW - opts.ago * DAY });
const git = (opts: { cwd: string; args: string[] }) =>
  Bun.spawnSync(['git', ...opts.args], { cwd: opts.cwd, stdout: 'pipe', stderr: 'pipe' });

/** A git project with the events log on and a shared folder named only in its local file; the folder holds day files of `days` ago. */
const setup = (opts: { days?: number[]; manifestDir?: string } = {}) => {
  const dir = createProject({ files: {} });
  const root = createProject({
    files: {
      '.agents/local/vulcan.manifest.json': JSON.stringify({
        project: { key: 'ACME' },
        events: { log: true, ...(opts.manifestDir === undefined ? {} : { dir: opts.manifestDir }) },
      }),
      [LOCAL]: JSON.stringify({ schemaVersion: 1, board: { events: { dir } } }),
      '.gitignore': '.agents/local/\n',
      'package.json': '{}',
    },
  });

  git({ cwd: root, args: ['init', '-q', '-b', 'develop'] });
  git({ cwd: root, args: ['config', 'user.email', 'a@example.com'] });
  git({ cwd: root, args: ['config', 'user.name', 'a'] });
  git({ cwd: root, args: ['add', '.'] });
  git({ cwd: root, args: ['commit', '-q', '-m', 'init'] });
  mkdirSync(join(root, '.agents/local/events'), { recursive: true });

  for (const ago of opts.days ?? []) {
    writeFileSync(join(dir, `${day({ ago })}.jsonl`), '{}\n');
  }

  return { root, dir };
};

describe('vulcan project clean --events with a local events.dir', () => {
  test('it lists and removes the day files of that folder only, by the limits of the manifest', () => {
    const { root, dir } = setup({ days: [60, 5, 0] });
    const own = join(root, `.agents/local/events/${day({ ago: 60 })}.jsonl`);

    writeFileSync(own, '{}\n');

    const dry = runCli({ args: ['project', 'clean', '--events'], cwd: root }).stderr;

    expect(dry).toContain(`${dir}/${day({ ago: 60 })}.jsonl`);
    expect(dry).not.toContain(own);
    expect(runCli({ args: ['project', 'clean', '--events', '--yes'], cwd: root }).code).toBe(0);
    expect(existsSync(join(dir, `${day({ ago: 60 })}.jsonl`))).toBe(false);
    expect(existsSync(join(dir, `${day({ ago: 5 })}.jsonl`))).toBe(true);
    expect(existsSync(join(dir, `${day({ ago: 0 })}.jsonl`))).toBe(true);
    expect(existsSync(own)).toBe(true);
  });

  test('a plan that names a day file of the committed folder, or of any other, is refused', () => {
    const team = createProject({ files: {} });
    const { root, dir } = setup({ days: [60], manifestDir: team });

    writeFileSync(join(team, `${day({ ago: 60 })}.jsonl`), 'keep');

    const entry = (path: string) => ({
      scope: 'events',
      name: 'x',
      where: path,
      path,
      bytes: 1,
      ageMs: 0,
      state: 'ok',
      removable: true,
      isSymlink: false,
      registered: false,
      note: '',
      outside: true,
    });
    const result = LocalClean.run({
      root,
      plan: {
        remove: [
          entry(join(team, `${day({ ago: 60 })}.jsonl`)),
          entry(join(dir, `${day({ ago: 60 })}.jsonl`)),
        ],
        keep: [],
      },
    });

    expect(result.removed).toHaveLength(1);
    expect(result.failed).toHaveLength(1);
    expect(readFileSync(join(team, `${day({ ago: 60 })}.jsonl`), 'utf8')).toBe('keep');
    expect(existsSync(join(dir, `${day({ ago: 60 })}.jsonl`))).toBe(false);
  });
});

describe('the other readers of the local folder', () => {
  test('the retention of the session start removes only what the limits say, in that folder', () => {
    const { root, dir } = setup({ days: [60, 3, 0] });
    const result = AutoCleanRun.run({ root, now: NOW });

    expect(result.files).toBe(1);
    expect(existsSync(join(dir, `${day({ ago: 60 })}.jsonl`))).toBe(false);
    expect(existsSync(join(dir, `${day({ ago: 3 })}.jsonl`))).toBe(true);
    expect(existsSync(join(dir, `${day({ ago: 0 })}.jsonl`))).toBe(true);
  });

  test('the Stop hook reads the flow and the commit lines from it', () => {
    const { root, dir } = setup();
    const at = Date.now() - 60_000;

    EventLog.append({
      dir,
      event: EventLog.build({
        type: 'flow',
        summary: 'Sign in',
        actor: ACTOR,
        source: 'cli',
        flowId: 'VULZ-ACME-1',
        steps: [{ text: 'Refresh', done: false }],
        now: at,
      }),
    });
    EventLog.append({
      dir,
      event: EventLog.build({
        type: 'commit',
        summary: 'commit',
        actor: ACTOR,
        source: 'claude-hook',
        flowId: 'VULZ-ACME-1',
        now: at + 1000,
      }),
    });

    const held = BoardStop.decide({
      root,
      input: wire({
        hookEventName: 'Stop',
        sessionId: 'abcdef12-3456-7890-abcd-ef1234567890',
        cwd: root,
      }),
      env: { VULCAN_ACTOR: ACTOR },
      isOver: FlowState.isOver,
      edited: () => false,
    });

    expect(held?.decision).toBe('block');
    expect(held?.reason).toContain("flow step --flow 'VULZ-ACME-1'");
  });
});

describe('doctor and the local folder', () => {
  test('events-size reports against the config, where maxSize lives, with the local folder it measured', () => {
    const { root, dir } = setup();

    writeFileSync(join(dir, `${EventLog.dayOf({ time: Date.now() })}.jsonl`), 'x'.repeat(4096));

    const [hit] = ProjectContract.checkEventsSize({
      root,
      config: VULCAN_CONFIG_SCHEMA.parse({ events: { log: true, maxSize: '1KB' } }),
      configFile: '.configs/vulcan.config.mts',
    });

    expect(hit?.file).toBe('.configs/vulcan.config.mts');
    expect(hit?.message).toContain(dir);
  });

  test('events-size of a committed folder is reported against the config too', () => {
    const team = createProject({ files: {} });
    const root = createProject({ files: { '.agents/local/vulcan.manifest.json': '{}' } });

    writeFileSync(join(team, `${EventLog.dayOf({ time: Date.now() })}.jsonl`), 'x'.repeat(4096));

    const [hit] = ProjectContract.checkEventsSize({
      root,
      config: VULCAN_CONFIG_SCHEMA.parse({ events: { log: true, dir: team, maxSize: '1KB' } }),
      configFile: '.configs/vulcan.config.mts',
    });

    expect(hit?.file).toBe('.configs/vulcan.config.mts');
  });
});

describe('vulcan project sync and an invalid local events.dir', () => {
  test('sync refuses, names the file and the key, and writes nothing; the readers fall back', () => {
    const root = createProject({
      files: {
        '.configs/vulcan.config.mts':
          "export default { project: { name: 'acme' }, board: { events: { log: true } } };\n",
        [LOCAL]: JSON.stringify({
          schemaVersion: 1,
          board: { events: { dir: 'relative/events' } },
        }),
      },
    });
    const result = runCli({ args: ['project', 'sync', '--agents', 'claude'], cwd: root });

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('profile.json');
    expect(result.stderr).toContain('events.dir');
    expect(existsSync(join(root, '.agents/local/vulcan.manifest.json'))).toBe(false);
  });
});

describe('the guard protects the local file under the name the agents code uses', () => {
  test('the protected list holds AgentConstants.LOCAL_FILE', () => {
    expect(HookConstants.PROTECTED_FILES).toContain(AgentConstants.LOCAL_FILE);
  });
});

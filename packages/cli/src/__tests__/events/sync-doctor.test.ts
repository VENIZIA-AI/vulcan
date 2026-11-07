import { afterAll, describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { VULCAN_CONFIG_SCHEMA } from '../../config/index.ts';
import { DoctorChecks, DoctorRunner } from '../../doctor/index.ts';
import { ProjectManifest } from '../../manifest/index.ts';
import { hermeticEnv } from '../hermetic.helper.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';

afterAll(removeProjects);

const SRC = join(import.meta.dir, '..', '..');
const HOOK_EVENTS = ['SessionStart', 'Stop', 'SubagentStop', 'Notification', 'PostToolUse'];
const HOOK = 'node_modules/@venizia/vulcan/base/hooks/event.ts';

const parse = (events: unknown) => VULCAN_CONFIG_SCHEMA.safeParse({ events });
const config = (opts: { events?: string; hooks?: string }) =>
  `export default {${opts.events === undefined ? '' : ` events: ${opts.events},`}${opts.hooks === undefined ? '' : ` hooks: ${opts.hooks},`} };\n`;

const projectWith = (opts: { events?: string; hooks?: string }): string =>
  createProject({ files: { '.configs/vulcan.config.mts': config(opts), 'AGENTS.md': '# x\n' } });

const sync = (opts: { root: string }) =>
  runCli({ args: ['sync', '--agents', 'claude'], cwd: opts.root, env: hermeticEnv() });

const settingsOf = (opts: {
  root: string;
}): {
  hooks?: Record<string, { matcher?: string; hooks: { command: string; timeout?: number }[] }[]>;
} => JSON.parse(readFileSync(join(opts.root, '.claude/settings.json'), 'utf8'));

const eventEntries = (opts: { root: string }) =>
  Object.entries(settingsOf(opts).hooks ?? {}).flatMap(([name, entries]) =>
    entries
      .filter((entry) => entry.hooks.some((hook) => hook.command.includes(HOOK)))
      .map((entry) => ({ name, entry })),
  );

describe('events in the config', () => {
  test('off by default, with no folder', () => {
    expect(VULCAN_CONFIG_SCHEMA.parse({}).events).toEqual({ log: false });
  });

  test('log and an absolute dir are accepted', () => {
    expect(parse({ log: true, dir: '/home/me/work/.agents/local/events' }).success).toBe(true);
    expect(parse({ dir: '/shared' }).success).toBe(true);
  });

  test('a relative dir, ~, an empty dir, a wrong type and an unknown key are refused, with the reason', () => {
    const relative = parse({ dir: 'events' });

    expect(relative.success).toBe(false);
    expect(JSON.stringify(relative.error?.issues)).toContain('absolute path');
    expect(parse({ dir: '~/events' }).success).toBe(false);
    expect(parse({ dir: '' }).success).toBe(false);
    expect(parse({ log: 'yes' }).success).toBe(false);
    expect(parse({ logging: true }).success).toBe(false);
    expect(VULCAN_CONFIG_SCHEMA.safeParse({ eventLog: true }).success).toBe(false);
  });
});

describe('the manifest', () => {
  const manifestOf = (events: unknown) =>
    JSON.parse(
      ProjectManifest.render({
        root: createProject({ files: {} }),
        config: VULCAN_CONFIG_SCHEMA.parse({ events }),
      }),
    );

  test('carries events only when the log is on or has a folder', () => {
    expect(manifestOf(undefined).events).toBeUndefined();
    expect(manifestOf({ log: false }).events).toBeUndefined();
    expect(manifestOf({ log: true }).events).toEqual({ log: true });
    expect(manifestOf({ dir: '/shared' }).events).toEqual({ log: false, dir: '/shared' });
    expect(manifestOf({ log: true, dir: '/shared' }).events).toEqual({ log: true, dir: '/shared' });
  });
});

describe('vulcan sync and the event hooks', () => {
  test('log: true installs one entry per event, SendMessage only on PostToolUse, fast and fail-open', () => {
    const root = projectWith({ events: '{ log: true }' });
    const result = sync({ root });

    expect(result.code, result.stderr).toBe(0);

    const found = eventEntries({ root });

    expect(found.map((item) => item.name).sort()).toEqual([...HOOK_EVENTS].sort());
    expect(found.find((item) => item.name === 'PostToolUse')?.entry.matcher).toBeUndefined();

    for (const { entry } of found) {
      const [hook] = entry.hooks;

      expect(hook.timeout).toBe(5);
      expect(hook.command).toEndWith('exit 0');
    }

    expect(sync({ root }).code).toBe(0);
    expect(eventEntries({ root })).toHaveLength(HOOK_EVENTS.length);
  });

  test('an old install, whose PostToolUse entry names the SendMessage tool, is replaced by the new one, not added to', () => {
    const root = projectWith({ events: '{ log: true }' });

    sync({ root });

    const file = join(root, '.claude/settings.json');
    const settings = JSON.parse(readFileSync(file, 'utf8'));
    const [entry] = settings.hooks.PostToolUse.filter((item: { hooks: { command: string }[] }) =>
      item.hooks.some((hook) => hook.command.includes(HOOK)),
    );

    entry.matcher = 'SendMessage';
    writeFileSync(file, JSON.stringify(settings, null, 2));

    expect(eventEntries({ root }).find((item) => item.name === 'PostToolUse')?.entry.matcher).toBe(
      'SendMessage',
    );
    expect(sync({ root }).code).toBe(0);

    const after = eventEntries({ root }).filter((item) => item.name === 'PostToolUse');

    expect(after).toHaveLength(1);
    expect(after[0].entry.matcher).toBeUndefined();
  });

  test('log off installs none; a dir alone installs none', () => {
    expect(
      eventEntries({
        root: (() => {
          const root = projectWith({});
          sync({ root });
          return root;
        })(),
      }),
    ).toHaveLength(0);

    const dirOnly = projectWith({ events: "{ dir: '/shared/events' }" });

    sync({ root: dirOnly });

    expect(eventEntries({ root: dirOnly })).toHaveLength(0);
    expect(
      JSON.parse(readFileSync(join(dirOnly, '.agents/vulcan.manifest.json'), 'utf8')).events,
    ).toEqual({ log: false, dir: '/shared/events' });
  });

  test('turning the log off takes exactly our entries back and keeps the project own hooks', () => {
    const own = "[{ event: 'Stop', command: 'echo mine' }]";
    const root = projectWith({ events: '{ log: true }', hooks: own });

    sync({ root });

    expect(eventEntries({ root })).toHaveLength(HOOK_EVENTS.length);

    writeFileSync(join(root, '.configs/vulcan.config.mts'), config({ hooks: own }));
    sync({ root });

    const after = settingsOf({ root });

    expect(eventEntries({ root })).toHaveLength(0);
    expect(JSON.stringify(after.hooks?.Stop)).toContain('echo mine');
    expect(after.hooks?.SessionStart?.length).toBeGreaterThan(0);
  });
});

describe('the hook stays light', () => {
  const transpiler = new Bun.Transpiler({ loader: 'ts' });
  const reached = (opts: { entry: string }) => {
    const files = new Set<string>();
    const packages = new Set<string>();
    const queue = [opts.entry];

    while (queue.length > 0) {
      const file = queue.pop() ?? '';

      if (files.has(file)) {
        continue;
      }

      files.add(file);

      for (const found of transpiler.scanImports(readFileSync(file, 'utf8'))) {
        if (found.path.startsWith('.')) {
          queue.push(join(dirname(file), found.path));
        } else {
          packages.add(found.path);
        }
      }
    }

    return { files, packages };
  };

  test('the events module reaches no config, no zod, no atlas and no other vulcan module but record.ts', () => {
    const { files, packages } = reached({ entry: join(SRC, 'events', 'hook.ts') });
    const outside = [...files]
      .map((file) => file.slice(SRC.length + 1))
      .filter((file) => !file.startsWith('events/'));

    expect(outside).toEqual(['common/record.ts']);
    expect([...packages].sort()).toEqual(['node:fs', 'node:os', 'node:path']);
  });

  test('the event command reaches atlas through no static import', () => {
    const { packages } = reached({ entry: join(SRC, 'commands', 'event.command.ts') });

    expect(packages.has('@venizia/vulcan-atlas')).toBe(false);
    expect(packages.has('zod')).toBe(false);
  });
});

describe('vulcan doctor and events.dir', () => {
  const warnings = async (opts: { root: string }) => {
    const all = await DoctorRunner.runWarnings({ root: opts.root });

    return all.filter((item) => item.check === DoctorChecks.EVENTS_DIR);
  };

  test('no dir, or a dir inside the project: no warning, even before the folder exists', async () => {
    const plain = await warnings({ root: projectWith({}) });
    const inside = await warnings({ root: projectWith({ events: '{ log: true }' }) });

    expect(plain).toEqual([]);
    expect(inside).toEqual([]);
  });

  test('a shared folder that exists and is writable: no warning', async () => {
    const shared = mkdtempSync(join(tmpdir(), 'vulcan-events-'));
    const found = await warnings({
      root: projectWith({ events: `{ log: true, dir: '${shared}' }` }),
    });

    expect(found).toEqual([]);
  });

  test('a shared folder that is missing, a file, or not writable is a warning with the fix', async () => {
    const base = mkdtempSync(join(tmpdir(), 'vulcan-events-'));
    const missing = join(base, 'nope');
    const file = join(base, 'file');
    const locked = join(base, 'locked');

    writeFileSync(file, 'x');
    mkdirSync(locked);
    chmodSync(locked, 0o500);

    const [gone] = await warnings({
      root: projectWith({ events: `{ log: true, dir: '${missing}' }` }),
    });
    const [notFolder] = await warnings({
      root: projectWith({ events: `{ log: true, dir: '${file}' }` }),
    });
    const unwritable = await warnings({
      root: projectWith({ events: `{ log: true, dir: '${locked}' }` }),
    });

    expect(gone.message).toContain(`does not exist - create it (mkdir -p ${missing})`);
    expect(notFolder.message).toContain('is not a folder');
    expect(gone.file).toBe('.configs/vulcan.config.mts');

    // A superuser writes anywhere, so the locked case holds only for an ordinary user.
    if (process.getuid?.() !== 0) {
      expect(unwritable[0]?.message).toContain('is not writable');
    }

    chmodSync(locked, 0o700);
  });
});

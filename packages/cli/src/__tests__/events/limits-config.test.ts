import { describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DoctorChecks, DoctorRunner } from '../../doctor/index.ts';
import { EventLog } from '../../events/log.ts';
import { VULCAN_CONFIG_SCHEMA } from '../../config/index.ts';
import { EventSettings } from '../../events/settings.ts';
import { ProjectManifest } from '../../manifest/index.ts';
import { createProject } from '../project.helper.ts';

const parse = (events: unknown) => VULCAN_CONFIG_SCHEMA.safeParse({ events });
const manifestOf = (config: object) =>
  JSON.parse(
    ProjectManifest.render({
      root: createProject({ files: {} }),
      config: VULCAN_CONFIG_SCHEMA.parse(config),
    }),
  );

describe('the limits of the event log in the config', () => {
  test('sizes such as 50MB, 200MB and 1GB, and whole numbers of files and days, are accepted', () => {
    expect(parse({ log: true, maxSize: '50MB', maxFiles: 30, maxAgeDays: 30 }).success).toBe(true);
    expect(parse({ maxSize: '200mb' }).success).toBe(true);
    expect(parse({ maxSize: '1 GB' }).success).toBe(true);
    expect(parse({ maxSize: '512KB' }).success).toBe(true);
  });

  test('a size without a unit, in terabytes, or in words, and a count that is zero, negative or fractional, are refused', () => {
    for (const maxSize of ['50', '5TB', 'big', '', '-1MB']) {
      const result = parse({ maxSize });

      expect(result.success, maxSize).toBe(false);
    }

    expect(JSON.stringify(parse({ maxSize: '50' }).error?.issues)).toContain(
      'a size such as 50MB, 200MB or 1GB',
    );

    for (const bad of [
      { maxFiles: 0 },
      { maxFiles: -1 },
      { maxFiles: 1.5 },
      { maxAgeDays: 0 },
      { maxAgeDays: 2.5 },
      { maxSize: 50 },
    ]) {
      expect(parse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  test('nothing is written to the manifest for the defaults, and only what is set when something is', () => {
    expect(manifestOf({}).events).toBeUndefined();
    expect(manifestOf({ events: { log: true } }).events).toEqual({ log: true });
    expect(
      manifestOf({ events: { log: true, maxSize: '200MB', maxFiles: 7, maxAgeDays: 3 } }).events,
    ).toEqual({
      log: true,
      maxSize: '200MB',
      maxFiles: 7,
      maxAgeDays: 3,
    });
    expect(manifestOf({ events: { maxFiles: 5 } }).events).toEqual({ log: false, maxFiles: 5 });
  });

  test('the settings reader takes valid limits from the manifest and drops invalid ones', () => {
    const read = (events: object) =>
      EventSettings.read({
        root: createProject({
          files: { '.agents/vulcan.manifest.json': JSON.stringify({ events }) },
        }),
      });

    expect(read({ log: true, maxSize: '1GB', maxFiles: 9, maxAgeDays: 4 })).toEqual({
      log: true,
      maxSize: '1GB',
      maxFiles: 9,
      maxAgeDays: 4,
    });
    expect(read({ log: true, maxSize: 'huge', maxFiles: 0, maxAgeDays: 1.5 })).toEqual({
      log: true,
    });
  });
});

describe('local.autoClean in the config', () => {
  test('on by default, and the manifest says nothing then', () => {
    expect(VULCAN_CONFIG_SCHEMA.parse({}).local).toEqual({ autoClean: true });
    expect(manifestOf({}).local).toBeUndefined();
    expect(manifestOf({ local: { autoClean: true } }).local).toBeUndefined();
  });

  test('turned off, the manifest carries it for the hook to read', () => {
    expect(manifestOf({ local: { autoClean: false } }).local).toEqual({ autoClean: false });
  });

  test('a value that is not a boolean and an unknown key are refused', () => {
    expect(VULCAN_CONFIG_SCHEMA.safeParse({ local: { autoClean: 'no' } }).success).toBe(false);
    expect(VULCAN_CONFIG_SCHEMA.safeParse({ local: { autoclean: false } }).success).toBe(false);
    expect(VULCAN_CONFIG_SCHEMA.safeParse({ local: { clean: true } }).success).toBe(false);
  });
});

describe("vulcan doctor and the size of today's event file", () => {
  const project = (events: string): { root: string; dir: string } => {
    const dir = join(createProject({ files: {} }), 'shared');
    const root = createProject({
      files: {
        '.configs/vulcan.config.mts': `export default { events: ${events.replace('DIR', JSON.stringify(dir))} };\n`,
        'AGENTS.md': '# x\n',
      },
    });

    mkdirSync(dir, { recursive: true });

    return { root, dir };
  };
  const warnings = async (root: string) => {
    const all = await DoctorRunner.runWarnings({ root });

    return all.filter((entry) => entry.check === DoctorChecks.EVENTS_SIZE);
  };
  const today = (): string => `${EventLog.dayOf({ time: Date.now() })}.jsonl`;

  test("warns when today's file alone is over maxSize, and says nothing is truncated", async () => {
    const { root, dir } = project("{ log: true, dir: DIR, maxSize: '1KB' }");

    writeFileSync(join(dir, today()), 'x'.repeat(5 * 1024));

    const found = await warnings(root);

    expect(found).toHaveLength(1);
    expect(found[0].message).toContain('over events.maxSize (1KB)');
    expect(found[0].message).toContain('nothing is truncated');
    expect(found[0].message).toContain('5.0 KB');
  });

  test('is quiet when today is within the limit, when the log is off with no limit, and when only old files are big', async () => {
    const within = project("{ log: true, dir: DIR, maxSize: '1MB' }");
    const off = project('{ log: false, dir: DIR }');
    const old = project("{ log: true, dir: DIR, maxSize: '1KB' }");

    writeFileSync(join(within.dir, today()), 'x'.repeat(5 * 1024));
    writeFileSync(join(off.dir, today()), 'x'.repeat(5 * 1024 * 1024));
    writeFileSync(
      join(old.dir, `${EventLog.dayOf({ time: Date.now() - 3 * 86_400_000 })}.jsonl`),
      'x'.repeat(5 * 1024),
    );

    const result = await warnings(within.root);
    expect(result).toEqual([]);
    const result2 = await warnings(off.root);
    expect(result2).toEqual([]);
    const result3 = await warnings(old.root);
    expect(result3).toEqual([]);
  });
});

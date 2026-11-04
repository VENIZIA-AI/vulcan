import { afterAll, describe, expect, test } from 'bun:test';
import { ProjectKey } from '../../events/project-key.ts';
import { VULCAN_CONFIG_SCHEMA } from '../../config/schema.ts';
import { DoctorRunner } from '../../doctor/index.ts';
import { EventSettings } from '../../events/settings.ts';
import { ProjectManifest } from '../../manifest/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';

afterAll(removeProjects);

const keyOf = (key: unknown) => VULCAN_CONFIG_SCHEMA.safeParse({ project: { key } });
const CONFIG = "export default { rules: { 'V-W-01': 'on-user-word' }, events: { log: true }";

describe('project.key: the key a flow is named by', () => {
  test.each(['ACME', 'AB', 'A1', 'ABCDEFGH', '12', 'X9Y8Z7'])('%s is accepted', (key) => {
    expect(keyOf(key).success).toBe(true);
  });

  test.each(['A', 'ABCDEFGHI', 'acme', 'Bana', 'BA-NA', 'BA NA', 'ACME!', '', 5, null])(
    '%p is refused',
    (key) => {
      expect(keyOf(key).success).toBe(false);
    },
  );

  test('an unknown key of the block is a typo, and an error', () => {
    expect(VULCAN_CONFIG_SCHEMA.safeParse({ project: { key: 'ACME', name: 'x' } }).success).toBe(
      false,
    );
  });

  test('a key is derived from a name: letters and digits, uppercase, the first 8, none under 2', () => {
    expect(ProjectKey.derive({ name: 'acme-forge' })).toBe('ACMEFORG');
    expect(ProjectKey.derive({ name: 'vulcan' })).toBe('VULCAN');
    expect(ProjectKey.derive({ name: 'a' })).toBeUndefined();
    expect(ProjectKey.derive({ name: '--' })).toBeUndefined();
    expect(ProjectKey.derive({ name: 'x-1' })).toBe('X1');
  });
});

describe('the manifest and the hook reader', () => {
  const manifestOf = (project: unknown) =>
    JSON.parse(
      ProjectManifest.render({
        root: createProject({ files: {} }),
        config: VULCAN_CONFIG_SCHEMA.parse(project === undefined ? {} : { project }),
      }),
    );

  test('the manifest carries the key only when it is set', () => {
    expect(manifestOf({ key: 'ACME' }).project).toEqual({ key: 'ACME' });
    expect(manifestOf(undefined).project).toBeUndefined();
  });

  test('the reader returns a valid key, and nothing for a missing, damaged or wrong one', () => {
    const rootWith = (manifest: string) =>
      createProject({ files: { '.agents/vulcan.manifest.json': manifest } });

    expect(EventSettings.keyOf({ root: rootWith('{"project":{"key":"ACME"}}') })).toBe('ACME');
    expect(EventSettings.keyOf({ root: rootWith('{"project":{"key":"acme"}}') })).toBeUndefined();
    expect(EventSettings.keyOf({ root: rootWith('{"project":{"key":5}}') })).toBeUndefined();
    expect(EventSettings.keyOf({ root: rootWith('{}') })).toBeUndefined();
    expect(EventSettings.keyOf({ root: rootWith('not json') })).toBeUndefined();
    expect(EventSettings.keyOf({ root: createProject({ files: {} }) })).toBeUndefined();
  });
});

describe('vulcan doctor: the project key', () => {
  const warningsOf = async (config: string): Promise<string[]> => {
    const root = createProject({ files: { '.configs/vulcan.config.mts': config } });
    const warnings = await DoctorRunner.runWarnings({ root });

    return warnings.filter((warning) => warning.check === 'project-key').map((one) => one.message);
  };

  test('the log is on and there is no key: one warning that says what to add', async () => {
    const warnings = await warningsOf(`${CONFIG} };\n`);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("project: { key: 'KEY' }");
    expect(warnings[0]).toContain('vulcan sync');
  });

  test('the log is on and the key is set: nothing to say', async () => {
    const result = await warningsOf(`${CONFIG}, project: { key: 'ACME' } };\n`);
    expect(result).toEqual([]);
  });

  test('the log is off: a key is no concern', async () => {
    const result = await warningsOf("export default { rules: { 'V-W-01': 'on-user-word' } };\n");
    expect(result).toEqual([]);
  });
});

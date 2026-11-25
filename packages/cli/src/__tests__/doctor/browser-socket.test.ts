import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ProjectContract } from '../../doctor/checks.ts';
import { DoctorRunner } from '../../doctor/index.ts';
import { BrowserSocket } from '../../local/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';

afterAll(removeProjects);

const CONFIG = "export default { agent: { rules: { 'V-W-01': 'on-user-word' } } };\n";
const TMP = '.agents/tmp';

/** A root whose socket path in the project tmp folder is exactly `length` characters. */
const rootFor = (opts: { length: number }): string => {
  const below = join(TMP, BrowserSocket.longest()).length + 2;

  return `/${'a'.repeat(opts.length - below)}`;
};

/** A project far deeper than a socket path allows. */
const deepProject = (): string => {
  const base = createProject({ files: { '.configs/vulcan.config.mts': CONFIG } });
  const deep = join(base, 'd'.repeat(80));

  mkdirSync(join(deep, '.configs'), { recursive: true });
  mkdirSync(join(deep, '.agents/local'), { recursive: true });
  writeFileSync(join(deep, '.configs/vulcan.config.mts'), CONFIG);

  return deep;
};

describe('BrowserSocket', () => {
  test('the limit is 107 and the longest name is the Chromium one', () => {
    expect(BrowserSocket.PATH_MAX).toBe(107);
    expect(BrowserSocket.longest()).toBe('org.chromium.Chromium.XXXXXX/SingletonSocket');
  });

  test('a folder fits at 107 characters and not at 108', () => {
    const at = (length: number): string => join(rootFor({ length }), TMP);

    expect(BrowserSocket.lengthOf({ folder: at(107) })).toBe(107);
    expect(BrowserSocket.fits({ folder: at(107) })).toBe(true);
    expect(BrowserSocket.fits({ folder: at(108) })).toBe(false);
  });
});

describe('vulcan project doctor: the project tmp folder and a browser socket', () => {
  test('a deep checkout: the warning names the folder, the length, the limit and the shorter path', async () => {
    const root = deepProject();
    const folder = join(root, TMP);
    const found = ProjectContract.checkBrowserSocket({ root });
    const fitting = BrowserSocket.PATH_MAX - (join(TMP, BrowserSocket.longest()).length + 1);

    expect(found).toHaveLength(1);
    expect(found[0]?.file).toBe(TMP);
    expect(found[0]?.message).toContain(folder);
    expect(found[0]?.message).toContain(
      `would be ${BrowserSocket.lengthOf({ folder })} characters`,
    );
    expect(found[0]?.message).toContain('the limit is 107');
    expect(found[0]?.message).toContain('Socket path too long');
    expect(found[0]?.message).toContain(`a path of ${fitting} characters or fewer`);

    const warnings = await DoctorRunner.runWarnings({ root });

    expect(
      warnings.filter((warning) => warning.message.includes('Socket path too long')),
    ).toHaveLength(1);
  });

  test('a trailing slash on the root changes nothing', () => {
    const root = deepProject();

    expect(ProjectContract.checkBrowserSocket({ root: `${root}/` })).toEqual(
      ProjectContract.checkBrowserSocket({ root }),
    );
  });
});

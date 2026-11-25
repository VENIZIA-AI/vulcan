import { afterAll, expect, test } from 'bun:test';
import { mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { DoctorChecks, DoctorRunner } from '../../doctor/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';

afterAll(removeProjects);

const CONFIG = `export default { project: { packages: [{ dir: 'core', name: '@a/core' }] }, knowledge: { changelogs: 'docs/changelogs' } };
`;

const LOG = "---\ntitle: 0.4.9\nversion: 0.4.9\npackages: ['@a/core']\n---\nNo change.\n";

const projectWith = (opts: { vulcan?: string; folder?: boolean }): string =>
  createProject({
    files: {
      '.configs/vulcan.config.mts': CONFIG,
      ...(opts.folder === false ? {} : { 'docs/changelogs/0.4.9/log.md': LOG }),
      ...(opts.vulcan === undefined
        ? {}
        : {
            'node_modules/@venizia/vulcan/package.json': JSON.stringify({
              name: '@venizia/vulcan',
              version: opts.vulcan,
            }),
          }),
    },
  });

const violationsOf = async (opts: { root: string }) => {
  const checks = await DoctorRunner.runChecks({ root: opts.root });

  return checks.filter((violation) => violation.check === DoctorChecks.CHANGELOG_FOLDERS);
};

test('version folders with an installed vulcan older than the atlas that reads them is a violation naming both', async () => {
  const found = await violationsOf({ root: projectWith({ vulcan: '0.4.9' }) });

  expect(found).toHaveLength(1);
  expect(found[0].message).toContain('0.4.9');
  expect(found[0].message).toContain('0.4.10-16');
});

test('the line itself, a later one, a prerelease of the line, and a project with no folder pass', async () => {
  for (const vulcan of ['0.4.10-16', '0.4.10-20', '0.4.10', '0.4.11']) {
    const found = await violationsOf({ root: projectWith({ vulcan }) });

    expect(found).toEqual([]);
  }

  const withoutFolder = await violationsOf({
    root: projectWith({ vulcan: '0.4.9', folder: false }),
  });

  expect(withoutFolder).toEqual([]);
});

test('a project whose vulcan is not installed is not told anything', async () => {
  const found = await violationsOf({ root: projectWith({}) });

  expect(found).toEqual([]);
});

test('a prerelease of the line before the one that carries the reader is told to install a newer one', async () => {
  for (const vulcan of ['0.4.10-15', '0.4.10-3', '0.4.9-6']) {
    const found = await violationsOf({ root: projectWith({ vulcan }) });

    expect(found).toHaveLength(1);
  }
});

test('the workspace package of the project itself is not an older release: the repository of vulcan passes', async () => {
  const root = createProject({
    files: {
      '.configs/vulcan.config.mts': CONFIG,
      'docs/changelogs/0.4.9/log.md': LOG,
      'packages/cli/package.json': JSON.stringify({ name: '@venizia/vulcan', version: '0.4.9' }),
    },
  });

  mkdirSync(join(root, 'node_modules', '@venizia'), { recursive: true });
  symlinkSync(join(root, 'packages', 'cli'), join(root, 'node_modules', '@venizia', 'vulcan'));

  const found = await violationsOf({ root });

  expect(found).toEqual([]);
});

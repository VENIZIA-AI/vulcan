import { afterAll, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { DoctorChecks, runDoctorChecks } from '../../doctor/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';

afterAll(removeProjects);

const CONFIG = `export default {
  packages: [
    { dir: 'core-server', name: '@a/server', aliases: ['core'] },
    { dir: 'old', name: '@a/old', retired: true },
  ],
  atlas: { tagPattern: '<dir>-v<version>', ignoreTags: ['legacy/*'] },
};
`;

const projectWithTags = (opts: { tags: string[] }): string => {
  const root = createProject({ files: { '.configs/vulcan.config.ts': CONFIG } });
  const git = (args: string[]): void => {
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
      cwd: root,
      stdio: 'ignore',
    });
  };

  git(['init', '-q']);
  git(['commit', '-q', '--allow-empty', '-m', 'init']);

  for (const tag of opts.tags) {
    git(['tag', tag]);
  }

  return root;
};

const tagViolations = async (opts: { root: string }) =>
  (await runDoctorChecks({ root: opts.root })).filter(
    violation => violation.check === DoctorChecks.TAGS,
  );

test('every tag the pattern reads names a declared package - by directory, alias or retired', async () => {
  const root = projectWithTags({
    tags: ['core-server-v1.0.0', 'core-v0.1.0', 'old-v0.0.1', 'legacy/0.0.1-0', 'not-a-release'],
  });

  expect(await tagViolations({ root })).toEqual([]);
});

test('a tag naming no declared package is a violation (positive control)', async () => {
  const root = projectWithTags({ tags: ['core-server-v1.0.0', 'ghost-v1.0.0'] });
  const violations = await tagViolations({ root });

  expect(violations.map(violation => violation.message)).toEqual([
    "tag ghost-v1.0.0 reads as a release of 'ghost', which no package declares - declare it (retired: true if it is gone), add it as an alias, or ignore the tag (atlas.ignoreTags)",
  ]);
});

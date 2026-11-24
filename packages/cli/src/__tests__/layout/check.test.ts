import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { VULCAN_CONFIG_SCHEMA } from '../../config/schema.ts';
import { DoctorRunner } from '../../doctor/index.ts';
import type { TLayoutSettings } from '../../doctor/schema.ts';
import { LayoutBaseline } from '../../layout/baseline.ts';
import { LayoutCheck } from '../../layout/check.ts';
import type { ILayoutFileText } from '../../layout/common/index.ts';
import { createProject, removeProjects } from '../project.helper.ts';
import { runCli } from '../run.helper.ts';

afterAll(removeProjects);

const SETTINGS: TLayoutSettings = {
  maxLines: 400,
  minSubfolders: 3,
  pluralAllow: [],
  generated: [],
};

/** The findings, as `rule path`, of `files` under `src`; `texts` gives a file its line count and head, the rest have 10 lines. */
const findingsOf = (opts: {
  files: string[];
  texts?: Record<string, ILayoutFileText>;
  settings?: Partial<TLayoutSettings>;
  roots?: string[];
}): string[] =>
  LayoutCheck.check({
    files: opts.files,
    roots: opts.roots ?? ['src'],
    settings: { ...SETTINGS, ...opts.settings },
    read: ({ file }) => opts.texts?.[file] ?? { lines: 10, head: '' },
  }).map((finding) => `${finding.rule} ${finding.path}`);

describe('LayoutCheck.check: plural-suffix', () => {
  test('a plural role names its singular; ies, an irregular plural and a role before .test count', () => {
    const findings = LayoutCheck.check({
      files: [
        'src/user.helpers.ts',
        'src/db.repositories.tsx',
        'src/a.aliases.ts',
        'src/order.services.test.ts',
      ],
      roots: ['src'],
      settings: SETTINGS,
      read: () => ({ lines: 1, head: '' }),
    });

    expect(findings.map((finding) => finding.message)).toEqual([
      'the role "aliases" is plural: name the file a.alias.ts',
      'the role "repositories" is plural: name the file db.repository.tsx',
      'the role "services" is plural: name the file order.service.test.ts',
      'the role "helpers" is plural: name the file user.helper.ts',
    ]);
  });

  test('a singular role, a stem that ends in s, the allow list and the project list pass', () => {
    expect(
      findingsOf({
        files: [
          'src/user.helper.ts',
          'src/constants.ts',
          'src/button.stories.tsx',
          'src/theme.css.ts',
          'src/user.class.ts',
          'src/job.status.ts',
          'src/types.d.ts',
          'src/news.feeds.ts',
          'src/app.news.ts',
          'src/README.helpers.md',
          'src/x.statuses.ts',
          'src/y.constructor.ts',
          'src/z.toString.ts',
        ],
        settings: { pluralAllow: ['news', 'feeds', 'statuses'] },
      }),
    ).toEqual([]);
  });
});

describe('LayoutCheck.check: mixed-folder', () => {
  const folders = ['src/a/x.ts', 'src/b/x.ts', 'src/c/x.ts'];

  test('three subfolders and a loose source file is a finding; index.ts and index.tsx are not loose', () => {
    expect(findingsOf({ files: [...folders, 'src/main.ts'] })).toEqual(['mixed-folder src']);
    expect(findingsOf({ files: [...folders, 'src/index.ts', 'src/index.tsx'] })).toEqual([]);
  });

  test('two subfolders, or loose files that are not source, are not; a deeper folder is read too', () => {
    expect(findingsOf({ files: ['src/a/x.ts', 'src/b/x.ts', 'src/main.ts'] })).toEqual([]);
    expect(findingsOf({ files: [...folders, 'src/README.md'] })).toEqual([]);
    expect(
      findingsOf({
        files: ['src/ui/a/x.tsx', 'src/ui/b/x.tsx', 'src/ui/c/x.tsx', 'src/ui/app.tsx'],
      }),
    ).toEqual(['mixed-folder src/ui']);
    expect(
      findingsOf({ files: [...folders, 'src/main.ts'], settings: { minSubfolders: 4 } }),
    ).toEqual([]);
  });

  test('a root inside another root counts its files once, under the outer root', () => {
    const files = [
      'backends/api/src/a/x.ts',
      'backends/api/src/b/x.ts',
      'backends/api/src/c/x.ts',
      'backends/api/src/main.ts',
      'backends/api/src/user.helpers.ts',
    ];

    expect(findingsOf({ files, roots: ['backends', 'backends/api'] })).toEqual([
      'mixed-folder backends/api/src',
      'plural-suffix backends/api/src/user.helpers.ts',
    ]);
    expect(findingsOf({ files, roots: ['backends/api', 'backends'] })).toEqual(
      findingsOf({ files, roots: ['backends', 'backends/api'] }),
    );
  });

  test('only folders under a root are read', () => {
    expect(findingsOf({ files: [...folders, 'src/main.ts'], roots: ['lib'] })).toEqual([]);
  });
});

describe('LayoutCheck.check: long-file', () => {
  test('over the limit is a finding, the limit itself is not', () => {
    expect(
      findingsOf({
        files: ['src/a.ts', 'src/b.tsx'],
        texts: { 'src/a.ts': { lines: 401, head: '' }, 'src/b.tsx': { lines: 400, head: '' } },
      }),
    ).toEqual(['long-file src/a.ts']);
  });

  test('a generated header comment or a generated glob skips the file; the word in code does not', () => {
    const long = (head: string): ILayoutFileText => ({ lines: 900, head });

    expect(
      findingsOf({
        files: ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/gen/d.ts', 'src/e.ts'],
        texts: {
          'src/a.ts': long('// Code generated by protoc. DO NOT EDIT.\nexport {};'),
          'src/b.ts': long('/**\n * This file is auto-generated.\n */\nexport {};'),
          'src/c.ts': long("import { x } from './generated-block.ts';"),
          'src/gen/d.ts': long(''),
          'src/e.ts': long('// do not edit by hand'),
        },
        settings: { generated: ['src/gen/**'] },
      }),
    ).toEqual(['long-file src/c.ts']);
  });

  test('a file the reader cannot read is skipped', () => {
    expect(
      LayoutCheck.check({
        files: ['src/a.ts'],
        roots: ['src'],
        settings: SETTINGS,
        read: () => undefined,
      }),
    ).toEqual([]);
  });
});

describe('LayoutCheck.roots', () => {
  const config = (opts: { input: Record<string, unknown> }) =>
    VULCAN_CONFIG_SCHEMA.parse(opts.input);

  test('the package paths and the managed layout folders, without retired packages and other', () => {
    expect(
      LayoutCheck.roots({
        config: config({
          input: {
            packages: [
              { dir: 'core', name: 'core' },
              { dir: 'old', name: 'old', retired: true },
              { dir: 'web', name: 'web', path: 'apps/web' },
            ],
            layout: { backend: 'backends', shared: ['libs'], other: 'docs' },
          },
        }),
        files: [],
      }),
    ).toEqual(['packages/core', 'apps/web', 'backends', 'libs']);
  });

  test('with none declared, every outermost src folder', () => {
    expect(
      LayoutCheck.roots({
        config: config({ input: {} }),
        files: ['src/a.ts', 'tools/x/src/b.ts', 'tools/x/src/src/c.ts', 'README.md', 'docs/src'],
      }),
    ).toEqual(['src', 'tools/x/src']);
  });
});

describe('LayoutBaseline', () => {
  test('splits the findings into open and accepted, lists stale entries, and writes sorted entries', () => {
    const root = createProject({ files: {} });
    const findings = LayoutCheck.check({
      files: ['src/z.helpers.ts', 'src/a.models.ts'],
      roots: ['src'],
      settings: SETTINGS,
      read: () => ({ lines: 500, head: '' }),
    });

    expect(LayoutBaseline.write({ root, findings: findings.slice(0, 2) })).toBe(2);
    expect(JSON.parse(readFileSync(join(root, '.configs/layout-baseline.json'), 'utf8'))).toEqual([
      { rule: 'long-file', path: 'src/a.models.ts' },
      { rule: 'plural-suffix', path: 'src/a.models.ts' },
    ]);

    const read = LayoutBaseline.read({ root });
    const entries = 'entries' in read ? read.entries : [];
    const split = LayoutBaseline.split({
      findings: findings.filter((finding) => finding.rule !== 'long-file'),
      entries,
    });

    expect(split.open.map((finding) => finding.path)).toEqual(['src/z.helpers.ts']);
    expect(split.accepted.map((finding) => finding.path)).toEqual(['src/a.models.ts']);
    expect(split.stale).toEqual([{ rule: 'long-file', path: 'src/a.models.ts' }]);
  });

  test('no file is an empty baseline; a file that is not one says why', () => {
    const root = createProject({ files: {} });

    expect(LayoutBaseline.read({ root })).toEqual({ entries: [] });
    const notJson = createProject({ files: { '.configs/layout-baseline.json': '{' } });
    const unparsed = LayoutBaseline.read({ root: notJson });

    expect('error' in unparsed && unparsed.error).toContain('is not JSON');

    const broken = createProject({
      files: { '.configs/layout-baseline.json': '[{ "rule": "too-long", "path": "a" }]' },
    });
    const result = LayoutBaseline.read({ root: broken });

    expect('error' in result && result.error).toContain(
      'one of plural-suffix, mixed-folder, long-file',
    );
  });
});

/** A git repository holding `files`, all tracked. */
const repository = (opts: { files: Record<string, string> }): string => {
  const root = createProject({ files: opts.files });

  for (const args of [
    ['init', '-q', '-b', 'main'],
    ['add', '-A'],
  ]) {
    spawnSync('git', args, { cwd: root });
  }

  return root;
};

const PROJECT = {
  '.configs/vulcan.config.mts': 'export default {\n  name: "demo",\n};\n',
  'src/a/x.ts': '',
  'src/b/x.ts': '',
  'src/c/x.ts': '',
  'src/main.ts': '',
  'src/user.helpers.ts': '',
  'src/long.ts': 'export const a = 1;\n'.repeat(401),
};

describe('vulcan layout check', () => {
  test('reads the tracked files from disk: a link is skipped, the line count is exact', () => {
    const root = repository({ files: PROJECT });

    symlinkSync(join(root, 'src/long.ts'), join(root, 'src/link.ts'));
    spawnSync('git', ['add', '-A'], { cwd: root });

    expect(LayoutCheck.readFile({ root, file: 'src/long.ts' })?.lines).toBe(401);
    expect(LayoutCheck.readFile({ root, file: 'src/link.ts' })).toBeUndefined();
  });

  test('exits 1 on new findings, writes the baseline, then exits 0 with each finding as info', () => {
    const root = repository({ files: PROJECT });
    const first = runCli({ args: ['layout', 'check'], cwd: root });

    expect(first.code).toBe(1);
    expect(first.stderr).toContain(
      'warning [plural-suffix] src/user.helpers.ts: the role "helpers" is plural',
    );
    expect(first.stderr).toContain('warning [mixed-folder] src:');
    expect(first.stderr).toContain('warning [long-file] src/long.ts: 401 lines');
    expect(first.stderr).toContain(
      'vulcan layout: 3 new, 0 in the baseline, 0 stale baseline entries',
    );

    const write = runCli({ args: ['layout', 'check', '--write-baseline'], cwd: root });

    expect(write.code).toBe(0);
    expect(write.stdout).toContain('wrote 3 finding(s) to .configs/layout-baseline.json');

    const second = runCli({ args: ['layout', 'check'], cwd: root });

    expect(second.code).toBe(0);
    expect(second.stderr).toContain('info [long-file] src/long.ts: 401 lines');
    expect(second.stderr).toContain(
      'vulcan layout: 0 new, 3 in the baseline, 0 stale baseline entries',
    );
  });

  test('exits 2 on bad arguments and outside a git repository', () => {
    const root = repository({ files: PROJECT });

    expect(runCli({ args: ['layout'], cwd: root }).code).toBe(2);
    expect(runCli({ args: ['layout', 'check', '--fix'], cwd: root }).code).toBe(2);
    expect(
      runCli({
        args: ['layout', 'check'],
        cwd: createProject({ files: { '.configs/vulcan.config.mts': 'export default {};\n' } }),
      }).code,
    ).toBe(2);
  });

  test('the doctor says nothing of a folder git cannot list', async () => {
    const root = createProject({ files: PROJECT });
    const warnings = await DoctorRunner.runWarnings({ root });

    expect(warnings.filter((entry) => entry.check === 'file-layout')).toEqual([]);
  });

  test('the doctor warns once per rule for new findings and notes the accepted ones', async () => {
    const root = repository({ files: PROJECT });
    const ofLayout = (list: { check: string; file: string; message: string }[]) =>
      list
        .filter((entry) => entry.check === 'file-layout')
        .map((entry) => `${entry.file}: ${entry.message}`);

    const result = await DoctorRunner.runWarnings({ root });
    expect(ofLayout(result)).toEqual([
      'src/user.helpers.ts: plural-suffix: the role "helpers" is plural: name the file user.helper.ts',
      'src: mixed-folder: 3 subfolders beside 3 loose file(s) (long.ts, main.ts, user.helpers.ts): move the files into a subfolder; only index.ts or index.tsx stays beside subfolders',
      'src/long.ts: long-file: 401 lines, over doctor.layout.maxLines (400): split it by concern',
    ]);

    LayoutBaseline.write({
      root,
      findings: [{ rule: 'long-file', path: 'src/gone.ts', message: '' }],
    });

    const result2 = await DoctorRunner.runNotes({ root, env: {} });
    expect(ofLayout(result2)).toEqual([
      '.configs/layout-baseline.json: 1 baseline entry matches nothing any more: run `bun node_modules/.bin/vulcan layout check --write-baseline`',
    ]);
    const result3 = await DoctorRunner.runWarnings({ root });
    expect(ofLayout(result3)).toHaveLength(3);

    runCli({ args: ['layout', 'check', '--write-baseline'], cwd: root });

    const result4 = await DoctorRunner.runWarnings({ root });
    expect(ofLayout(result4)).toEqual([]);
    const result5 = await DoctorRunner.runNotes({ root, env: {} });
    expect(ofLayout(result5)).toEqual([
      '.configs/layout-baseline.json: 3 layout finding(s) accepted in the baseline',
    ]);
  });
});

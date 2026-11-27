import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { VULCAN_CONFIG_SCHEMA } from '../../config/schema.ts';
import { DoctorRunner } from '../../doctor/index.ts';
import type { TLayoutSettings } from '../../config/sections/doctor/index.ts';
import { LayoutBaseline } from '../../layout/baseline.ts';
import { LayoutCheck } from '../../layout/check.ts';
import type { ILayoutFileText } from '../../layout/common/index.ts';
import { createProject, removeProjects } from '../helpers/project.helper.ts';
import { runCli } from '../helpers/run.helper.ts';

afterAll(removeProjects);

const SETTINGS: TLayoutSettings = {
  maxLines: 600,
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
        texts: { 'src/a.ts': { lines: 601, head: '' }, 'src/b.tsx': { lines: 600, head: '' } },
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

  const long = { lines: 601, head: '' };

  test('the default is 600 lines, and a test file is never too long', () => {
    expect(VULCAN_CONFIG_SCHEMA.parse({}).doctor.layout.maxLines).toBe(600);

    const files = [
      'src/a.test.ts',
      'src/b.test.tsx',
      'src/__tests__/helper.ts',
      'src/__tests__/deep/fixture.ts',
      'src/a.spec.ts',
      'src/a.testing.ts',
      'src/a.specific.ts',
      'src/test.ts',
    ];
    const texts = Object.fromEntries(files.map((file) => [file, long]));

    expect(
      findingsOf({ files, texts }).filter((finding) => finding.startsWith('long-file')),
    ).toEqual([
      'long-file src/a.specific.ts',
      'long-file src/a.testing.ts',
      'long-file src/test.ts',
    ]);
  });

  test('a test file keeps the other rules', () => {
    expect(findingsOf({ files: ['src/user.helpers.test.ts'] })).toEqual([
      'plural-suffix src/user.helpers.test.ts',
    ]);
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
      read: () => ({ lines: 700, head: '' }),
    });

    expect(LayoutBaseline.write({ root, findings: findings.slice(0, 2) })).toBe(2);
    expect(
      JSON.parse(readFileSync(join(root, '.configs/vulcan/layout/baseline.json'), 'utf8')),
    ).toEqual([
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
    const notJson = createProject({ files: { '.configs/vulcan/layout/baseline.json': '{' } });
    const unparsed = LayoutBaseline.read({ root: notJson });

    expect('error' in unparsed && unparsed.error).toContain('is not JSON');

    const broken = createProject({
      files: { '.configs/vulcan/layout/baseline.json': '[{ "rule": "too-long", "path": "a" }]' },
    });
    const result = LayoutBaseline.read({ root: broken });

    expect('error' in result && result.error).toContain(
      'one of plural-suffix, mixed-folder, long-file',
    );
  });
});

describe('a baseline at the old path', () => {
  const OLD = '.configs/layout-baseline.json';
  const MOVE =
    'mkdir -p .configs/vulcan/layout && mv .configs/layout-baseline.json .configs/vulcan/layout/baseline.json';

  test('stops the check with the command that moves it, with or without a new one', () => {
    const only = createProject({ files: { [OLD]: '[]' } });
    const both = createProject({
      files: { [OLD]: '[]', '.configs/vulcan/layout/baseline.json': '[]' },
    });

    for (const root of [only, both]) {
      const result = LayoutBaseline.read({ root });

      expect('error' in result && result.error).toContain(MOVE);
    }
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
  '.configs/vulcan.config.mts': 'export default {\n  project: { name: "demo" },\n};\n',
  'src/a/x.ts': '',
  'src/b/x.ts': '',
  'src/c/x.ts': '',
  'src/main.ts': '',
  'src/user.helpers.ts': '',
  'src/long.ts': 'export const a = 1;\n'.repeat(601),
};

describe('vulcan check layout', () => {
  test('reads the tracked files from disk: a link is skipped, the line count is exact', () => {
    const root = repository({ files: PROJECT });

    symlinkSync(join(root, 'src/long.ts'), join(root, 'src/link.ts'));
    spawnSync('git', ['add', '-A'], { cwd: root });

    expect(LayoutCheck.readFile({ root, file: 'src/long.ts' })?.lines).toBe(601);
    expect(LayoutCheck.readFile({ root, file: 'src/link.ts' })).toBeUndefined();
  });

  test('exits 1 on new findings, writes the baseline, then exits 0 with each finding as info', () => {
    const root = repository({ files: PROJECT });
    const first = runCli({ args: ['check', 'layout'], cwd: root });

    expect(first.code).toBe(1);
    expect(first.stderr).toContain(
      'warning [plural-suffix] src/user.helpers.ts: the role "helpers" is plural',
    );
    expect(first.stderr).toContain('warning [mixed-folder] src:');
    expect(first.stderr).toContain('warning [long-file] src/long.ts: 601 lines');
    expect(first.stderr).toContain(
      'vulcan check layout: 3 new, 0 in the baseline, 0 stale baseline entries',
    );

    const write = runCli({ args: ['check', 'layout', '--write-baseline'], cwd: root });

    expect(write.code).toBe(0);
    expect(write.stdout).toContain('wrote 3 finding(s) to .configs/vulcan/layout/baseline.json');

    const second = runCli({ args: ['check', 'layout'], cwd: root });

    expect(second.code).toBe(0);
    expect(second.stderr).toContain('info [long-file] src/long.ts: 601 lines');
    expect(second.stderr).toContain(
      'vulcan check layout: 0 new, 3 in the baseline, 0 stale baseline entries',
    );
  });

  test('a long file is a warning that leaves the exit code 0; a mixed folder and a plural role still fail', () => {
    const codeOf = (files: Record<string, string>) => {
      const root = repository({
        files: { '.configs/vulcan.config.mts': PROJECT['.configs/vulcan.config.mts'], ...files },
      });

      return runCli({ args: ['check', 'layout'], cwd: root });
    };
    const long = codeOf({ 'src/long.ts': PROJECT['src/long.ts'] });

    expect(long.code, long.stderr).toBe(0);
    expect(long.stderr).toContain('warning [long-file] src/long.ts: 601 lines');
    expect(long.stderr).toContain('vulcan check layout: 1 new, 0 in the baseline');
    expect(codeOf({ 'src/user.helpers.ts': '', 'src/long.ts': PROJECT['src/long.ts'] }).code).toBe(
      1,
    );
    expect(
      codeOf({ 'src/a/x.ts': '', 'src/b/x.ts': '', 'src/c/x.ts': '', 'src/main.ts': '' }).code,
    ).toBe(1);
  });

  test('exits 2 on bad arguments, 1 outside a git work tree and on a baseline that is not valid', () => {
    const root = repository({ files: PROJECT });
    const outside = runCli({
      args: ['check', 'layout'],
      cwd: createProject({ files: { '.configs/vulcan.config.mts': 'export default {};\n' } }),
    });

    expect(runCli({ args: ['check'], cwd: root }).code).toBe(2);
    expect(runCli({ args: ['check', 'layout', '--fix'], cwd: root }).code).toBe(2);
    expect(outside.code).toBe(1);
    expect(outside.stderr).toContain('is not in a git work tree');

    mkdirSync(join(root, '.configs/vulcan/layout'), { recursive: true });
    writeFileSync(join(root, '.configs/vulcan/layout/baseline.json'), '{');

    expect(runCli({ args: ['check', 'layout'], cwd: root }).code).toBe(1);
  });

  test('--write-baseline writes nothing while a baseline is at the old path', () => {
    const root = repository({ files: { ...PROJECT, '.configs/layout-baseline.json': '[]' } });
    const write = runCli({ args: ['check', 'layout', '--write-baseline'], cwd: root });

    expect(write.code).toBe(1);
    expect(write.stderr).toContain('mv .configs/layout-baseline.json');
    expect(existsSync(join(root, '.configs/vulcan/layout/baseline.json'))).toBe(false);
  });

  test('reads a listing of more than 1 MB', () => {
    const root = repository({ files: { 'README.md': '' } });
    const stem = 'a'.repeat(200);
    const blob = spawnSync('git', ['hash-object', '-w', '--stdin'], { cwd: root, input: '' })
      .stdout.toString()
      .trim();
    const entries = Array.from(
      { length: 6000 },
      (_, index) => `100644 ${blob}\tsrc/${stem}${index}.ts`,
    );

    spawnSync('git', ['update-index', '--index-info'], {
      cwd: root,
      input: `${entries.join('\n')}\n`,
    });

    const tracked = LayoutCheck.trackedFiles({ root });
    const listing = spawnSync('git', ['ls-files', '-z'], {
      cwd: root,
      maxBuffer: 64 * 1024 * 1024,
    });

    expect(listing.stdout.length).toBeGreaterThan(1024 * 1024);
    expect('files' in tracked && tracked.files.length).toBe(6001);
  });

  test('the doctor warns, naming the cause, when git gives no listing in a work tree', async () => {
    const root = repository({ files: PROJECT });

    writeFileSync(join(root, '.git/index'), 'not an index');

    const warnings = await DoctorRunner.runWarnings({ root });

    expect(
      warnings.filter((entry) => entry.check === 'file-layout').map((entry) => entry.message),
    ).toEqual([expect.stringContaining('git ls-files gave no listing')]);
  });

  test('the doctor says nothing outside a git work tree', async () => {
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
      'src/long.ts: long-file: 601 lines, over check.layout.maxLines (600): split it by concern',
    ]);

    LayoutBaseline.write({
      root,
      findings: [{ rule: 'long-file', path: 'src/gone.ts', message: '' }],
    });

    const staleNotes = await DoctorRunner.runNotes({ root, env: {} });

    expect(ofLayout(staleNotes)).toEqual([
      '.configs/vulcan/layout/baseline.json: 1 baseline entry matches nothing any more: run `bun node_modules/.bin/vulcan check layout --write-baseline`',
    ]);
    const openWarnings = await DoctorRunner.runWarnings({ root });

    expect(ofLayout(openWarnings)).toHaveLength(3);

    runCli({ args: ['check', 'layout', '--write-baseline'], cwd: root });

    const adoptedWarnings = await DoctorRunner.runWarnings({ root });

    expect(ofLayout(adoptedWarnings)).toEqual([]);
    const adoptedNotes = await DoctorRunner.runNotes({ root, env: {} });

    expect(ofLayout(adoptedNotes)).toEqual([
      '.configs/vulcan/layout/baseline.json: 3 layout finding(s) accepted in the baseline',
    ]);
  });
});

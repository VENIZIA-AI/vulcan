import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { TGh } from '../github-release.ts';
import { GithubRelease } from '../github-release.ts';
import { MergeBackConstants, ReleaseMergeBack } from '../merge-back.ts';

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

const scratch = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'github-release-test-'));

  roots.push(root);

  return root;
};

const git = (opts: { cwd: string; args: string[] }): string =>
  ReleaseMergeBack.mustGit({ cwd: opts.cwd, args: [...MergeBackConstants.IDENTITY, ...opts.args] });

const TEMPLATES = ['vulcan-v<version>', 'v<version>'];

const entry = (opts: { title: string; body: string }): string =>
  `---\ntitle: "${opts.title}"\npackages: ['@x/cli']\n---\n\n# Changelog - 2026-10-20\n\n## ${opts.title}\n\n${opts.body}\n`;

const commit = (opts: { root: string; message: string; files?: Record<string, string> }): void => {
  for (const [path, text] of Object.entries(opts.files ?? {})) {
    mkdirSync(dirname(join(opts.root, path)), { recursive: true });
    writeFileSync(join(opts.root, path), text);
  }

  git({ cwd: opts.root, args: ['add', '-A'] });
  git({ cwd: opts.root, args: ['commit', '-q', '--allow-empty', '-m', opts.message] });
};

const tag = (opts: { root: string; name: string }): void => {
  git({ cwd: opts.root, args: ['tag', '-a', opts.name, '-m', opts.name] });
};

/**
 * v0.4.7 (stable, legacy name) holds one old entry; vulcan-v0.4.8-0 adds entry b; vulcan-v0.4.8-1 adds entry c and a
 * commit with no issue; vulcan-v0.4.8 (stable) adds nothing.
 */
const fixture = (): string => {
  const root = scratch();

  git({ cwd: root, args: ['init', '-q', '-b', 'develop'] });
  commit({
    root,
    message: '[#1] feat(a): the first',
    files: {
      '.agents/vulcan.manifest.json': `${JSON.stringify({
        release: { tagPattern: 'vulcan-v<version>', legacyTagPatterns: ['v<version>'] },
        knowledge: { changelogs: 'docs/changelogs' },
        packages: [{ name: '@x/okf' }, { name: '@x/cli' }],
      })}\n`,
      'docs/changelogs/2026-10-01-old.md': entry({ title: 'Old change', body: 'Before v0.4.7.' }),
      'docs/changelogs/index.md': '# index\n',
    },
  });
  tag({ root, name: 'v0.4.7' });
  commit({
    root,
    message: '[#10] feat(b): second change',
    files: {
      'docs/changelogs/2026-10-20-b.md': entry({
        title: 'VULCAN X.Y.Z: change b is described',
        body: 'B body line.',
      }),
    },
  });
  tag({ root, name: 'vulcan-v0.4.8-0' });
  commit({
    root,
    message: '[#11] fix(c): third change',
    files: {
      'docs/changelogs/2026-10-25-c.md': entry({ title: 'Change C', body: 'C body line.' }),
    },
  });
  commit({ root, message: 'chore: housekeeping with no issue' });
  tag({ root, name: 'vulcan-v0.4.8-1' });
  commit({ root, message: 'chore(release): v0.4.8 [patch]' });
  tag({ root, name: 'vulcan-v0.4.8' });
  tag({ root, name: 'atlas-index' });

  return root;
};

interface IStubGh {
  gh: TGh;
  calls: string[][];
  /** The notes file of the last create, read while it still existed. */
  notes: () => string;
  created: () => string[];
}

/** A stand-in for `gh`: records every call, and reads the notes file while it still exists. */
const stubGh = (opts: { existing?: boolean; createFails?: boolean }): IStubGh => {
  const calls: string[][] = [];
  let notes = '';

  return {
    calls,
    notes: () => notes,
    created: () => calls.find((call) => call[1] === 'create') ?? [],
    gh: ({ args }) => {
      calls.push(args);

      if (args[1] === 'view') {
        return { status: opts.existing === true ? 0 : 1, stdout: '', stderr: 'release not found' };
      }

      notes = readFileSync(args[args.indexOf('--notes-file') + 1], 'utf8');

      return opts.createFails === true
        ? { status: 1, stdout: '', stderr: 'HTTP 422: tag does not exist' }
        : { status: 0, stdout: `https://github.com/x/y/releases/tag/${args[2]}\n`, stderr: '' };
    },
  };
};

const make = (opts: {
  root: string;
  tag: string;
  kind: string;
  version: string;
  stub: IStubGh;
  withSubjectFallback?: boolean;
  dryRun?: boolean;
}) =>
  GithubRelease.create({
    cwd: opts.root,
    tag: opts.tag,
    kind: opts.kind,
    version: opts.version,
    gh: opts.stub.gh,
    scratchRoot: scratch(),
    withSubjectFallback: opts.withSubjectFallback,
    dryRun: opts.dryRun,
  });

describe('GithubRelease.versionOfTag', () => {
  test('reads the version under either template, and nothing that does not start with a digit', () => {
    expect(GithubRelease.versionOfTag({ tag: 'vulcan-v0.4.8-1', templates: TEMPLATES })).toBe(
      '0.4.8-1',
    );
    expect(GithubRelease.versionOfTag({ tag: 'v0.4.7', templates: TEMPLATES })).toBe('0.4.7');
    expect(
      GithubRelease.versionOfTag({ tag: 'atlas-index', templates: TEMPLATES }),
    ).toBeUndefined();
    expect(GithubRelease.versionOfTag({ tag: 'v-banner', templates: TEMPLATES })).toBeUndefined();
    expect(GithubRelease.versionOfTag({ tag: 'vulcan-v-x', templates: TEMPLATES })).toBeUndefined();
  });
});

describe('GithubRelease.previousTag and isNewestStable', () => {
  const tags = [
    'v0.4.6',
    'v0.4.7',
    'vulcan-v0.4.8-0',
    'vulcan-v0.4.8-1',
    'vulcan-v0.4.8',
    'atlas-index',
  ];
  const previous = (opts: { version: string; stableOnly: boolean }) =>
    GithubRelease.previousTag({ tags, templates: TEMPLATES, ...opts });
  const isNewest = (opts: { version: string }) =>
    GithubRelease.isNewestStable({ tags, templates: TEMPLATES, ...opts });

  test('a stable looks back to the highest stable below it, over the legacy name too', () => {
    expect(previous({ version: '0.4.8', stableOnly: true })).toBe('v0.4.7');
    expect(previous({ version: '0.4.9', stableOnly: true })).toBe('vulcan-v0.4.8');
  });

  test('a prerelease looks back to the highest tag of any kind below it, and numbers compare as numbers', () => {
    expect(previous({ version: '0.4.8-1', stableOnly: false })).toBe('vulcan-v0.4.8-0');
    expect(previous({ version: '0.4.8-10', stableOnly: false })).toBe('vulcan-v0.4.8-1');
    expect(previous({ version: '0.4.6', stableOnly: false })).toBeUndefined();
  });

  test('a stable is the newest only when no stable tag is above it, whatever prereleases there are', () => {
    expect(isNewest({ version: '0.4.8' })).toBe(true);
    expect(isNewest({ version: '0.4.7' })).toBe(false);
    expect(isNewest({ version: '0.4.9' })).toBe(true);
  });
});

describe('GithubRelease.stableNotes', () => {
  const notesOf = (opts: { root: string; from?: string; to: string }) =>
    GithubRelease.stableNotes({ ...opts, cwd: opts.root, folder: 'docs/changelogs' });

  test('joins the entries added since the previous stable, in date order, and skips older ones', () => {
    const notes = notesOf({ root: fixture(), from: 'v0.4.7', to: 'vulcan-v0.4.8' });

    expect(notes).toContain('Change C');
    expect(notes).toContain('C body line.');
    expect(notes).not.toContain('Old change');
    expect(notes).not.toContain('---');
    expect(notes).not.toContain('# Changelog - ');
    expect(notes.indexOf('B body line.')).toBeLessThan(notes.indexOf('C body line.'));
  });

  test('an entry heading loses the VULCAN X.Y.Z prefix, and its first letter is capital', () => {
    const notes = notesOf({ root: fixture(), from: 'v0.4.7', to: 'vulcan-v0.4.8' });

    expect(notes).toContain('## Change b is described');
    expect(notes).not.toContain('X.Y.Z');
    expect(GithubRelease.stripEntry({ text: '## VULCAN 0.2.0-0: the contract\n\nBody.' })).toBe(
      '## The contract\n\nBody.',
    );
  });

  test('is empty when no entry was added in the range', () => {
    expect(notesOf({ root: fixture(), from: 'vulcan-v0.4.8-1', to: 'vulcan-v0.4.8' })).toBe('');
  });

  test('an entry renamed inside the range still counts, under its new name', () => {
    const root = fixture();
    const first = 'docs/changelogs/2026-10-27-d-first-name.md';

    commit({
      root,
      message: '[#13] feat(d): added',
      files: { [first]: entry({ title: 'Change D', body: 'D body.' }) },
    });
    git({ cwd: root, args: ['mv', first, 'docs/changelogs/2026-10-27-d.md'] });
    commit({ root, message: '[#13] docs(d): renamed' });

    expect(notesOf({ root, from: 'vulcan-v0.4.8', to: 'HEAD' })).toContain('D body.');
  });
});

describe('GithubRelease.check: a stable ships with its changelog', () => {
  test('passes when an entry was added since the previous stable, and stops when none was', () => {
    const root = fixture();

    expect(GithubRelease.check({ cwd: root, version: '0.4.8', to: 'vulcan-v0.4.8' })).toEqual([]);
    expect(GithubRelease.check({ cwd: root, version: '0.4.9', to: 'vulcan-v0.4.8' })).toHaveLength(
      1,
    );
  });
});

describe('GithubRelease.create', () => {
  test('a stable that is the newest is marked Latest, titled with its version, with the entries and the packages as notes', () => {
    const stub = stubGh({});
    const outcome = make({
      root: fixture(),
      tag: 'vulcan-v0.4.8',
      kind: 'stable',
      version: '0.4.8',
      stub,
    });
    const created = stub.created();

    expect(outcome.state).toBe('created');
    expect(created).toContain('--latest');
    expect(created).not.toContain('--prerelease');
    expect(created[created.indexOf('--title') + 1]).toBe('VULCAN 0.4.8');
    expect(created).toContain('--verify-tag');
    expect(stub.notes()).toContain('B body line.');
    expect(stub.notes()).toContain('[@x/cli@0.4.8](https://www.npmjs.com/package/@x/cli/v/0.4.8)');
  });

  test('a stable that is not the newest is never marked Latest', () => {
    const stub = stubGh({});

    make({
      root: fixture(),
      tag: 'v0.4.7',
      kind: 'stable',
      version: '0.4.7',
      stub,
      withSubjectFallback: true,
    });

    expect(stub.created()).toContain('--latest=false');
    expect(stub.created()).not.toContain('--latest');
  });

  test('a prerelease is marked Pre-release and never Latest, with the install line and the issue subjects only', () => {
    const stub = stubGh({});
    const outcome = make({
      root: fixture(),
      tag: 'vulcan-v0.4.8-1',
      kind: 'prerelease',
      version: '0.4.8-1',
      stub,
    });

    expect(outcome.state).toBe('created');
    expect(stub.created()).toContain('--prerelease');
    expect(stub.created()).not.toContain('--latest');
    expect(stub.notes()).toContain('npm install @x/cli@next');
    expect(stub.notes()).toContain('[#11] fix(c): third change');
    expect(stub.notes()).not.toContain('housekeeping');
    expect(stub.notes()).not.toContain('[#10]');
  });

  test('more subjects than the cap are cut, and the notes say how many were left out', () => {
    const subjects = Array.from({ length: 33 }, (_, index) => `[#${index}] change ${index}`);
    const capped = GithubRelease.cappedSubjects({ subjects });

    expect(capped).toHaveLength(31);
    expect(capped.at(-1)).toBe('... and 3 more');
    expect(GithubRelease.cappedSubjects({ subjects: subjects.slice(0, 30) })).toHaveLength(30);
  });

  test('a tag that has a Release is skipped, and nothing is created', () => {
    const stub = stubGh({ existing: true });
    const outcome = make({
      root: fixture(),
      tag: 'vulcan-v0.4.8',
      kind: 'stable',
      version: '0.4.8',
      stub,
    });

    expect(outcome.state).toBe('exists');
    expect(stub.created()).toEqual([]);
  });

  test('the tag of the atlas index and an unknown kind are refused before gh is asked anything', () => {
    const stub = stubGh({});
    const root = fixture();

    expect(make({ root, tag: 'atlas-index', kind: 'stable', version: '0.4.8', stub }).state).toBe(
      'refused',
    );
    expect(make({ root, tag: 'vulcan-v0.4.8', kind: 'latest', version: '0.4.8', stub }).state).toBe(
      'refused',
    );
    expect(stub.calls).toEqual([]);
  });

  test('a failed create, and a git failure, are outcomes with a reason, not exceptions', () => {
    const failing = make({
      root: fixture(),
      tag: 'vulcan-v0.4.8',
      kind: 'stable',
      version: '0.4.8',
      stub: stubGh({ createFails: true }),
    });
    const broken = make({
      root: scratch(),
      tag: 'vulcan-v0.4.8',
      kind: 'stable',
      version: '0.4.8',
      stub: stubGh({}),
    });

    expect(failing.state).toBe('failed');
    expect(failing.message).toContain('HTTP 422');
    expect(broken.state).toBe('failed');
  });

  test('a stable with no entry in its range makes nothing; a backfill falls back to the commits', () => {
    const root = fixture();

    commit({ root, message: '[#12] chore(x): a change with no entry' });
    tag({ root, name: 'vulcan-v0.4.9' });

    const stub = stubGh({});
    const backfill = stubGh({});

    expect(make({ root, tag: 'vulcan-v0.4.9', kind: 'stable', version: '0.4.9', stub }).state).toBe(
      'failed',
    );
    expect(stub.created()).toEqual([]);
    expect(
      make({
        root,
        tag: 'vulcan-v0.4.9',
        kind: 'stable',
        version: '0.4.9',
        stub: backfill,
        withSubjectFallback: true,
      }).state,
    ).toBe('created');
    expect(backfill.notes()).toContain('[#12] chore(x): a change with no entry');
  });

  test('a backfill whose range holds no commit of its own makes nothing', () => {
    const root = fixture();

    tag({ root, name: 'vulcan-v0.4.9' });

    const stub = stubGh({});

    expect(
      make({
        root,
        tag: 'vulcan-v0.4.9',
        kind: 'stable',
        version: '0.4.9',
        stub,
        withSubjectFallback: true,
      }).state,
    ).toBe('failed');
    expect(stub.created()).toEqual([]);
  });

  test('a backfill of a prerelease is refused: a backfill makes the Release of a stable only', () => {
    const stub = stubGh({});

    expect(
      make({
        root: fixture(),
        tag: 'vulcan-v0.4.8-1',
        kind: 'prerelease',
        version: '0.4.8-1',
        stub,
        withSubjectFallback: true,
      }).state,
    ).toBe('refused');
    expect(stub.calls).toEqual([]);
  });

  test('a dry run stops before gh creates anything and returns the notes and whether it would be Latest', () => {
    const stub = stubGh({});
    const outcome = make({
      root: fixture(),
      tag: 'v0.4.7',
      kind: 'stable',
      version: '0.4.7',
      stub,
      withSubjectFallback: true,
      dryRun: true,
    });

    expect(outcome.state).toBe('planned');
    expect(outcome.message).toContain('not Latest');
    expect(outcome.message).toContain('Old change');
    expect(stub.created()).toEqual([]);
  });

  test('a subject cannot ping anyone or close an issue through the notes', () => {
    const body = GithubRelease.bodyOf({
      kind: 'prerelease',
      version: '0.4.8-1',
      notes: '',
      subjects: ['[#9] fixes #3, thanks @someone', 'closes```'],
      packages: ['@x/cli'],
    });

    expect(body).toContain("```text\n[#9] fixes #3, thanks @someone\ncloses'''\n```");
  });
});

describe('GithubRelease.manifestOf', () => {
  test('names what is missing instead of failing with a bare TypeError', () => {
    const root = scratch();

    mkdirSync(join(root, '.agents'), { recursive: true });
    writeFileSync(join(root, '.agents', 'vulcan.manifest.json'), '{"packages":[]}\n');

    expect(() => GithubRelease.manifestOf({ cwd: root })).toThrow('release.tagPattern');
    expect(GithubRelease.manifestOf({ cwd: fixture() }).packages).toEqual(['@x/okf', '@x/cli']);
  });
});

describe('GithubRelease.main', () => {
  const run = (opts: { args: string[]; root: string; stub: IStubGh; summary?: string }) =>
    GithubRelease.main({
      args: opts.args,
      cwd: opts.root,
      gh: opts.stub.gh,
      env: {
        RUNNER_TEMP: scratch(),
        ...(opts.summary === undefined ? {} : { GITHUB_STEP_SUMMARY: opts.summary }),
      },
    });

  test('create exits 0 for a made or an existing Release and 1 for a failed one, and a failure and a crash reach the summary', () => {
    const summary = join(scratch(), 'summary');
    const crashed = join(scratch(), 'summary');
    const root = fixture();
    const args = ['create', '--tag', 'vulcan-v0.4.8', '--version', '0.4.8', '--kind', 'stable'];

    writeFileSync(summary, '');
    writeFileSync(crashed, '');

    expect(run({ args, root, stub: stubGh({}), summary })).toBe(0);
    expect(run({ args, root, stub: stubGh({ existing: true }) })).toBe(0);
    expect(run({ args, root, stub: stubGh({ createFails: true }), summary })).toBe(1);
    expect(readFileSync(summary, 'utf8')).toContain('failed');
    expect(run({ args, root: scratch(), stub: stubGh({}), summary: crashed })).toBe(1);
    expect(readFileSync(crashed, 'utf8')).toContain('GitHub Release');
  });

  test('check exits 1 for a stable with no entry, and a missing flag or unknown command exits 2', () => {
    const root = fixture();
    const stub = stubGh({});

    expect(
      run({ args: ['check', '--version', '0.4.9', '--to', 'vulcan-v0.4.8'], root, stub }),
    ).toBe(1);
    expect(
      run({ args: ['check', '--version', '0.4.8', '--to', 'vulcan-v0.4.8'], root, stub }),
    ).toBe(0);
    expect(run({ args: ['check'], root, stub })).toBe(2);
    expect(run({ args: ['create', '--tag', 'x'], root, stub })).toBe(2);
    expect(run({ args: ['publish'], root, stub })).toBe(2);
  });

  test('backfill writes nothing without --yes, with it makes the Release of an old stable, and refuses a prerelease tag', () => {
    const root = fixture();
    const dry = stubGh({});
    const written = stubGh({});

    expect(run({ args: ['backfill', '--tag', 'v0.4.7'], root, stub: dry })).toBe(0);
    expect(dry.created()).toEqual([]);
    expect(run({ args: ['backfill', '--tag', 'v0.4.7', '--yes'], root, stub: written })).toBe(0);
    expect(written.created()).toContain('--latest=false');
    expect(
      run({ args: ['backfill', '--tag', 'vulcan-v0.4.8-1', '--yes'], root, stub: stubGh({}) }),
    ).toBe(1);
    expect(
      run({ args: ['backfill', '--tag', 'atlas-index', '--yes'], root, stub: stubGh({}) }),
    ).toBe(2);
  });
});

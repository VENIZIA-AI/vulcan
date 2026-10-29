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
      'docs/changelogs/2026-10-20-b.md': entry({ title: 'Change B', body: 'B body line.' }),
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

/** A stand-in for `gh`: records every call, and reads the notes file while it still exists. */
const stubGh = (opts: {
  existing?: boolean;
  createFails?: boolean;
}): { gh: TGh; calls: string[][]; notes: () => string } => {
  const calls: string[][] = [];
  let notes = '';

  return {
    calls,
    notes: () => notes,
    gh: ({ args }) => {
      calls.push(args);

      if (args[1] === 'view') {
        return { status: opts.existing === true ? 0 : 1, stdout: '', stderr: 'release not found' };
      }

      const file = args[args.indexOf('--notes-file') + 1];

      notes = readFileSync(file, 'utf8');

      return opts.createFails === true
        ? { status: 1, stdout: '', stderr: 'HTTP 422: tag does not exist' }
        : { status: 0, stdout: `https://github.com/x/y/releases/tag/${args[2]}\n`, stderr: '' };
    },
  };
};

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

describe('GithubRelease.previousTag', () => {
  const tags = [
    'v0.4.6',
    'v0.4.7',
    'vulcan-v0.4.8-0',
    'vulcan-v0.4.8-1',
    'vulcan-v0.4.8',
    'atlas-index',
  ];
  const previous = (version: string, stableOnly: boolean) =>
    GithubRelease.previousTag({ tags, templates: TEMPLATES, version, stableOnly });

  test('a stable looks back to the highest stable below it, over the legacy name too', () => {
    expect(previous('0.4.8', true)).toBe('v0.4.7');
    expect(previous('0.4.9', true)).toBe('vulcan-v0.4.8');
  });

  test('a prerelease looks back to the highest tag of any kind below it, and numbers compare as numbers', () => {
    expect(previous('0.4.8-1', false)).toBe('vulcan-v0.4.8-0');
    expect(previous('0.4.8-10', false)).toBe('vulcan-v0.4.8-1');
    expect(previous('0.4.6', false)).toBeUndefined();
  });
});

describe('GithubRelease.stableNotes', () => {
  test('joins the entries added since the previous stable, without front matter or date heading, and skips older ones', () => {
    const root = fixture();
    const notes = GithubRelease.stableNotes({
      cwd: root,
      from: 'v0.4.7',
      to: 'vulcan-v0.4.8',
      folder: 'docs/changelogs',
    });

    expect(notes).toContain('## Change B');
    expect(notes).toContain('C body line.');
    expect(notes).not.toContain('Old change');
    expect(notes).not.toContain('---');
    expect(notes).not.toContain('# Changelog - ');
    expect(notes.indexOf('Change B')).toBeLessThan(notes.indexOf('Change C'));
  });

  test('is empty when no entry was added in the range', () => {
    expect(
      GithubRelease.stableNotes({
        cwd: fixture(),
        from: 'vulcan-v0.4.8-1',
        to: 'vulcan-v0.4.8',
        folder: 'docs/changelogs',
      }),
    ).toBe('');
  });
});

describe('GithubRelease.check: a stable ships with its changelog', () => {
  test('passes when an entry was added since the previous stable', () => {
    expect(GithubRelease.check({ cwd: fixture(), version: '0.4.8', to: 'vulcan-v0.4.8' })).toEqual(
      [],
    );
  });

  test('stops, naming the tag it looked back to, when none was', () => {
    const root = fixture();

    expect(GithubRelease.check({ cwd: root, version: '0.4.9', to: 'vulcan-v0.4.8' })[0]).toContain(
      'since vulcan-v0.4.8',
    );
  });
});

describe('GithubRelease.create', () => {
  const create = (opts: {
    root: string;
    tag: string;
    kind: string;
    version: string;
    stub: ReturnType<typeof stubGh>;
    withSubjectFallback?: boolean;
  }) =>
    GithubRelease.create({
      cwd: opts.root,
      tag: opts.tag,
      kind: opts.kind,
      version: opts.version,
      gh: opts.stub.gh,
      scratchRoot: scratch(),
      withSubjectFallback: opts.withSubjectFallback,
    });

  test('a stable is marked Latest, titled with its version, with the entries and the packages as notes', () => {
    const stub = stubGh({});
    const outcome = create({
      root: fixture(),
      tag: 'vulcan-v0.4.8',
      kind: 'stable',
      version: '0.4.8',
      stub,
    });
    const created = stub.calls.find((call) => call[1] === 'create') ?? [];

    expect(outcome.state).toBe('created');
    expect(created).toContain('--latest');
    expect(created).not.toContain('--prerelease');
    expect(created[created.indexOf('--title') + 1]).toBe('VULCAN 0.4.8');
    expect(created).toContain('--verify-tag');
    expect(stub.notes()).toContain('B body line.');
    expect(stub.notes()).toContain('[@x/cli@0.4.8](https://www.npmjs.com/package/@x/cli/v/0.4.8)');
  });

  test('a prerelease is marked Pre-release and never Latest, with the install line and the issue subjects only', () => {
    const stub = stubGh({});
    const outcome = create({
      root: fixture(),
      tag: 'vulcan-v0.4.8-1',
      kind: 'prerelease',
      version: '0.4.8-1',
      stub,
    });
    const created = stub.calls.find((call) => call[1] === 'create') ?? [];

    expect(outcome.state).toBe('created');
    expect(created).toContain('--prerelease');
    expect(created).not.toContain('--latest');
    expect(stub.notes()).toContain('npm install @x/cli@next');
    expect(stub.notes()).toContain('[#11] fix(c): third change');
    expect(stub.notes()).not.toContain('housekeeping');
    expect(stub.notes()).not.toContain('[#10]');
  });

  test('a tag that has a Release is skipped, and nothing is created', () => {
    const stub = stubGh({ existing: true });
    const outcome = create({
      root: fixture(),
      tag: 'vulcan-v0.4.8',
      kind: 'stable',
      version: '0.4.8',
      stub,
    });

    expect(outcome.state).toBe('exists');
    expect(stub.calls.filter((call) => call[1] === 'create')).toEqual([]);
  });

  test('the tag of the atlas index is refused before gh is asked anything', () => {
    const stub = stubGh({});
    const outcome = create({
      root: fixture(),
      tag: 'atlas-index',
      kind: 'stable',
      version: '0.4.8',
      stub,
    });

    expect(outcome.state).toBe('refused');
    expect(stub.calls).toEqual([]);
  });

  test('a kind that is not stable or prerelease is refused', () => {
    const stub = stubGh({});

    expect(
      create({ root: fixture(), tag: 'vulcan-v0.4.8', kind: 'latest', version: '0.4.8', stub })
        .state,
    ).toBe('refused');
  });

  test('a failed create is an outcome with the reason, not an exception', () => {
    const outcome = create({
      root: fixture(),
      tag: 'vulcan-v0.4.8',
      kind: 'stable',
      version: '0.4.8',
      stub: stubGh({ createFails: true }),
    });

    expect(outcome.state).toBe('failed');
    expect(outcome.message).toContain('HTTP 422');
  });

  test('a stable with no entry in its range creates nothing, unless it is a backfill', () => {
    const root = fixture();

    commit({ root, message: '[#12] chore(x): a change with no entry' });
    tag({ root, name: 'vulcan-v0.4.9' });

    const stub = stubGh({});
    const outcome = create({ root, tag: 'vulcan-v0.4.9', kind: 'stable', version: '0.4.9', stub });

    expect(outcome.state).toBe('failed');
    expect(stub.calls.filter((call) => call[1] === 'create')).toEqual([]);

    const backfill = stubGh({});

    expect(
      create({
        root,
        tag: 'vulcan-v0.4.9',
        kind: 'stable',
        version: '0.4.9',
        stub: backfill,
        withSubjectFallback: true,
      }).state,
    ).toBe('created');
    expect(backfill.notes()).toContain('Commits in this release:');
    expect(backfill.notes()).toContain('[#12] chore(x): a change with no entry');
  });

  test('a subject cannot ping anyone or close an issue through the notes', () => {
    const body = GithubRelease.bodyOf({
      kind: 'prerelease',
      version: '0.4.8-1',
      notes: '',
      subjects: ['[#9] fixes #3, thanks @someone', 'closes```'],
      packages: ['@x/cli'],
      mainPackage: '@x/cli',
    });

    expect(body).toContain("```text\n[#9] fixes #3, thanks @someone\ncloses'''\n```");
  });
});

describe('GithubRelease.main', () => {
  const run = (opts: {
    args: string[];
    root: string;
    stub: ReturnType<typeof stubGh>;
    summary?: string;
  }) =>
    GithubRelease.main({
      args: opts.args,
      cwd: opts.root,
      gh: opts.stub.gh,
      env: {
        RUNNER_TEMP: scratch(),
        ...(opts.summary === undefined ? {} : { GITHUB_STEP_SUMMARY: opts.summary }),
      },
    });

  test('create exits 0 for a made or an existing Release, 1 for a failed one, and reports it in the summary', () => {
    const summary = join(scratch(), 'summary');
    const root = fixture();
    const args = ['create', '--tag', 'vulcan-v0.4.8', '--version', '0.4.8', '--kind', 'stable'];

    writeFileSync(summary, '');

    expect(run({ args, root, stub: stubGh({}), summary })).toBe(0);
    expect(run({ args, root, stub: stubGh({ existing: true }) })).toBe(0);
    expect(run({ args, root, stub: stubGh({ createFails: true }), summary })).toBe(1);
    expect(readFileSync(summary, 'utf8')).toContain('- failed:');
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

  test('backfill writes nothing without --yes, and with it makes the Release of the old tag, Latest', () => {
    const root = fixture();
    const dry = stubGh({});
    const written = stubGh({});

    expect(run({ args: ['backfill', '--tag', 'v0.4.7'], root, stub: dry })).toBe(0);
    expect(dry.calls).toEqual([]);
    expect(run({ args: ['backfill', '--tag', 'v0.4.7', '--yes'], root, stub: written })).toBe(0);
    expect(written.calls.find((call) => call[1] === 'create')).toContain('--latest');
    expect(
      run({ args: ['backfill', '--tag', 'atlas-index', '--yes'], root, stub: stubGh({}) }),
    ).toBe(2);
  });
});

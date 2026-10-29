/**
 * The GitHub Release of a publish: one Release on the tag the run made, so the Releases page shows what shipped.
 *
 *   bun scripts/release/github-release.ts create --tag <tag> --version <v> --kind stable|prerelease
 *   bun scripts/release/github-release.ts check  --version <v> [--to <commit>]
 *   bun scripts/release/github-release.ts backfill --tag <tag> [--yes]
 *
 * `create` runs in the publish job after the tag. A stable is marked Latest, with the changelog entries added since
 * the previous stable tag as its notes; a prerelease is marked Pre-release, never Latest, with the `[#N]` commit
 * subjects since the previous tag and the `@next` install line. It skips a tag that already has a Release, and it
 * refuses the `atlas-index` tag, whose release is the atlas index's own. `check` runs in the plan job: a stable
 * with no changelog entry since the previous stable stops before the approval. `backfill` makes the Release of an
 * existing stable tag, falling back to commit subjects when no entry covers it; it writes to GitHub only with
 * `--yes`, on the owner's word.
 */
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReleaseMergeBack } from './merge-back.ts';

export class GithubReleaseConstants {
  /** The release the atlas index publishes its pairs to; this script never creates, edits or moves it. */
  static readonly ATLAS_INDEX_TAG = 'atlas-index';
  static readonly MANIFEST = '.agents/vulcan.manifest.json';
  static readonly MAX_PRERELEASE_SUBJECTS = 30;
  static readonly DATED_ENTRY = /^\d{4}-\d{2}-\d{2}-.*\.md$/;
  static readonly FRONT_MATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;
  static readonly DATE_HEADING = /^# Changelog - \d{4}-\d{2}-\d{2}\s*$/m;
  static readonly ISSUE_SUBJECT = /^\[#\d+\]/;
  static readonly TITLE_PREFIX = 'VULCAN';
}

export interface IGithubReleaseManifest {
  templates: string[];
  changelogs: string;
  packages: string[];
}

export interface IGhResult {
  status: number;
  stdout: string;
  stderr: string;
}

export type TGh = (opts: { args: string[] }) => IGhResult;

export type TGithubReleaseState = 'created' | 'exists' | 'refused' | 'failed';

export interface IGithubReleaseOutcome {
  state: TGithubReleaseState;
  message: string;
}

export class GithubRelease {
  static ghOf(opts: { cwd: string }): TGh {
    return ({ args }) => {
      const child = Bun.spawnSync(['gh', ...args], {
        cwd: opts.cwd,
        stdout: 'pipe',
        stderr: 'pipe',
      });

      return {
        status: child.exitCode,
        stdout: child.stdout.toString(),
        stderr: child.stderr.toString(),
      };
    };
  }

  static manifestOf(opts: { cwd: string }): IGithubReleaseManifest {
    const manifest = JSON.parse(
      readFileSync(join(opts.cwd, GithubReleaseConstants.MANIFEST), 'utf8'),
    );

    return {
      templates: [manifest.release.tagPattern, ...(manifest.release.legacyTagPatterns ?? [])],
      changelogs: manifest.knowledge.changelogs,
      packages: manifest.packages.map((entry: { name: string }) => entry.name),
    };
  }

  /** The version a tag names under one of the templates (each only `<version>`), when it starts with a digit. */
  static versionOfTag(opts: { tag: string; templates: string[] }): string | undefined {
    for (const template of opts.templates) {
      const escaped = template
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace('<version>', '(\\d\\S*)');
      const version = new RegExp(`^${escaped}$`).exec(opts.tag)?.[1];

      if (version !== undefined) {
        return version;
      }
    }

    return undefined;
  }

  /** The highest tag below `version`: of stables only when `stableOnly`, of every kind otherwise. */
  static previousTag(opts: {
    tags: string[];
    templates: string[];
    version: string;
    stableOnly: boolean;
  }): string | undefined {
    let best: { tag: string; version: string } | undefined;

    for (const tag of opts.tags) {
      const version = GithubRelease.versionOfTag({ tag, templates: opts.templates });

      if (
        version === undefined ||
        Bun.semver.order(version, opts.version) >= 0 ||
        (opts.stableOnly && version.includes('-')) ||
        (best !== undefined && Bun.semver.order(version, best.version) <= 0)
      ) {
        continue;
      }

      best = { tag, version };
    }

    return best?.tag;
  }

  static tagsOf(opts: { cwd: string }): string[] {
    return ReleaseMergeBack.mustGit({ cwd: opts.cwd, args: ['tag', '--list'] })
      .split('\n')
      .filter((tag) => tag !== '');
  }

  /** The dated changelog files added in `from..to`, oldest first; `from` absent means everything up to `to`. */
  static entriesAdded(opts: { cwd: string; from?: string; to: string; folder: string }): string[] {
    const range = opts.from === undefined ? opts.to : `${opts.from}..${opts.to}`;
    const names = ReleaseMergeBack.mustGit({
      cwd: opts.cwd,
      args: ['log', '--diff-filter=A', '--name-only', '--format=', range, '--', opts.folder],
    })
      .split('\n')
      .filter((path) => GithubReleaseConstants.DATED_ENTRY.test(path.split('/').pop() ?? ''));

    return [...new Set(names)].sort();
  }

  /** An entry without its front matter and its date heading: what a reader of the Release wants. */
  static stripEntry(opts: { text: string }): string {
    return opts.text
      .replace(GithubReleaseConstants.FRONT_MATTER, '')
      .replace(GithubReleaseConstants.DATE_HEADING, '')
      .trim();
  }

  /** The notes of a stable: the entries added since the previous stable, joined; empty when there are none. */
  static stableNotes(opts: { cwd: string; from?: string; to: string; folder: string }): string {
    return GithubRelease.entriesAdded(opts)
      .map((path) => {
        const shown = ReleaseMergeBack.git({ cwd: opts.cwd, args: ['show', `${opts.to}:${path}`] });

        return shown.status === 0 ? GithubRelease.stripEntry({ text: shown.stdout }) : '';
      })
      .filter((text) => text !== '')
      .join('\n\n');
  }

  static subjectsOf(opts: {
    cwd: string;
    from?: string;
    to: string;
    onlyIssues: boolean;
  }): string[] {
    const range = opts.from === undefined ? opts.to : `${opts.from}..${opts.to}`;
    const subjects = ReleaseMergeBack.mustGit({
      cwd: opts.cwd,
      args: ['log', '--no-merges', '--format=%s', range],
    })
      .split('\n')
      .filter((subject) => subject !== '');

    return opts.onlyIssues
      ? subjects.filter((subject) => GithubReleaseConstants.ISSUE_SUBJECT.test(subject))
      : subjects;
  }

  /** A fenced list: a subject cannot ping anyone, close an issue or break the markdown. */
  static fencedLines(opts: { lines: string[] }): string[] {
    return ['```text', ...opts.lines.map((line) => line.replaceAll('```', "'''")), '```'];
  }

  static packagesOf(opts: { names: string[]; version: string }): string[] {
    return [
      '## Packages',
      '',
      ...opts.names.map(
        (name) =>
          `- [${name}@${opts.version}](https://www.npmjs.com/package/${name}/v/${opts.version})`,
      ),
    ];
  }

  static bodyOf(opts: {
    kind: string;
    version: string;
    notes: string;
    subjects: string[];
    packages: string[];
    mainPackage: string;
  }): string {
    const sections =
      opts.kind === 'stable'
        ? [opts.notes]
        : [
            `Install: \`npm install ${opts.mainPackage}@next\``,
            '',
            ...(opts.subjects.length === 0
              ? []
              : [
                  'Changes since the previous tag:',
                  '',
                  ...GithubRelease.fencedLines({ lines: opts.subjects }),
                ]),
          ];

    return [
      ...sections,
      '',
      ...GithubRelease.packagesOf({ names: opts.packages, version: opts.version }),
      '',
    ].join('\n');
  }

  /** Why a stable cannot be released without a changelog entry; empty when it has one. */
  static check(opts: { cwd: string; version: string; to: string }): string[] {
    const manifest = GithubRelease.manifestOf({ cwd: opts.cwd });
    const from = GithubRelease.previousTag({
      tags: GithubRelease.tagsOf({ cwd: opts.cwd }),
      templates: manifest.templates,
      version: opts.version,
      stableOnly: true,
    });
    const notes = GithubRelease.stableNotes({
      cwd: opts.cwd,
      from,
      to: opts.to,
      folder: manifest.changelogs,
    });

    return notes === ''
      ? [
          `no changelog entry was added since ${from ?? 'the start of history'}: a stable ships with its changelog`,
        ]
      : [];
  }

  /** Makes the Release of `tag`, or says why it did not. Never throws: a failure is an outcome. */
  static create(opts: {
    cwd: string;
    tag: string;
    kind: string;
    version: string;
    gh: TGh;
    scratchRoot: string;
    /** Falls back to commit subjects when no changelog entry covers a stable (a backfill). */
    withSubjectFallback?: boolean;
  }): IGithubReleaseOutcome {
    if (opts.tag === GithubReleaseConstants.ATLAS_INDEX_TAG) {
      return {
        state: 'refused',
        message: `${opts.tag} is the release of the atlas index, not of a publish`,
      };
    }

    if (opts.kind !== 'stable' && opts.kind !== 'prerelease') {
      return { state: 'refused', message: `the kind '${opts.kind}' is not stable or prerelease` };
    }

    if (opts.gh({ args: ['release', 'view', opts.tag, '--json', 'tagName'] }).status === 0) {
      return { state: 'exists', message: `${opts.tag} already has a Release - skipped` };
    }

    const manifest = GithubRelease.manifestOf({ cwd: opts.cwd });
    const from = GithubRelease.previousTag({
      tags: GithubRelease.tagsOf({ cwd: opts.cwd }),
      templates: manifest.templates,
      version: opts.version,
      stableOnly: opts.kind === 'stable',
    });
    const stable = opts.kind === 'stable';
    let notes = stable
      ? GithubRelease.stableNotes({
          cwd: opts.cwd,
          from,
          to: opts.tag,
          folder: manifest.changelogs,
        })
      : '';
    const subjects = GithubRelease.subjectsOf({
      cwd: opts.cwd,
      from,
      to: opts.tag,
      onlyIssues: !(stable && opts.withSubjectFallback),
    }).slice(0, GithubReleaseConstants.MAX_PRERELEASE_SUBJECTS);

    if (stable && notes === '') {
      if (!opts.withSubjectFallback) {
        return {
          state: 'failed',
          message: `no changelog entry was added since ${from ?? 'the start of history'}, so ${opts.tag} has no notes`,
        };
      }

      notes = [
        'Commits in this release:',
        '',
        ...GithubRelease.fencedLines({ lines: subjects }),
      ].join('\n');
    }

    const directory = mkdtempSync(join(opts.scratchRoot, 'github-release-'));

    try {
      const file = join(directory, 'notes.md');

      writeFileSync(
        file,
        GithubRelease.bodyOf({
          kind: opts.kind,
          version: opts.version,
          notes,
          subjects,
          packages: manifest.packages,
          mainPackage: manifest.packages.at(-1) ?? '',
        }),
      );

      const created = opts.gh({
        args: [
          'release',
          'create',
          opts.tag,
          '--title',
          `${GithubReleaseConstants.TITLE_PREFIX} ${opts.version}`,
          '--notes-file',
          file,
          '--verify-tag',
          ...(stable ? ['--latest'] : ['--prerelease']),
        ],
      });

      return created.status === 0
        ? { state: 'created', message: `${opts.tag}: ${created.stdout.trim()}` }
        : { state: 'failed', message: `gh release create ${opts.tag}: ${created.stderr.trim()}` };
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }

  static summaryOf(opts: { outcome: IGithubReleaseOutcome }): string {
    return ['### GitHub Release', '', `- ${opts.outcome.state}: ${opts.outcome.message}`, ''].join(
      '\n',
    );
  }

  static main(opts: {
    args: string[];
    env: Record<string, string | undefined>;
    cwd?: string;
    gh?: TGh;
  }): number {
    const [command] = opts.args;
    const cwd = opts.cwd ?? process.cwd();
    const flag = (name: string): string | undefined =>
      ReleaseMergeBack.flagValue({ args: opts.args, flag: name });
    const scratchRoot = opts.env['RUNNER_TEMP'] ?? tmpdir();

    try {
      if (command === 'check') {
        const version = flag('--version');

        if (version === undefined) {
          console.error('github-release check: --version <v> is required');

          return 2;
        }

        const problems = GithubRelease.check({ cwd, version, to: flag('--to') ?? 'HEAD' });

        problems.forEach((problem) => console.error(`ERROR | ${problem}`));

        return problems.length === 0 ? 0 : 1;
      }

      if (command === 'create' || command === 'backfill') {
        const backfill = command === 'backfill';
        const tag = flag('--tag');
        const manifest = GithubRelease.manifestOf({ cwd });
        const version = backfill
          ? tag === undefined
            ? undefined
            : GithubRelease.versionOfTag({ tag, templates: manifest.templates })
          : flag('--version');
        const kind = backfill ? 'stable' : flag('--kind');

        if (tag === undefined || version === undefined || kind === undefined) {
          console.error(
            'github-release: create --tag <tag> --version <v> --kind stable|prerelease | backfill --tag <tag> [--yes]',
          );

          return 2;
        }

        if (backfill && !opts.args.includes('--yes')) {
          console.log(
            `github-release: would create the Release of ${tag} (${version}, Latest). Add --yes to write it to GitHub.`,
          );

          return 0;
        }

        const outcome = GithubRelease.create({
          cwd,
          tag,
          kind,
          version,
          gh: opts.gh ?? GithubRelease.ghOf({ cwd }),
          scratchRoot,
          withSubjectFallback: backfill,
        });
        const summary = opts.env['GITHUB_STEP_SUMMARY'];

        console.log(`github-release: ${outcome.state} - ${outcome.message}`);

        if (summary !== undefined) {
          appendFileSync(summary, GithubRelease.summaryOf({ outcome }));
        }

        return outcome.state === 'created' || outcome.state === 'exists' ? 0 : 1;
      }
    } catch (error) {
      console.error(`ERROR | ${error instanceof Error ? error.message : String(error)}`);

      return 1;
    }

    console.error('github-release: create | check | backfill');

    return 2;
  }
}

if (import.meta.main) {
  process.exit(GithubRelease.main({ args: process.argv.slice(2), env: process.env }));
}

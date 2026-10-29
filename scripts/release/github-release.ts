/**
 * The GitHub Release of a publish: one Release on the tag the run made.
 *
 *   bun scripts/release/github-release.ts create --tag <tag> --version <v> --kind stable|prerelease
 *   bun scripts/release/github-release.ts check --version <v> [--to <commit>]
 *   bun scripts/release/github-release.ts backfill --tag <tag> [--yes]
 *
 * It never creates, edits or moves the `atlas-index` release, and `backfill` writes to GitHub only with `--yes`.
 */
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReleaseMergeBack } from './merge-back.ts';
import { ReleaseKinds } from './release-args.ts';
import type { TReleaseKind } from './release-args.ts';

export class GithubReleaseConstants {
  /** The release the atlas index publishes its pairs to. */
  static readonly ATLAS_INDEX_TAG = 'atlas-index';
  static readonly MANIFEST = '.agents/vulcan.manifest.json';
  static readonly MAX_PRERELEASE_SUBJECTS = 30;
  static readonly DATED_ENTRY = /^\d{4}-\d{2}-\d{2}-.*\.md$/;
  static readonly FRONT_MATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;
  static readonly DATE_HEADING = /^# Changelog - \d{4}-\d{2}-\d{2}\s*$/m;
  /** `## VULCAN X.Y.Z: title` or `## VULCAN 0.2.0-0: title`: the product and version prefix of an entry's heading. */
  static readonly VERSION_HEADING = /^(##\s+)VULCAN\s+(?:X\.Y\.Z|\d[^:\n]*):\s*(\S)/m;
  static readonly ISSUE_SUBJECT = /^\[#\d+\]/;
  /** The unspaced run of `[#N]` tokens a subject opens with: `[#42][#44] ...` serves two issues. */
  static readonly ISSUE_TOKENS = /^(?:\[#\d+\])+/;
  static readonly TITLE_PREFIX = 'VULCAN';
  static readonly USAGE =
    'github-release: create --tag <tag> --version <v> --kind stable|prerelease | check --version <v> [--to <commit>] | backfill --tag <tag> [--yes]';
}

export interface IGithubReleaseManifest {
  templates: string[];
  changelogs: string;
  /** The npm names of the packages, in release order: the last is the one users install. */
  packages: string[];
}

export interface IGhResult {
  status: number;
  stdout: string;
  stderr: string;
}

export type TGh = (opts: { args: string[] }) => IGhResult;

export type TGithubReleaseState = 'created' | 'exists' | 'planned' | 'refused' | 'failed';

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

  static isRecord(opts: { value: unknown }): opts is { value: Record<string, unknown> } {
    return typeof opts.value === 'object' && opts.value !== null && !Array.isArray(opts.value);
  }

  static manifestOf(opts: { cwd: string }): IGithubReleaseManifest {
    const parsed: unknown = JSON.parse(
      readFileSync(join(opts.cwd, GithubReleaseConstants.MANIFEST), 'utf8'),
    );
    const root = { value: parsed };

    if (!GithubRelease.isRecord(root)) {
      throw new Error(`${GithubReleaseConstants.MANIFEST} is not an object`);
    }

    const release = { value: root.value['release'] };
    const knowledge = { value: root.value['knowledge'] };
    const packages = root.value['packages'];
    const pattern = GithubRelease.isRecord(release) ? release.value['tagPattern'] : undefined;
    const legacy = GithubRelease.isRecord(release) ? release.value['legacyTagPatterns'] : undefined;
    const changelogs = GithubRelease.isRecord(knowledge)
      ? knowledge.value['changelogs']
      : undefined;

    if (typeof pattern !== 'string' || typeof changelogs !== 'string' || !Array.isArray(packages)) {
      throw new Error(
        `${GithubReleaseConstants.MANIFEST} needs release.tagPattern, knowledge.changelogs and packages`,
      );
    }

    return {
      templates: [
        pattern,
        ...(Array.isArray(legacy) ? legacy.filter((entry) => typeof entry === 'string') : []),
      ],
      changelogs,
      packages: packages.flatMap((entry) => {
        const holder = { value: entry };

        return GithubRelease.isRecord(holder) && typeof holder.value['name'] === 'string'
          ? [holder.value['name']]
          : [];
      }),
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

  /** Whether no stable tag is above `version`: the only case in which a Release may be marked Latest. */
  static isNewestStable(opts: { tags: string[]; templates: string[]; version: string }): boolean {
    return opts.tags.every((tag) => {
      const version = GithubRelease.versionOfTag({ tag, templates: opts.templates });

      return (
        version === undefined ||
        version.includes('-') ||
        Bun.semver.order(version, opts.version) <= 0
      );
    });
  }

  static tagsOf(opts: { cwd: string }): string[] {
    return ReleaseMergeBack.mustGit({ cwd: opts.cwd, args: ['tag', '--list'] })
      .split('\n')
      .filter((tag) => tag !== '');
  }

  /**
   * The dated changelog files added in `from..to`, oldest first; `from` absent means everything up to `to`.
   * Renames are not followed: an entry renamed inside the range counts under its new name.
   */
  static entriesAdded(opts: { cwd: string; from?: string; to: string; folder: string }): string[] {
    const range = opts.from === undefined ? opts.to : `${opts.from}..${opts.to}`;
    const names = ReleaseMergeBack.mustGit({
      cwd: opts.cwd,
      args: [
        'log',
        '--no-renames',
        '--diff-filter=A',
        '--name-only',
        '--format=',
        range,
        '--',
        opts.folder,
      ],
    })
      .split('\n')
      .filter((path) => GithubReleaseConstants.DATED_ENTRY.test(path.split('/').pop() ?? ''));

    return [...new Set(names)].sort();
  }

  /**
   * An entry as a Release shows it: no front matter, no date heading, and its heading without the
   * `VULCAN X.Y.Z:` prefix (the Release is titled with the version already).
   */
  static stripEntry(opts: { text: string }): string {
    return opts.text
      .replace(GithubReleaseConstants.FRONT_MATTER, '')
      .replace(GithubReleaseConstants.DATE_HEADING, '')
      .replace(
        GithubReleaseConstants.VERSION_HEADING,
        (_match, heading: string, first: string) => `${heading}${first.toUpperCase()}`,
      )
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

  /** A fenced list: a line in it cannot ping anyone, close an issue or break the markdown. */
  static fencedLines(opts: { lines: string[] }): string[] {
    return ['```text', ...opts.lines.map((line) => line.replaceAll('```', "'''")), '```'];
  }

  /** At most `MAX_PRERELEASE_SUBJECTS` subjects, with a closing line that says how many were left out. */
  static cappedSubjects(opts: { subjects: string[] }): string[] {
    const max = GithubReleaseConstants.MAX_PRERELEASE_SUBJECTS;

    return opts.subjects.length <= max
      ? opts.subjects
      : [...opts.subjects.slice(0, max), `... and ${opts.subjects.length - max} more`];
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
    kind: TReleaseKind;
    version: string;
    notes: string;
    subjects: string[];
    /** In release order: the last package is the one named in the install line of a prerelease. */
    packages: string[];
  }): string {
    const sections =
      opts.kind === ReleaseKinds.STABLE
        ? [opts.notes]
        : [
            `Install: \`npm install ${opts.packages.at(-1) ?? ''}@next\``,
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

  /**
   * Makes the Release of `tag`, or says why it did not: a git or filesystem failure is an outcome too.
   * With `dryRun` it stops before `gh` creates anything and returns the notes as the message.
   */
  static create(opts: {
    cwd: string;
    tag: string;
    kind: string;
    version: string;
    gh: TGh;
    scratchRoot: string;
    /** Falls back to commit subjects when no changelog entry covers a stable (a backfill). */
    withSubjectFallback?: boolean;
    dryRun?: boolean;
  }): IGithubReleaseOutcome {
    if (opts.tag === GithubReleaseConstants.ATLAS_INDEX_TAG) {
      return {
        state: 'refused',
        message: `${opts.tag} is the release of the atlas index, not of a publish`,
      };
    }

    if (opts.kind !== ReleaseKinds.STABLE && opts.kind !== ReleaseKinds.PRERELEASE) {
      return { state: 'refused', message: `the kind '${opts.kind}' is not stable or prerelease` };
    }

    if (opts.withSubjectFallback && opts.kind !== ReleaseKinds.STABLE) {
      return { state: 'refused', message: 'a backfill makes the Release of a stable only' };
    }

    if (opts.gh({ args: ['release', 'view', opts.tag, '--json', 'tagName'] }).status === 0) {
      return { state: 'exists', message: `${opts.tag} already has a Release - skipped` };
    }

    try {
      return GithubRelease.make({ ...opts, kind: opts.kind });
    } catch (error) {
      return { state: 'failed', message: error instanceof Error ? error.message : String(error) };
    }
  }

  private static make(opts: {
    cwd: string;
    tag: string;
    kind: TReleaseKind;
    version: string;
    gh: TGh;
    scratchRoot: string;
    withSubjectFallback?: boolean;
    dryRun?: boolean;
  }): IGithubReleaseOutcome {
    const stable = opts.kind === ReleaseKinds.STABLE;
    const manifest = GithubRelease.manifestOf({ cwd: opts.cwd });
    const tags = GithubRelease.tagsOf({ cwd: opts.cwd });
    const from = GithubRelease.previousTag({
      tags,
      templates: manifest.templates,
      version: opts.version,
      stableOnly: stable,
    });
    const subjects = GithubRelease.subjectsOf({
      cwd: opts.cwd,
      from,
      to: opts.tag,
      onlyIssues: !(stable && opts.withSubjectFallback),
    });
    let notes = stable
      ? GithubRelease.stableNotes({
          cwd: opts.cwd,
          from,
          to: opts.tag,
          folder: manifest.changelogs,
        })
      : '';

    if (stable && notes === '') {
      if (!opts.withSubjectFallback || subjects.length === 0) {
        return {
          state: 'failed',
          message: `no changelog entry was added since ${from ?? 'the start of history'}, so ${opts.tag} has no notes`,
        };
      }

      notes = [
        'Commits in this release:',
        '',
        ...GithubRelease.fencedLines({ lines: GithubRelease.cappedSubjects({ subjects }) }),
      ].join('\n');
    }

    const body = GithubRelease.bodyOf({
      kind: opts.kind,
      version: opts.version,
      notes,
      subjects: GithubRelease.cappedSubjects({ subjects }),
      packages: manifest.packages,
    });
    const latest =
      stable &&
      GithubRelease.isNewestStable({ tags, templates: manifest.templates, version: opts.version });

    if (opts.dryRun) {
      return {
        state: 'planned',
        message: `${opts.tag} (${opts.kind}, ${latest ? 'Latest' : 'not Latest'}), notes since ${from ?? 'the start of history'}:\n\n${body}`,
      };
    }

    const directory = mkdtempSync(join(opts.scratchRoot, 'github-release-'));

    try {
      const file = join(directory, 'notes.md');

      writeFileSync(file, body);

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
          stable ? (latest ? '--latest' : '--latest=false') : '--prerelease',
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

  /** The tag, version and kind a `create` or a `backfill` asks for; `undefined` when the flags do not give them. */
  static requestOf(opts: {
    args: string[];
    manifest: IGithubReleaseManifest;
  }): { tag: string; version: string; kind: string } | undefined {
    const tag = ReleaseMergeBack.flagValue({ args: opts.args, flag: '--tag' });

    if (tag === undefined) {
      return undefined;
    }

    if (opts.args[0] === 'backfill') {
      const version = GithubRelease.versionOfTag({ tag, templates: opts.manifest.templates });

      return version === undefined
        ? undefined
        : {
            tag,
            version,
            kind: version.includes('-') ? ReleaseKinds.PRERELEASE : ReleaseKinds.STABLE,
          };
    }

    const version = ReleaseMergeBack.flagValue({ args: opts.args, flag: '--version' });
    const kind = ReleaseMergeBack.flagValue({ args: opts.args, flag: '--kind' });

    return version === undefined || kind === undefined ? undefined : { tag, version, kind };
  }

  static main(opts: {
    args: string[];
    env: Record<string, string | undefined>;
    cwd?: string;
    gh?: TGh;
  }): number {
    const [command] = opts.args;
    const cwd = opts.cwd ?? process.cwd();
    const scratchRoot = opts.env['RUNNER_TEMP'] ?? tmpdir();
    const summary = opts.env['GITHUB_STEP_SUMMARY'];

    try {
      if (command === 'check') {
        const version = ReleaseMergeBack.flagValue({ args: opts.args, flag: '--version' });

        if (version === undefined) {
          console.error(GithubReleaseConstants.USAGE);

          return 2;
        }

        const problems = GithubRelease.check({
          cwd,
          version,
          to: ReleaseMergeBack.flagValue({ args: opts.args, flag: '--to' }) ?? 'HEAD',
        });

        problems.forEach((problem) => console.error(`ERROR | ${problem}`));

        return problems.length === 0 ? 0 : 1;
      }

      if (command === 'create' || command === 'backfill') {
        const request = GithubRelease.requestOf({
          args: opts.args,
          manifest: GithubRelease.manifestOf({ cwd }),
        });

        if (request === undefined) {
          console.error(GithubReleaseConstants.USAGE);

          return 2;
        }

        const backfill = command === 'backfill';
        const outcome = GithubRelease.create({
          cwd,
          ...request,
          gh: opts.gh ?? GithubRelease.ghOf({ cwd }),
          scratchRoot,
          withSubjectFallback: backfill,
          dryRun: backfill && !opts.args.includes('--yes'),
        });

        console.log(`github-release: ${outcome.state} - ${outcome.message}`);

        if (summary !== undefined) {
          appendFileSync(summary, GithubRelease.summaryOf({ outcome }));
        }

        return outcome.state === 'failed' || outcome.state === 'refused' ? 1 : 0;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      console.error(`ERROR | ${message}`);

      if (summary !== undefined) {
        appendFileSync(summary, GithubRelease.summaryOf({ outcome: { state: 'failed', message } }));
      }

      return 1;
    }

    console.error(GithubReleaseConstants.USAGE);

    return 2;
  }
}

if (import.meta.main) {
  process.exit(GithubRelease.main({ args: process.argv.slice(2), env: process.env }));
}

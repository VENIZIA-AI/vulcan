/**
 * The GitHub Release of a publish: one Release on the tag of a stable run, and none for a prerelease.
 *
 *   bun scripts/release/github-release.ts create --tag <tag> --version <v> --kind stable|prerelease
 *
 * A stable whose version has a folder `changelogs/<v>/` is released with the notes `vulcan migrate notes` prints (the
 * body of its `log.md` and the packages) and, when its `migration.yaml` holds a block, with that file attached as
 * `migration-<v>.yaml`. A stable of a project that keeps dated entries is released with the entries added since the
 * previous stable. It never creates, edits or moves the `atlas-index` release.
 */
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VersionNotes } from '../../packages/atlas/src/changelogs/notes.ts';
import { ReleaseMergeBack } from './merge-back.ts';
import { ReleaseKinds } from './release-args.ts';
import type { TReleaseKind } from './release-args.ts';

export class GithubReleaseConstants {
  /** The release the atlas index publishes its pairs to. */
  static readonly ATLAS_INDEX_TAG = 'atlas-index';
  static readonly MANIFEST = '.agents/atlas.manifest.json';
  static readonly DATED_ENTRY = /^\d{4}-\d{2}-\d{2}-.*\.md$/;
  static readonly DATE_HEADING = /^# Changelog - \d{4}-\d{2}-\d{2}\s*$/m;
  /** `## VULCAN X.Y.Z: title` or `## VULCAN 0.2.0-0: title`: the product and version prefix an older entry's heading carries; a heading with no prefix does not match and is left as written. */
  static readonly VERSION_HEADING = /^(##\s+)VULCAN\s+(?:X\.Y\.Z|\d[^:\n]*):\s*(\S)/m;
  /** The unspaced run of `[#N]` tokens a subject opens with: `[#42][#44] ...` serves two issues (sync-pr.ts reads it). */
  static readonly ISSUE_TOKENS = /^(?:\[#\d+\])+/;
  static readonly TITLE_PREFIX = 'VULCAN';
  static readonly USAGE =
    'github-release: create --tag <tag> --version <v> --kind stable|prerelease';
}

interface IGithubReleaseManifest {
  templates: string[];
  changelogs: string;
  /** `knowledge.migrationFrom`: a version once the project keeps a folder per version, a date or absent before. */
  migrationFrom?: string;
  /** The npm names of the packages, in release order: the last is the one users install. */
  packages: string[];
}

interface IGhResult {
  status: number;
  stdout: string;
  stderr: string;
}

export type TGh = (opts: { args: string[] }) => IGhResult;

type TGithubReleaseState = 'created' | 'exists' | 'skipped' | 'refused' | 'failed';

interface IGithubReleaseOutcome {
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
    const migrationFrom = GithubRelease.isRecord(knowledge)
      ? knowledge.value['migrationFrom']
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
      ...(typeof migrationFrom === 'string' ? { migrationFrom } : {}),
      // A retired package is not released any more: it is not listed.
      packages: packages.flatMap((entry) => {
        const holder = { value: entry };

        return GithubRelease.isRecord(holder) &&
          typeof holder.value['name'] === 'string' &&
          holder.value['retired'] !== true
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

  /** The highest stable tag below `version`. */
  static previousTag(opts: {
    tags: string[];
    templates: string[];
    version: string;
  }): string | undefined {
    let best: { tag: string; version: string } | undefined;

    for (const tag of opts.tags) {
      const version = GithubRelease.versionOfTag({ tag, templates: opts.templates });

      if (
        version === undefined ||
        Bun.semver.order(version, opts.version) >= 0 ||
        version.includes('-') ||
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
   * `VULCAN <version>:` prefix an older entry carries (the Release is titled with the version already).
   */
  static stripEntry(opts: { text: string }): string {
    return opts.text
      .replace(VersionNotes.FRONT_MATTER, '')
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

  /** A fenced list: a line in it cannot ping anyone, close an issue or break the markdown (sync-pr.ts uses it). */
  static fencedLines(opts: { lines: string[] }): string[] {
    return ['```text', ...opts.lines.map((line) => line.replaceAll('```', "'''")), '```'];
  }

  /** The body of a stable's Release: its notes, then the packages. */
  static bodyOf(opts: { notes: string; version: string; packages: string[] }): string {
    return [
      opts.notes,
      '',
      VersionNotes.packagesOf({ names: opts.packages, version: opts.version }),
      '',
    ].join('\n');
  }

  /**
   * The notes and the migration file of a version folder as the tag holds them, or `undefined` when the tag holds no
   * folder of that version: the project keeps dated entries, or has not adopted the folders yet.
   */
  static folderNotes(opts: {
    cwd: string;
    tag: string;
    folder: string;
    version: string;
    packages: string[];
  }): { notes: string; migration?: string } | undefined {
    const path = `${opts.folder}/${opts.version}`;
    const log = ReleaseMergeBack.git({
      cwd: opts.cwd,
      args: ['show', `${opts.tag}:${path}/log.md`],
    });

    if (log.status !== 0) {
      return undefined;
    }

    const migration = ReleaseMergeBack.git({
      cwd: opts.cwd,
      args: ['show', `${opts.tag}:${path}/migration.yaml`],
    });
    const text = migration.status === 0 ? migration.stdout : undefined;

    return {
      notes: VersionNotes.notesOf({ log: log.stdout, names: opts.packages, version: opts.version }),
      ...(VersionNotes.hasBlocks({ migration: text }) && text !== undefined
        ? { migration: text }
        : {}),
    };
  }

  /** Makes the Release of `tag`, or says why it did not: a git or filesystem failure is an outcome too. */
  static create(opts: {
    cwd: string;
    tag: string;
    kind: string;
    version: string;
    gh: TGh;
    scratchRoot: string;
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

    // A prerelease is on npm under `next` and in git; the Releases page lists stables only.
    if (opts.kind === ReleaseKinds.PRERELEASE) {
      return {
        state: 'skipped',
        message: `${opts.tag} is a prerelease: only a stable has a GitHub Release`,
      };
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
  }): IGithubReleaseOutcome {
    const manifest = GithubRelease.manifestOf({ cwd: opts.cwd });
    const tags = GithubRelease.tagsOf({ cwd: opts.cwd });
    const folder = GithubRelease.folderNotes({
      cwd: opts.cwd,
      tag: opts.tag,
      folder: manifest.changelogs,
      version: opts.version,
      packages: manifest.packages,
    });
    let body: string;

    if (folder === undefined) {
      const from = GithubRelease.previousTag({
        tags,
        templates: manifest.templates,
        version: opts.version,
      });
      const notes = GithubRelease.stableNotes({
        cwd: opts.cwd,
        from,
        to: opts.tag,
        folder: manifest.changelogs,
      });

      // No entry since the previous stable is no fault: the changelog records only what affects users.
      body = GithubRelease.bodyOf({
        notes: notes === '' ? VersionNotes.NO_USER_CHANGES : notes,
        version: opts.version,
        packages: manifest.packages,
      });
    } else {
      body = folder.notes;
    }

    const latest = GithubRelease.isNewestStable({
      tags,
      templates: manifest.templates,
      version: opts.version,
    });
    const directory = mkdtempSync(join(opts.scratchRoot, 'github-release-'));

    try {
      const file = join(directory, 'notes.md');
      const assets: string[] = [];

      writeFileSync(file, body);

      if (folder?.migration !== undefined) {
        const migration = join(directory, `migration-${opts.version}.yaml`);

        writeFileSync(migration, folder.migration);
        assets.push(migration);
      }

      const created = opts.gh({
        args: [
          'release',
          'create',
          opts.tag,
          ...assets,
          '--title',
          `${GithubReleaseConstants.TITLE_PREFIX} ${opts.version}`,
          '--notes-file',
          file,
          '--verify-tag',
          latest ? '--latest' : '--latest=false',
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

  /** The tag, version and kind a `create` asks for; `undefined` when the flags do not give them. */
  static requestOf(opts: {
    args: string[];
    manifest: IGithubReleaseManifest;
  }): { tag: string; version: string; kind: string } | undefined {
    const tag = ReleaseMergeBack.flagValue({ args: opts.args, flag: '--tag' });

    if (tag === undefined) {
      return undefined;
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
      if (command === 'create') {
        const request = GithubRelease.requestOf({
          args: opts.args,
          manifest: GithubRelease.manifestOf({ cwd }),
        });

        if (request === undefined) {
          console.error(GithubReleaseConstants.USAGE);

          return 2;
        }

        const outcome = GithubRelease.create({
          cwd,
          ...request,
          gh: opts.gh ?? GithubRelease.ghOf({ cwd }),
          scratchRoot,
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

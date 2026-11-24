/**
 * The release notes of a version folder, from the text of its two files. It imports nothing, so the release scripts load
 * it straight from the repository, and `vulcan migrate notes` runs the same file: the notes of a release and the
 * notes the command prints cannot differ.
 */
export class VersionNotes {
  /** The frontmatter block at the top of a markdown file. */
  static readonly FRONT_MATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;

  /** The notes of a version whose `log.md` says nothing: the changelog records what affects users, and nothing did. */
  static readonly NO_USER_CHANGES = 'No change for users of the packages in this release.';

  /** `log.md` without its front matter; empty when nothing else is in it. */
  static bodyOf(opts: { log: string }): string {
    return opts.log.replace(VersionNotes.FRONT_MATTER, '').trim();
  }

  /** Whether `migration.yaml` holds a block: an absent file, an empty one and `{}` hold none. */
  static hasBlocks(opts: { migration?: string }): boolean {
    if (opts.migration === undefined || opts.migration.trim() === '') {
      return false;
    }

    try {
      const parsed: unknown = Bun.YAML.parse(opts.migration);

      return typeof parsed === 'object' && parsed !== null && Object.keys(parsed).length > 0;
    } catch {
      // A file that does not parse is not "no block": it ships, and the gate is where it fails.
      return true;
    }
  }

  /** `## Packages`, a link per package at the version: what every Release lists under its notes. */
  static packagesOf(opts: { names: string[]; version: string }): string {
    return [
      '## Packages',
      '',
      ...opts.names.map(
        (name) =>
          `- [${name}@${opts.version}](https://www.npmjs.com/package/${name}/v/${opts.version})`,
      ),
    ].join('\n');
  }

  /** The notes: the body of `log.md`, then the packages. */
  static notesOf(opts: { log: string; names: string[]; version: string }): string {
    const body = VersionNotes.bodyOf({ log: opts.log });

    return `${[body === '' ? VersionNotes.NO_USER_CHANGES : body, '', VersionNotes.packagesOf(opts)].join('\n')}\n`;
  }
}

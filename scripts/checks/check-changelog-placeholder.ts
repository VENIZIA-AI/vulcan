/**
 * A changelog entry never carries the template placeholder `X.Y.Z`.
 *
 * An entry title is a plain sentence with no product or version prefix, so a literal `X.Y.Z` in a file of
 * `docs/wiki/content/changelogs/` is a placeholder that was never filled: it reaches the wiki, the feed and
 * the GitHub Release notes as nonsense. The gate fails on it in any line of a dated entry and names the file and line.
 *
 *   bun scripts/checks/check-changelog-placeholder.ts [--root <repository root>]
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const CHANGELOGS = join('docs', 'wiki', 'content', 'changelogs');
const DATED_ENTRY = /^\d{4}-\d{2}-\d{2}-.*\.md$/;
const PLACEHOLDER = /\bX\.Y\.Z\b/;

export class ChangelogPlaceholder {
  /** Every line of a dated entry under `root` that holds the placeholder, as `file:line: text`. */
  static scan(opts: { root: string }): string[] {
    const directory = join(opts.root, CHANGELOGS);

    return readdirSync(directory)
      .filter((file) => DATED_ENTRY.test(file))
      .sort()
      .flatMap((file) =>
        readFileSync(join(directory, file), 'utf8')
          .split('\n')
          .flatMap((text, index) =>
            PLACEHOLDER.test(text) ? [`${CHANGELOGS}/${file}:${index + 1}: ${text.trim()}`] : [],
          ),
      );
  }

  static run(opts: { argv: string[] }): number {
    const index = opts.argv.indexOf('--root');
    const root = index === -1 ? join(import.meta.dir, '..', '..') : (opts.argv[index + 1] ?? '.');
    const found = ChangelogPlaceholder.scan({ root });

    if (found.length > 0) {
      console.error(
        `changelog-placeholder: ${found.length} line(s) hold the placeholder X.Y.Z - a title is a plain sentence with no product or version prefix:\n${found
          .map((line) => `  ${line}`)
          .join('\n')}`,
      );

      return 1;
    }

    return 0;
  }
}

if (import.meta.main) {
  process.exit(ChangelogPlaceholder.run({ argv: process.argv }));
}

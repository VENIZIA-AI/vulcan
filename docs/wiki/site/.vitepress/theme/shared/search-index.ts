/**
 * Shared by the three wikis (IGNIS, ARDOR, VULCAN): a byte-identical copy in each, kept in step by
 * scripts/wiki-shared in VULCAN. Edit it there, never in a copy.
 *
 * Builds the search index of a built wiki with the installed Pagefind, into `dist/pagefind/`. A wiki's `docs:build`
 * runs it after `vitepress build`; it needs `pagefind` in the devDependencies of `docs/wiki` and nothing is downloaded.
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** This file is five folders under the wiki folder: site/.vitepress/theme/shared. */
const WIKI = resolve(import.meta.dir, '..', '..', '..', '..');
/** The content of a page: the default theme's column, which the changelog pages use too. */
const CONTENT = '.VPContent';
/** The attribute that tells Pagefind which region of a page to index. */
const BODY = 'data-pagefind-body';
/**
 * What is no content of a page: the outline, the previous and next links, the eyebrow, the help block, the rails of a
 * changelog page, and the language label, copy button and tab names of a code block, which would run into its code.
 */
const EXCLUDED = [
  '.VPDoc .aside',
  '.VPDocFooter',
  '.doc-eyebrow',
  '.docs-help',
  '.cx-rail',
  '.vp-code-group .tabs',
  'button.copy',
  'span.lang',
];

export class SearchIndex {
  /**
   * A built page made ready for the index: its content region marked; its first `h1` kept as the title of the page and left
   * out of the text, so an excerpt does not open with it again; and a space at the end of every table cell, which
   * Pagefind would otherwise read as one word with the next. A page already marked is returned as it is.
   */
  static mark(opts: { html: string }): string {
    let marked = false;
    let named = false;

    return new HTMLRewriter()
      .on(CONTENT, {
        element: (element) => {
          marked = element.hasAttribute(BODY);
          element.setAttribute(BODY, '');
        },
      })
      .on(`${CONTENT} h1`, {
        element: (element) => {
          if (!named) {
            element.setAttribute('data-pagefind-meta', 'title');
            element.setAttribute('data-pagefind-ignore', '');
          }

          named = true;
        },
      })
      .on(`${CONTENT} th, ${CONTENT} td`, {
        element: (element) => {
          if (!marked) {
            element.append(' ');
          }
        },
      })
      .transform(opts.html);
  }

  static commandOf(opts: { wiki: string }): string[] {
    return [
      // The package's own runner, run by this Bun: its `.bin` entry asks for Node.
      process.execPath,
      join(opts.wiki, 'node_modules', 'pagefind', 'lib', 'runner', 'bin.cjs'),
      '--site',
      join(opts.wiki, 'site', '.vitepress', 'dist'),
      '--exclude-selectors',
      EXCLUDED.join(','),
    ];
  }

  static async run(opts: { wiki: string }): Promise<number> {
    const command = SearchIndex.commandOf(opts);

    if (!existsSync(command[1])) {
      console.error(
        'wiki search: pagefind is not installed: add it to the devDependencies of docs/wiki, pinned, and run bun install',
      );

      return 1;
    }

    const dist = join(opts.wiki, 'site', '.vitepress', 'dist');

    for await (const page of new Bun.Glob('**/*.html').scan({ cwd: dist })) {
      const file = join(dist, page);

      await Bun.write(file, SearchIndex.mark({ html: await Bun.file(file).text() }));
    }

    return Bun.spawnSync(command, { stdout: 'inherit', stderr: 'inherit' }).exitCode;
  }
}

if (import.meta.main) {
  process.exit(await SearchIndex.run({ wiki: WIKI }));
}

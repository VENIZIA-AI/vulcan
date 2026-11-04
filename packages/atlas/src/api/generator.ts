/**
 * The API reference of a project's packages: one markdown page for each `exports` entry, listing every
 * export with its kind, its TSDoc and its declaration, read from the same symbol records the `symbol`
 * tool serves. The pages go under the wiki, are generated and are never edited; `check` fails when one is
 * stale. Usage: vulcan x atlas api gen|check
 */
import { readdirSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ProjectConfig } from '@/common/project-config';
import type { ISymbolRecord } from '@/symbols';
import { DeclarationText } from '@/symbols/declaration-text';
import { SymbolCompute } from '@/symbols/compute';

/** One page: the file it is written to and the text. */
export interface IApiPage {
  file: string;
  specifier: string;
  text: string;
  total: number;
  undocumented: string[];
}

export class ApiReference {
  /** Under the wiki content directory. */
  static readonly DIRECTORY = 'references/api';
  static readonly INDEX_FILE = 'index.md';
  private static readonly GENERATED_NOTE =
    'Generated from the built declarations by `vulcan x atlas api gen` - do not edit.';

  /** An export whose TSDoc says `@internal` is not public API: it has no page section and is not counted. */
  static isInternal(opts: { record: ISymbolRecord }): boolean {
    return /(^|\s)@internal\b/.test(opts.record.doc ?? '');
  }

  /** A page for each entry (package and subpath) the records name, sorted by specifier, and an index of them. */
  static pagesOf(opts: { records: ISymbolRecord[] }): IApiPage[] {
    const bySpecifier = new Map<string, ISymbolRecord[]>();

    for (const record of opts.records.filter(
      (item) => !ApiReference.isInternal({ record: item }),
    )) {
      const group = bySpecifier.get(record.specifier) ?? [];

      group.push(record);
      bySpecifier.set(record.specifier, group);
    }

    return [...bySpecifier.entries()]
      .sort(([left], [right]) => (left < right ? -1 : 1))
      .map(([specifier, records]) => ApiReference.pageOf({ specifier, records }));
  }

  /** The page file of an entry: `@scope/name/testing` is `scope-name-testing.md`. */
  static fileOf(opts: { specifier: string }): string {
    return `${opts.specifier.replace(/^@/, '').replaceAll('/', '-')}.md`;
  }

  static indexOf(opts: { pages: IApiPage[] }): string {
    const rows = opts.pages.map((page) => {
      const documented = page.total - page.undocumented.length;

      return `| [\`${page.specifier}\`](/${ApiReference.DIRECTORY}/${page.file.replace(/\.md$/, '')}) | ${page.total} | ${documented} |`;
    });

    return [
      '---',
      'title: API reference',
      'description: Every export of every package entry, from the built declarations (generated).',
      '---',
      '',
      '# API reference',
      '',
      `> ${ApiReference.GENERATED_NOTE}`,
      '',
      '| Entry | Exports | With TSDoc |',
      '|---|---|---|',
      ...rows,
      '',
    ].join('\n');
  }

  /** What `gen` writes: the entry pages and the index, by file name. */
  static filesOf(opts: { records: ISymbolRecord[] }): Map<string, string> {
    const pages = ApiReference.pagesOf(opts);

    return new Map<string, string>([
      ...pages.map((page): [string, string] => [page.file, page.text]),
      [ApiReference.INDEX_FILE, ApiReference.indexOf({ pages })],
    ]);
  }

  /** The files of `directory` that differ from `expected`: missing, changed or no longer generated. Empty when fresh. */
  static staleOf(opts: { expected: Map<string, string>; directory: string }): string[] {
    const present = existsSync(opts.directory)
      ? readdirSync(opts.directory).filter((name) => name.endsWith('.md'))
      : [];
    const stale = [...opts.expected.entries()]
      .filter(([file, text]) => {
        const path = join(opts.directory, file);

        return !existsSync(path) || readFileSync(path, 'utf8') !== text;
      })
      .map(([file]) => file);

    return [...stale, ...present.filter((name) => !opts.expected.has(name))].sort();
  }

  /** Prose from a TSDoc comment made safe for the wiki: markup it did not mean is escaped outside code. */
  static proseOf(opts: { text: string }): string {
    let isFenced = false;

    return opts.text
      .split('\n')
      .map((line) => {
        if (/^\s*(```|~~~)/.test(line)) {
          isFenced = !isFenced;

          return line;
        }

        if (isFenced) {
          return line;
        }

        // Odd parts of a split on backtick runs are code spans, left as they are.
        return line
          .split(/(`+[^`]*`+)/)
          .map((part, at) =>
            at % 2 === 1 ? part : part.replaceAll('<', '&lt;').replaceAll('{{', '&#123;&#123;'),
          )
          .join('');
      })
      .join('\n');
  }

  /** A fence longer than any run of backticks inside the text, so an example in a comment cannot close it. */
  static fenceOf(opts: { text: string }): string {
    const longest = Math.max(0, ...(opts.text.match(/`+/g) ?? []).map((run) => run.length));

    return '`'.repeat(Math.max(3, longest + 1));
  }

  private static pageOf(opts: { specifier: string; records: ISymbolRecord[] }): IApiPage {
    const records = [...opts.records].sort((left, right) =>
      left.name.localeCompare(right.name, 'en'),
    );
    const undocumented = records
      .filter((record) => !record.external && (record.doc ?? '') === '')
      .map((record) => record.name);
    const sections = records.map((record) => ApiReference.sectionOf({ record }));
    const gap =
      undocumented.length === 0
        ? []
        : [
            `Without TSDoc (${undocumented.length}): ${undocumented.map((name) => `\`${name}\``).join(', ')}.`,
            '',
          ];

    return {
      file: ApiReference.fileOf({ specifier: opts.specifier }),
      specifier: opts.specifier,
      total: records.length,
      undocumented,
      text: [
        '---',
        `title: ${opts.specifier}`,
        `description: Every export of ${opts.specifier}, from the built declarations (generated).`,
        '---',
        '',
        `# \`${opts.specifier}\``,
        '',
        `> ${ApiReference.GENERATED_NOTE}`,
        '',
        `${records.length} exports, ${records.length - undocumented.length} with TSDoc.`,
        '',
        ...gap,
        ...sections.flat(),
      ].join('\n'),
    };
  }

  private static sectionOf(opts: { record: ISymbolRecord }): string[] {
    const { record } = opts;
    const code =
      record.declaration === undefined
        ? record.signature
        : DeclarationText.withoutDoc({ declaration: record.declaration });
    const fence = ApiReference.fenceOf({ text: code });
    const source = record.external ? [] : [`Source: \`${record.file}:${record.line}\``, ''];

    return [
      `## \`${record.name}\``,
      '',
      `*${record.kind}*`,
      '',
      ...((record.doc ?? '') === '' ? [] : [ApiReference.proseOf({ text: record.doc ?? '' }), '']),
      `${fence}ts`,
      code,
      fence,
      '',
      ...source,
    ];
  }
}

const directoryOf = (opts: { wiki: string }): string => join(opts.wiki, ApiReference.DIRECTORY);

export const runApiCommand = (opts: { command?: string }): number => {
  if (opts.command !== 'gen' && opts.command !== 'check') {
    console.error('usage: vulcan x atlas api gen|check');

    return 2;
  }

  const project = ProjectConfig.readAtlasProject();
  const wiki = project.knowledge.wiki;

  if (wiki === undefined) {
    console.error(
      'vulcan x atlas api: this project declares no wiki (knowledge.wiki in the config)',
    );

    return 1;
  }

  const records = SymbolCompute.symbolsOfRepository({ project });

  if (records.length === 0) {
    console.error('vulcan x atlas api: no exports found - build the packages first');

    return 1;
  }

  const expected = ApiReference.filesOf({ records });
  const directory = directoryOf({ wiki });

  if (opts.command === 'check') {
    const stale = ApiReference.staleOf({ expected, directory });

    if (stale.length === 0) {
      console.log(`fresh ${ApiReference.DIRECTORY} (${expected.size} files)`);

      return 0;
    }

    console.error(
      `stale ${ApiReference.DIRECTORY}: ${stale.join(', ')} - the public API or its TSDoc changed; run \`vulcan x atlas api gen\``,
    );

    return 1;
  }

  mkdirSync(directory, { recursive: true });

  for (const name of ApiReference.staleOf({ expected, directory })) {
    if (!expected.has(name)) {
      rmSync(join(directory, name));
    }
  }

  for (const [file, text] of expected) {
    writeFileSync(join(directory, file), text);
  }

  console.log(`wrote ${expected.size} files to ${ApiReference.DIRECTORY}`);

  return 0;
};

/**
 * The API reference of a project's packages: one markdown page for each `exports` entry, listing every
 * export with its kind, its TSDoc and its declaration, read from the same symbol records the `symbol`
 * tool serves. The pages go under the wiki, are generated and are never edited; `check` fails when one is
 * stale. Usage: vulcan x atlas api gen|check
 */
import { readdirSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ProjectConfig } from '@/common/project-config';
import type { IAtlasProject } from '@/common/project-config';
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

/** A package of the project: its npm name and its folder, as the manifest has them. */
export interface IApiPackage {
  name: string;
  path: string;
}

/** An export an entry lists but another entry declares. */
interface IReexport {
  name: string;
  home: string;
}

export class ApiReference {
  /** Under the wiki content directory. */
  static readonly DIRECTORY = 'references/api';
  static readonly INDEX_FILE = 'index.md';
  private static readonly GENERATED_NOTE =
    'Generated from the built declarations by `vulcan x atlas api gen` - do not edit.';

  /** A file this command wrote carries its note; a page someone wrote by hand in the same folder does not. */
  static isGenerated(opts: { text: string }): boolean {
    return opts.text.includes(ApiReference.GENERATED_NOTE);
  }

  /**
   * The exports that have a declaration to document and no TSDoc on it, for each entry that has any. A re-export of a
   * third-party declaration or of a whole module has none of its own, and an `@internal` export is not public.
   */
  static undocumentedOf(opts: {
    records: ISymbolRecord[];
    packages?: IApiPackage[];
  }): { specifier: string; names: string[] }[] {
    return ApiReference.pagesOf(opts)
      .filter((page) => page.undocumented.length > 0)
      .map((page) => ({ specifier: page.specifier, names: page.undocumented }));
  }

  /** An export whose TSDoc says `@internal` is not public API: it has no page section and is not counted. */
  static isInternal(opts: { record: ISymbolRecord }): boolean {
    return /(^|\s)@internal\b/.test(opts.record.doc ?? '');
  }

  /**
   * The entry that declares each export, for the entries that list the same one. Records of one source file, line
   * and name are one export; its home is the entry of the package that owns the file (the most specific entry
   * of it: the longest specifier), or, when no package of the project owns it, the longest specifier of all.
   */
  static homesOf(opts: {
    records: ISymbolRecord[];
    packages?: IApiPackage[];
  }): Map<ISymbolRecord, string> {
    const groups = new Map<string, ISymbolRecord[]>();

    for (const record of opts.records) {
      const key = [record.file, record.line, record.name].join('\u0000');
      const group = groups.get(key) ?? [];

      group.push(record);
      groups.set(key, group);
    }

    const homes = new Map<ISymbolRecord, string>();

    for (const group of groups.values()) {
      const own = group.filter((record) => !record.external);
      const candidates = own.length > 0 ? own : group;
      const owner = (opts.packages ?? []).find((item) =>
        candidates[0].file.startsWith(`${item.path}/`),
      );
      const owned = candidates.filter((record) => record.package === owner?.name);
      const pool = owned.length > 0 ? owned : candidates;
      const [home] = [...pool].sort(
        (left, right) =>
          right.specifier.length - left.specifier.length ||
          (left.specifier < right.specifier ? -1 : 1),
      );

      for (const record of group) {
        homes.set(record, home.specifier);
      }
    }

    return homes;
  }

  /**
   * A page for each entry (package and subpath) the records name, sorted by specifier. An export is listed once, on
   * its home entry; an entry that only re-exports it names the home.
   */
  static pagesOf(opts: { records: ISymbolRecord[]; packages?: IApiPackage[] }): IApiPage[] {
    const records = opts.records.filter((item) => !ApiReference.isInternal({ record: item }));
    const homes = ApiReference.homesOf({ records, packages: opts.packages });
    const own = new Map<string, ISymbolRecord[]>();
    const reexported = new Map<string, IReexport[]>();

    for (const record of records) {
      const home = homes.get(record) ?? record.specifier;
      const entry = own.get(record.specifier) ?? [];
      const links = reexported.get(record.specifier) ?? [];

      if (home === record.specifier) {
        entry.push(record);
      } else {
        links.push({ name: record.name, home });
      }

      own.set(record.specifier, entry);
      reexported.set(record.specifier, links);
    }

    return [...own.entries()]
      .sort(([left], [right]) => (left < right ? -1 : 1))
      .map(([specifier, entryRecords]) =>
        ApiReference.pageOf({
          specifier,
          records: entryRecords,
          reexports: reexported.get(specifier) ?? [],
        }),
      );
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
  static filesOf(opts: {
    records: ISymbolRecord[];
    packages?: IApiPackage[];
  }): Map<string, string> {
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

    // A file that is not in the generated set and was not generated is someone's own page: never stale, never removed.
    const removed = present.filter(
      (name) =>
        !opts.expected.has(name) &&
        ApiReference.isGenerated({ text: readFileSync(join(opts.directory, name), 'utf8') }),
    );

    return [...stale, ...removed].sort();
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

  private static pageOf(opts: {
    specifier: string;
    records: ISymbolRecord[];
    reexports: IReexport[];
  }): IApiPage {
    const records = [...opts.records].sort((left, right) =>
      left.name.localeCompare(right.name, 'en'),
    );
    const undocumented = records
      .filter((record) => record.declaration !== undefined && (record.doc ?? '') === '')
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
        `title: ${JSON.stringify(opts.specifier)}`,
        `description: ${JSON.stringify(`Every export of ${opts.specifier}, from the built declarations (generated).`)}`,
        '---',
        '',
        `# \`${opts.specifier}\``,
        '',
        `> ${ApiReference.GENERATED_NOTE}`,
        '',
        `${records.length} exports, ${records.length - undocumented.length} with TSDoc.${opts.reexports.length === 0 ? '' : ` ${opts.reexports.length} more are re-exported from other entries (listed at the end).`}`,
        '',
        ...gap,
        ...sections.flat(),
        ...ApiReference.reexportsOf({ reexports: opts.reexports }),
      ].join('\n'),
    };
  }

  /** One line for each export this entry only re-exports, linked to the page that declares it. */
  private static reexportsOf(opts: { reexports: IReexport[] }): string[] {
    if (opts.reexports.length === 0) {
      return [];
    }

    const lines = [...opts.reexports]
      .sort((left, right) => left.name.localeCompare(right.name, 'en'))
      .map((item) => {
        const page = ApiReference.fileOf({ specifier: item.home }).replace(/\.md$/, '');

        return `- \`${item.name}\` from [\`${item.home}\`](/${ApiReference.DIRECTORY}/${page})`;
      });

    return ['## Re-exported', '', ...lines, ''];
  }

  private static sectionOf(opts: { record: ISymbolRecord }): string[] {
    const { record } = opts;
    const code =
      record.declaration === undefined
        ? record.signature
        : DeclarationText.withoutDoc({ declaration: record.declaration });
    const fence = ApiReference.fenceOf({ text: code });
    // No line number: a line moves with any edit above it, and the freshness check would fail for nothing.
    const source = record.external ? [] : [`Source: \`${record.file}\``, ''];

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

const USAGE = 'usage: vulcan x atlas api gen|check | undocumented [--package <dir or name>]...';

/** The npm names the `--package` values stand for: a directory key or an npm name of a package of the project. */
const packagesOf = (opts: { args: string[]; project: IAtlasProject }): string[] | undefined => {
  const wanted = opts.args.flatMap((arg, at) =>
    arg === '--package' ? [opts.args[at + 1] ?? ''] : [],
  );

  if (wanted.length === 0) {
    return undefined;
  }

  return opts.project.packages
    .filter((entry) => wanted.includes(entry.dir) || wanted.includes(entry.name))
    .map((entry) => entry.name);
};

export const runApiCommand = (opts: { command?: string; args?: string[] }): number => {
  if (opts.command !== 'gen' && opts.command !== 'check' && opts.command !== 'undocumented') {
    console.error(USAGE);

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

  // Only `undocumented` reads a package that publishes its source: a page or a check of pages needs declaration text.
  const all = SymbolCompute.symbolsOfRepository({
    project,
    withSource: opts.command === 'undocumented',
  });
  const only = packagesOf({ args: opts.args ?? [], project });
  const records = only === undefined ? all : all.filter((record) => only.includes(record.package));

  if (records.length === 0) {
    console.error('vulcan x atlas api: no exports found - build the packages first');

    return 1;
  }

  if (opts.command === 'undocumented') {
    const gaps = ApiReference.undocumentedOf({
      records,
      packages: project.packages.map((item) => ({ name: item.name, path: item.path })),
    });

    if (gaps.length === 0) {
      console.log('every export has TSDoc');

      return 0;
    }

    for (const gap of gaps) {
      console.error(`${gap.specifier}: ${gap.names.join(', ')}`);
    }

    console.error(`${gaps.reduce((sum, gap) => sum + gap.names.length, 0)} exports have no TSDoc`);

    return 1;
  }

  const packages = project.packages.map((item) => ({ name: item.name, path: item.path }));
  const expected = ApiReference.filesOf({ records, packages });
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

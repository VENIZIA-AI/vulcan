import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OkfProject } from '../project/index.ts';
import { SourceScanner } from '../source/index.ts';

/** Reading the project's source - every `dir` is relative to the project root. */
export interface IRenderSource {
  /** The folders directly under `dir`, sorted, without the pruned ones (`node_modules`, `.git`, ...). */
  listDirs(opts: { dir: string }): string[];
  /** Every `.ts` file under `dir`, declaration files excluded, in path order; none when `dir` does not exist. */
  sourceFiles(opts: { dir: string }): string[];
  /** Exported classes named `<anything><suffix>`, abstract ones included, per configured dir. */
  exportedClasses(opts: { dirs: string[]; suffix: string }): { dir: string; classes: string[] }[];
  /** Capture group 1 of `pattern`, matched against each file's text, per configured dir. */
  exportedNames(opts: { dirs: string[]; pattern: RegExp }): { dir: string; names: string[] }[];
}

/** The frame of a generated reference file. */
export interface IRenderPage {
  /** The front matter of a generated file: `type: Reference`, the given fields, and the `generated` marker. */
  header(opts: { title: string; description: string; resource: string; tags: string[] }): string;
  /** The line under the front matter that says the file is generated and must not be edited; `seeAlso` is appended when not empty. */
  note(opts: { seeAlso: string }): string;
}

/** What a renderer gets: the project, the okf config entry that names it, and the helpers to read source and to frame a page. */
export interface IRenderContext {
  /** The absolute path of the project root. */
  root: string;
  /** The absolute path of the knowledge bundle. */
  bundle: string;
  /** The `options` of the `okf.renderers` entry that names this renderer; `{}` when it has none. */
  options: Record<string, unknown>;
  source: IRenderSource;
  page: IRenderPage;
}

/** `path` is relative to the bundle. */
export interface IRenderedFile {
  path: string;
  /** The whole text of the file. */
  content: string;
}

/**
 * A renderer: `collect` is the one extraction of its facts; `render` (a whole file), `region` (a
 * managed region) and `coverage` (the report's reference row) all read those facts, so a table and
 * its count can never disagree. `render` returns one file or a list of them - a renderer may own any
 * number of pages.
 */
export interface IRenderer<TFacts = unknown> {
  /** The name the `okf.renderers` entry and the managed regions use for this renderer; a module must define the id its entry names. */
  id: string;
  /** Reads the project once and returns the facts that `render`, `region` and `coverage` all use. */
  collect(opts: { context: IRenderContext }): TFacts;
  /** The whole file (or files) this renderer owns, written under the bundle. */
  render?(opts: { context: IRenderContext; facts: TFacts }): IRenderedFile | IRenderedFile[];
  /** The text of one managed region, between its markers in a hand-written page. */
  region?(opts: { context: IRenderContext; facts: TFacts }): string;
  /** The row this renderer adds to the coverage report: what it counts and how many. */
  coverage?(opts: { facts: TFacts }): { name: string; count: number };
}

/** Identity at run time; gives a project module its types. */
export const defineRenderer = <TFacts>(opts: IRenderer<TFacts>): IRenderer<TFacts> => opts;

/** Every name `pattern` captures (group 1) in the `.ts` files under each dir that exists; plain sort. */
const namesPerDir = (opts: {
  root: string;
  dirs: string[];
  pattern: RegExp;
}): { dir: string; names: string[] }[] => {
  const flags = opts.pattern.flags.includes('g') ? opts.pattern.flags : `${opts.pattern.flags}g`;
  const pattern = new RegExp(opts.pattern.source, flags);

  return opts.dirs
    .filter((dir) => existsSync(join(opts.root, dir)))
    .map((dir) => {
      const names = new Set<string>();

      for (const file of SourceScanner.sourceFiles({ dir: join(opts.root, dir) })) {
        for (const match of readFileSync(file, 'utf8').matchAll(pattern)) {
          if (match[1] !== undefined) {
            names.add(match[1]);
          }
        }
      }

      return { dir, names: [...names].sort() };
    });
};

const page: IRenderPage = {
  // No `generated.at` - a timestamp would make every regeneration look like a change.
  header: (opts) =>
    [
      '---',
      'type: Reference',
      `title: ${opts.title}`,
      `description: ${opts.description}`,
      `resource: ${opts.resource}`,
      `tags: [${opts.tags.join(', ')}]`,
      'generated:',
      '  by: process:okf-gen',
      '---',
      '',
      '',
    ].join('\n'),
  note: (opts) =>
    `> Generated from source - do not edit; run \`make okf-gen\`.${opts.seeAlso === '' ? '' : ` ${opts.seeAlso}`}\n\n`,
};

export class RenderContext {
  static create(opts: { options: Record<string, unknown> }): IRenderContext {
    const { root, bundle } = OkfProject.read();

    return {
      root,
      bundle,
      options: opts.options,
      source: {
        listDirs: ({ dir }) => SourceScanner.listDirs({ dir: join(root, dir) }),
        sourceFiles: ({ dir }) => SourceScanner.sourceFiles({ dir: join(root, dir) }),
        exportedClasses: ({ dirs, suffix }) =>
          namesPerDir({
            root,
            dirs,
            pattern: new RegExp(`export\\s+(?:abstract\\s+)?class\\s+(\\w+${suffix})\\b`),
          }).map((entry) => ({ dir: entry.dir, classes: entry.names })),
        exportedNames: ({ dirs, pattern }) => namesPerDir({ root, dirs, pattern }),
      },
      page,
    };
  }
}

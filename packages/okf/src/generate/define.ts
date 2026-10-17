import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readOkfProject } from '../project/index.ts';
import { listDirs, sourceFiles } from '../source/index.ts';

/** Reading the project's source - every `dir` is relative to the project root. */
export interface IRenderSource {
  listDirs(opts: { dir: string }): string[];
  sourceFiles(opts: { dir: string }): string[];
  /** Exported classes named `<anything><suffix>`, abstract ones included, per configured dir. */
  exportedClasses(opts: { dirs: string[]; suffix: string }): { dir: string; classes: string[] }[];
  /** Capture group 1 of `pattern`, matched against each file's text, per configured dir. */
  exportedNames(opts: { dirs: string[]; pattern: RegExp }): { dir: string; names: string[] }[];
}

/** The frame of a generated reference file. */
export interface IRenderPage {
  header(opts: { title: string; description: string; resource: string; tags: string[] }): string;
  note(opts: { seeAlso: string }): string;
}

export interface IRenderContext {
  root: string;
  bundle: string;
  options: Record<string, unknown>;
  source: IRenderSource;
  page: IRenderPage;
}

/** `path` is relative to the bundle. */
export interface IRenderedFile {
  path: string;
  content: string;
}

/**
 * A renderer: `collect` is the one extraction of its facts; `render` (a whole file), `region` (a
 * managed region) and `coverage` (the report's reference row) all read those facts, so a table and
 * its count can never disagree.
 */
export interface IRenderer<TFacts = unknown> {
  id: string;
  collect(opts: { context: IRenderContext }): TFacts;
  render?(opts: { context: IRenderContext; facts: TFacts }): IRenderedFile;
  region?(opts: { context: IRenderContext; facts: TFacts }): string;
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
    .filter(dir => existsSync(join(opts.root, dir)))
    .map(dir => {
      const names = new Set<string>();

      for (const file of sourceFiles({ dir: join(opts.root, dir) })) {
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
  header: opts =>
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
  note: opts => `> Generated from source - do not edit; run \`make okf-gen\`. ${opts.seeAlso}\n\n`,
};

export const createRenderContext = (opts: { options: Record<string, unknown> }): IRenderContext => {
  const { root, bundle } = readOkfProject();

  return {
    root,
    bundle,
    options: opts.options,
    source: {
      listDirs: ({ dir }) => listDirs({ dir: join(root, dir) }),
      sourceFiles: ({ dir }) => sourceFiles({ dir: join(root, dir) }),
      exportedClasses: ({ dirs, suffix }) =>
        namesPerDir({
          root,
          dirs,
          pattern: new RegExp(`export\\s+(?:abstract\\s+)?class\\s+(\\w+${suffix})\\b`),
        }).map(entry => ({ dir: entry.dir, classes: entry.names })),
      exportedNames: ({ dirs, pattern }) => namesPerDir({ root, dirs, pattern }),
    },
    page,
  };
};

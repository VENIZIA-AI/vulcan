import { BaseHelper } from '@/common/helper';
import { isWithinDirectory } from '@/common/paths';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseFrontmatter } from './frontmatter';
import type { ICorpusRoot, IDocument, ISkippedDocument } from './common';

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const isExcluded = (opts: { relativePath: string; exclude: string[] }): boolean =>
  opts.exclude.some(
    prefix => opts.relativePath === prefix || opts.relativePath.startsWith(`${prefix}/`),
  );

const H1_PATTERN = /^#\s+(.+?)\s*$/m;

/** Frontmatter `title`, else the document's first `# ` line, else the path - never blank. */
const titleOf = (opts: { data: Record<string, unknown>; body: string; path: string }): string => {
  if (typeof opts.data.title === 'string' && opts.data.title.length > 0) {
    return opts.data.title;
  }

  const heading = opts.body.match(H1_PATTERN);

  return heading ? heading[1] : opts.path;
};

/** Reads `.md` files under each root into `IDocument`s. Never chunks - see `Chunker` for that. */
export class CorpusLoader extends BaseHelper {
  private static instance?: CorpusLoader;

  /** Documents whose frontmatter failed to parse on the most recent `load` call. */
  skipped: ISkippedDocument[] = [];

  private constructor() {
    super({ scope: CorpusLoader.name });
  }

  static getInstance(): CorpusLoader {
    return (this.instance ??= new CorpusLoader());
  }

  /** `within`: a fetched checkout - a root or a file whose real path leaves it is never read. */
  load(opts: { roots: ICorpusRoot[]; within?: string }): IDocument[] {
    this.skipped = [];

    return opts.roots.flatMap(root => this.loadRoot({ root, within: opts.within }));
  }

  private isOutside(opts: { path: string; within?: string }): boolean {
    if (
      opts.within === undefined ||
      isWithinDirectory({ path: opts.path, directory: opts.within })
    ) {
      return false;
    }

    this.logger.for('load').warn(`skipped a path outside the checkout | path: ${opts.path}`);

    return true;
  }

  private loadRoot(opts: { root: ICorpusRoot; within?: string }): IDocument[] {
    const { root, within } = opts;

    // A manifest declares a directory before anything is written there - a first changelog, say.
    if (
      !existsSync(root.directory) ||
      !statSync(root.directory).isDirectory() ||
      this.isOutside({ path: root.directory, within })
    ) {
      return [];
    }

    const exclude = root.exclude ?? [];
    const relativePaths = [...new Bun.Glob('**/*.md').scanSync({ cwd: root.directory })]
      .filter(relativePath => !isExcluded({ relativePath, exclude }))
      .filter(relativePath => !this.isOutside({ path: join(root.directory, relativePath), within }))
      .sort();

    const documents: IDocument[] = [];

    for (const relativePath of relativePaths) {
      const document = this.loadDocument({ root, relativePath });

      if (document) {
        documents.push(document);
      }
    }

    return documents;
  }

  private loadDocument(opts: { root: ICorpusRoot; relativePath: string }): IDocument | undefined {
    const { root, relativePath } = opts;
    const text = readFileSync(join(root.directory, relativePath), 'utf8');

    try {
      const { data, body } = parseFrontmatter({ text, path: relativePath });

      return {
        corpus: root.corpus,
        path: relativePath,
        title: titleOf({ data, body, path: relativePath }),
        frontmatter: data,
        body,
        // The body is the tail of the text: every line break before it is a frontmatter line.
        bodyLine: text.slice(0, text.length - body.length).split('\n').length,
      };
    } catch (error) {
      const message = messageOf(error);

      this.skipped.push({ corpus: root.corpus, path: relativePath, error: message });
      this.logger
        .for('load')
        .warn(
          `skipped document | corpus: ${root.corpus} | path: ${relativePath} | error: ${message}`,
        );

      return undefined;
    }
  }
}

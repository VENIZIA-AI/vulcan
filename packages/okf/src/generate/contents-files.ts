import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { OkfProject } from '../project/index.ts';
import { SourceScanner } from '../source/index.ts';
import { ContentsList } from './contents.ts';

/** The frontmatter block, LF or CRLF. */
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/** A generator's output owns the whole file, so no list is written into it - said by its own frontmatter. */
const isGenerated = (opts: { text: string }): boolean =>
  /^generated:/m.test(FRONTMATTER.exec(opts.text)?.[1] ?? '');

/** The bundle's log is append-only: a list of every entry would grow with it and churn each commit. */
const LOG_FILE = 'log.md';

/** The files agents read: the bundle's own Markdown, then `okf.contents.files` (AGENTS.md, rules.md); `skip` holds the pages a renderer owns. */
const contentsTargets = (opts: { skip: Set<string> }): string[] => {
  const project = OkfProject.read();
  const bundle = SourceScanner.walkFiles({ dir: project.bundle }).filter(
    (file) =>
      file.endsWith('.md') &&
      !opts.skip.has(file) &&
      file !== join(project.bundle, LOG_FILE) &&
      !isGenerated({ text: readFileSync(file, 'utf8') }),
  );

  return [...bundle.sort(), ...project.contentsFiles.filter((file) => existsSync(file))];
};

const shown = (opts: { file: string }): string => relative(OkfProject.read().root, opts.file);

export class ContentsFiles {
  /** Every agent-read file whose contents list is missing or stale - `check --strict` fails on them. */
  static collectProblems(opts: { skip: Set<string> }): string[] {
    return contentsTargets(opts)
      .filter((file) => {
        const text = readFileSync(file, 'utf8');

        return ContentsList.withContents({ text }) !== text;
      })
      .map(
        (file) =>
          `contents: ${shown({ file })} has no fresh contents list - run \`vulcan x okf gen\``,
      );
  }

  /** Writes every contents list `gen` owes; the files written, from the root. */
  static write(opts: { skip: Set<string> }): string[] {
    return contentsTargets(opts).flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      const next = ContentsList.withContents({ text });

      if (next === text) {
        return [];
      }

      writeFileSync(file, next);

      return [shown({ file })];
    });
  }
}

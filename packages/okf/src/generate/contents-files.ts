import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { relative } from 'node:path';
import { readOkfProject } from '../project/index.ts';
import { walkFiles } from '../source/index.ts';
import { withContents } from './contents.ts';

/** A renderer's output - it owns the whole file, so no list is written into it. */
const GENERATED = /^---\n[\s\S]*?\ngenerated:\n[\s\S]*?\n---\n/;

/** The files agents read: the bundle's own Markdown, then `okf.contents.files` (AGENTS.md, rules.md). */
const contentsTargets = (): string[] => {
  const project = readOkfProject();
  const bundle = walkFiles({ dir: project.bundle }).filter(
    file => file.endsWith('.md') && !GENERATED.test(readFileSync(file, 'utf8')),
  );

  return [...bundle.sort(), ...project.contentsFiles.filter(file => existsSync(file))];
};

const shown = (opts: { file: string }): string => relative(readOkfProject().root, opts.file);

/** Every agent-read file whose contents list is missing or stale - `check --strict` fails on them. */
export const collectContentsProblems = (): string[] =>
  contentsTargets()
    .filter(file => {
      const text = readFileSync(file, 'utf8');

      return withContents({ text }) !== text;
    })
    .map(
      file => `contents: ${shown({ file })} has no fresh contents list - run \`vulcan x okf gen\``,
    );

/** Writes every contents list `gen` owes; the files written, from the root. */
export const writeContents = (): string[] =>
  contentsTargets().flatMap(file => {
    const text = readFileSync(file, 'utf8');
    const next = withContents({ text });

    if (next === text) {
      return [];
    }

    writeFileSync(file, next);

    return [shown({ file })];
  });

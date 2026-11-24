import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..', '..');

/** The `vulcan` of a text: the word, or the constant the code builds a command line from. */
const CALL = String.raw`(?:\bvulcan|\$\{[A-Za-z.]*VULCAN_COMMAND\}|\$\(VULCAN\))`;
/** The retired forms of the command line: a scope and an action replaced each of them (`CommandScopes.RETIRED`). */
const RETIRED = [
  new RegExp(
    String.raw`${CALL} (?:sync|doctor|init|upgrade|clean|add|agents|commit-check|runners|changelog|preset|visualize|layout|x)\b`,
  ),
  new RegExp(String.raw`${CALL} board(?! show| serve)\b`),
  new RegExp(String.raw`${CALL} config --(?:effective|diff)\b`),
  new RegExp(String.raw`${CALL} event step\b`),
  new RegExp(String.raw`${CALL} event add --kind flow\b`),
];
/** What keeps the old words on purpose: the table that maps them, the test that pins it, the frozen history, the wiki theme shared with the other repositories (its hashes are in SHARED.json), binaries and lock files. */
const SKIPPED =
  /^(?:packages\/cli\/src\/commands\/scopes\.ts|packages\/cli\/src\/__tests__\/commands\/scopes\.test\.ts|scripts\/checks\/command-forms\.ts|scripts\/checks\/__tests__\/command-forms\.test\.ts|packages\/cli\/src\/(?:commands\/x\.command|__tests__\/commands\/x\.command\.test)\.ts|docs\/wiki\/content\/changelogs\/|docs\/wiki\/site\/\.vitepress\/theme\/shared\/|bun\.lock|node_modules\/|\.agents\/local\/)|\.(?:png|svg|ico|woff2?|jpg|webp)$/;

export interface ICommandFormHit {
  file: string;
  line: number;
  text: string;
}

export class CommandForms {
  /** Every line of the given texts that still names a retired form. */
  static scan(opts: { files: { file: string; text: string }[] }): ICommandFormHit[] {
    return opts.files
      .filter(({ file }) => !SKIPPED.test(file))
      .flatMap(({ file, text }) =>
        text
          .split('\n')
          .flatMap((line, index) =>
            RETIRED.some((pattern) => pattern.test(line))
              ? [{ file, line: index + 1, text: line.trim().slice(0, 140) }]
              : [],
          ),
      );
  }

  static tracked(): { file: string; text: string }[] {
    const listed = spawnSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' });

    return listed.stdout
      .split('\0')
      .filter((file) => file !== '')
      .flatMap((file) => {
        try {
          return [{ file, text: readFileSync(join(ROOT, file), 'utf8') }];
        } catch {
          return [];
        }
      });
  }
}

if (import.meta.main) {
  const hits = CommandForms.scan({ files: CommandForms.tracked() });

  for (const hit of hits) {
    process.stderr.write(`${hit.file}:${hit.line}: ${hit.text}\n`);
  }

  if (hits.length > 0) {
    process.stderr.write(
      `command-forms: ${hits.length} line(s) name a retired command; the new form is in packages/cli/src/commands/scopes.ts (CommandScopes.RETIRED)\n`,
    );
  }

  process.exit(hits.length === 0 ? 0 : 1);
}

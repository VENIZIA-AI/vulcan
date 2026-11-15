import { realpathSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

/** The command that runs a project's codemods: a bare binary name, then fixed words. */
export class CodemodRunner {
  static readonly DEFAULT: readonly string[] = ['devz', 'codemod'];
  /** A word of the command: letters, digits, `.`, `_`, `-`; never a path, a flag or a shell word. */
  static readonly WORD_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;

  /**
   * The words of `knowledge.codemodCommand` from the manifest; empty when the key is absent. A word that is not
   * allowed throws: dropping it would run another command than the one the project wrote.
   */
  static wordsOf(opts: { value: unknown; label: string }): string[] {
    if (opts.value === undefined) {
      return [];
    }

    if (!Array.isArray(opts.value) || opts.value.length === 0) {
      throw new Error(
        `atlas: ${opts.label}: knowledge.codemodCommand must be a non-empty list of words`,
      );
    }

    return opts.value.map((word: unknown) => {
      if (typeof word !== 'string' || !CodemodRunner.WORD_PATTERN.test(word)) {
        throw new Error(
          `atlas: ${opts.label}: knowledge.codemodCommand word ${JSON.stringify(word)} is not allowed: a word is letters, digits, '.', '_' and '-', and starts with a letter or digit`,
        );
      }

      return word;
    });
  }

  /**
   * Why `binary` (a `node_modules/.bin/<name>`) may not run as a source's codemod runner, or `undefined` when it may: its
   * real path, every link resolved, must lie inside the installed directory of one of `packages` - the packages the source
   * serves. A runner is code the app runs with its own rights: a bin of another package (`rimraf`), or a link that leaves
   * the package, is never one, whatever a manifest or an index says.
   */
  static refusalOf(opts: {
    binary: string;
    nodeModules: string;
    packages: readonly string[];
  }): string | undefined {
    let real: string;

    try {
      real = realpathSync(opts.binary);
    } catch {
      return `${opts.binary} does not resolve to a file`;
    }

    for (const name of opts.packages) {
      let installed: string;

      try {
        installed = realpathSync(join(opts.nodeModules, name));
      } catch {
        continue;
      }

      const from = relative(installed, real);

      if (from !== '' && !isAbsolute(from) && from.split(sep)[0] !== '..') {
        return undefined;
      }
    }

    return `${opts.binary} resolves to ${real}, which is not inside an installed package of the source that serves it (${opts.packages.length} declared); it is not run`;
  }

  /** What a message names as the listing command, for example `devz codemod --list`. */
  static listLabel(opts: { command?: readonly string[] }): string {
    return [...(opts.command ?? CodemodRunner.DEFAULT), '--list'].join(' ');
  }
}

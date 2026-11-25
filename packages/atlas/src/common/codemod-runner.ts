import { realpathSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

/** An npm package name, lower case: the same shape `ProjectConfig` validates a manifest's package names with. */
const NPM_NAME_PATTERN = /^(?:@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*$/;

/** The command that runs a project's codemods: a bare binary name, then fixed words. */
export class CodemodRunner {
  static readonly DEFAULT: readonly string[] = ['devz', 'codemod'];
  /** A word of the command: letters, digits, `.`, `_`, `-`; never a path, a flag or a shell word. */
  static readonly WORD_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;
  /**
   * The package whose bin is the running tool itself. Only a check of the project's own runner adds it to the packages
   * (`ChangelogCheck`): `apply` runs the command of a remote source, so it never trusts it unless the source declares it.
   */
  static readonly TOOL_PACKAGE = '@venizia/vulcan';

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

  /** Where `directory` installs the bin `name`: `<directory>/node_modules/.bin/<name>`. */
  static binaryIn(opts: { directory: string; name: string }): string {
    return join(opts.directory, 'node_modules', '.bin', opts.name);
  }

  /**
   * Why the bin `name` installed under `directory` may not run as a source's codemod runner, or `undefined` when it may: its
   * real path, every link resolved, must lie inside the installed directory of one of `packages` - the packages the source
   * serves; a `node_modules/<name>` link into a Bun isolated store (`.bun/<name>@<v>/node_modules/<name>`) is resolved like any link. A runner is code the app runs with its own rights: a bin of another package (`rimraf`), or a link that leaves
   * the package, is never one, whatever a manifest or an index says. A name that is not an npm package name is never an
   * allowed package: `..` or an empty name would name the app itself.
   */
  static refusalOf(opts: {
    directory: string;
    name: string;
    packages: readonly string[];
  }): string | undefined {
    const binary = CodemodRunner.binaryIn(opts);
    const nodeModules = join(opts.directory, 'node_modules');
    let real: string;

    try {
      real = realpathSync(binary);
    } catch {
      return `${binary} does not resolve to a file`;
    }

    for (const name of opts.packages.filter((entry) => NPM_NAME_PATTERN.test(entry))) {
      let installed: string;

      try {
        installed = realpathSync(join(nodeModules, name));
      } catch {
        continue;
      }

      const from = relative(installed, real);

      if (from !== '' && !isAbsolute(from) && from.split(sep)[0] !== '..') {
        return undefined;
      }
    }

    return `${binary} resolves to ${real}, which is not inside an installed package of the source that serves it (${opts.packages.length} declared); it is not run`;
  }

  /** What a message names as the listing command, for example `devz codemod --list`. */
  static listLabel(opts: { command?: readonly string[] }): string {
    return [...(opts.command ?? CodemodRunner.DEFAULT), '--list'].join(' ');
  }
}

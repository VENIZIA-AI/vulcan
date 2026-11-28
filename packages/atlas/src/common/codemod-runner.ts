import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { StderrLogger, VulcanError } from '@venizia/vulcan-okf';
import { WireValue } from './wire';

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
      throw VulcanError.of({
        message: `atlas: ${opts.label}: knowledge.codemodCommand must be a non-empty list of words`,
      });
    }

    return opts.value.map((word: unknown) => {
      if (typeof word !== 'string' || !CodemodRunner.WORD_PATTERN.test(word)) {
        throw VulcanError.of({
          message: `atlas: ${opts.label}: knowledge.codemodCommand word ${JSON.stringify(word)} is not allowed: a word is letters, digits, '.', '_' and '-', and starts with a letter or digit`,
        });
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

      if (CodemodRunner.isInside({ directory: installed, path: real })) {
        return undefined;
      }
    }

    return `${binary} resolves to ${real}, which is not inside an installed package of the source that serves it (${opts.packages.length} declared); it is not run`;
  }

  /**
   * The file the bin `name` is in the project's own packages: a workspace package is not linked into the root
   * `node_modules/.bin`. Only the `bin` of a declared package whose `package.json` has its name counts, and its real path,
   * every link resolved, must lie inside that package folder, itself inside the project.
   */
  static workspaceBinOf(opts: {
    root: string;
    name: string;
    packages: readonly { name: string; path: string; retired: boolean }[];
  }): { file: string } | { reason: string } {
    const missing = `${CodemodRunner.binaryIn({ directory: opts.root, name: opts.name })} does not resolve to a file`;

    for (const entry of opts.packages.filter((item) => !item.retired)) {
      const directory = resolve(opts.root, entry.path);
      const target = CodemodRunner.declaredBinOf({
        directory,
        package: entry.name,
        name: opts.name,
      });

      if (target === undefined) {
        continue;
      }

      const declared = `${join(entry.path, 'package.json')} declares the bin '${opts.name}' as ${target}`;
      let real: { root: string; directory: string; file: string };

      try {
        real = {
          root: realpathSync(opts.root),
          directory: realpathSync(directory),
          file: realpathSync(resolve(directory, target)),
        };
      } catch {
        return { reason: `${declared}, which does not resolve to a file: build the package first` };
      }

      if (
        !CodemodRunner.isInside({ directory: real.root, path: real.directory }) ||
        !CodemodRunner.isInside({ directory: real.directory, path: real.file })
      ) {
        return {
          reason: `${declared}, which is not inside the package folder of the project; it is not run`,
        };
      }

      return { file: real.file };
    }

    return {
      reason: `${missing}, and no package of the project declares a bin '${opts.name}'`,
    };
  }

  /** What `<directory>/package.json` gives for the bin `name`, when it is the package `package`. */
  private static declaredBinOf(opts: {
    directory: string;
    package: string;
    name: string;
  }): string | undefined {
    let data: unknown;

    try {
      data = JSON.parse(readFileSync(join(opts.directory, 'package.json'), 'utf8'));
    } catch (error) {
      StderrLogger.get('CodemodRunner.declaredBinOf').debug(
        'no readable package.json | error: %s',
        error,
      );

      return undefined;
    }

    const manifest = WireValue.recordOf({ value: data });

    if (manifest.name !== opts.package) {
      return undefined;
    }

    // A `bin` written as one string is the bin named like the package, without its scope.
    if (typeof manifest.bin === 'string') {
      return opts.package.split('/').pop() === opts.name ? manifest.bin : undefined;
    }

    const bins = WireValue.recordOf({ value: manifest.bin });

    return Object.hasOwn(bins, opts.name)
      ? WireValue.stringOf({ value: bins[opts.name] })
      : undefined;
  }

  private static isInside(opts: { directory: string; path: string }): boolean {
    const from = relative(opts.directory, opts.path);

    return from !== '' && !isAbsolute(from) && from.split(sep)[0] !== '..';
  }

  /** What a message names as the listing command, for example `devz codemod --list`. */
  static listLabel(opts: { command?: readonly string[] }): string {
    return [...(opts.command ?? CodemodRunner.DEFAULT), '--list'].join(' ');
  }
}

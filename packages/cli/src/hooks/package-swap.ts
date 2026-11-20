import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { GuardDecisions } from './common/index.ts';
import type { IGitHit } from './common/index.ts';
import { PackageRunners } from './package-runners.ts';
import { ShellFolders } from './shell-folders.ts';
import { ShellParser } from './shell.ts';

const NAME = '@venizia/vulcan';
const RULE = 'V-S-05';
const MANAGERS = new Set(['bun', 'npm', 'pnpm', 'yarn']);
const INSTALL_VERBS = new Set([
  'add',
  'a',
  'install',
  'i',
  'link',
  'ln',
  'update',
  'up',
  'upgrade',
]);
const PATCH_VERBS = new Set(['patch', 'patch-commit']);
/** A word before which a verb-like word is a script name or an argument, not the verb. */
const NOT_A_VERB = new Set(['run', 'exec', 'x', 'dlx', 'create', 'init', 'pm', 'pkg']);
/** The flags and variables that decide where an install takes its packages from. */
const SOURCE_FLAGS = /^--(?:registry|cache-dir|config)(?:=|$)/;
const SOURCE_VARIABLES = /^(?:BUN_CONFIG_REGISTRY|npm_config_registry|NPM_CONFIG_REGISTRY)=/;
/** The flags that move the folder a package manager runs in, and the ones whose value is not a package. */
const FOLDER_FLAGS = /^(?:--cwd|--prefix|--dir|-C)(?:=|$)/;
const VALUE_FLAGS =
  /^(?:--(?:filter|tag|lockfile|loglevel|workspace|omit|include|save-prefix)|-F)(?:=|$)/;
/** A spec a registry serves: a version, a range or a tag. */
const REGISTRY_SPEC = /^(?:[~^<>=v*xX0-9. |-]+(?:-[\w.]+)?|[A-Za-z][\w.-]*)$/;
/** A word that names a folder, whatever else a package manager takes it for. */
const FOLDER_WORD = /^(?:\.{0,2}\/|~|file:|link:|workspace:)|^\.{1,2}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** What a package manager does to the guard package that the owner's CLI runs from `node_modules`: swap it for another. */
export class PackageSwap {
  /** Whether a spec is one a registry serves (`^0.5.0`, `next`), not a path, a link, a URL, a git ref or an alias. */
  private static isRegistrySpec(opts: { spec: string }): boolean {
    return !/[:/\\]/.test(opts.spec) && REGISTRY_SPEC.test(opts.spec);
  }

  /** The `name` of the package.json in a folder, or `undefined` when there is none to read. */
  private static nameOfFolder(opts: { folder: string }): string | undefined {
    try {
      const parsed: unknown = JSON.parse(readFileSync(join(opts.folder, 'package.json'), 'utf8'));

      return isRecord(parsed) && typeof parsed['name'] === 'string' ? parsed['name'] : undefined;
    } catch {
      return undefined;
    }
  }

  /** Whether a path is the installed package, its store copy, or inside either (by name, and by where the project's link leads). */
  private static isInstalledPackage(opts: { path: string; base: string }): boolean {
    const full = resolve(opts.base, opts.path);

    if (/node_modules\/@venizia\/vulcan(?:\/|$)|@venizia\+vulcan@/.test(full)) {
      return true;
    }

    try {
      const real = realpathSync(full);
      let folder = opts.base;

      for (;;) {
        const link = join(folder, 'node_modules', '@venizia', 'vulcan');

        if (existsSync(link)) {
          const own = realpathSync(link);

          if (real === own || real.startsWith(`${own}/`)) {
            return true;
          }
        }

        const parent = dirname(folder);

        if (parent === folder) {
          return false;
        }

        folder = parent;
      }
    } catch {
      return false;
    }
  }

  private static hit(opts: { message: string; fix: string }): IGitHit {
    return { rule: RULE, decision: GuardDecisions.DENY, message: opts.message, fix: opts.fix };
  }

  /**
   * What a command line does to the guard package through bun, npm, pnpm or yarn: an add, link or patch that takes it from anywhere but a
   * registry version, a folder that is it, and a registry or cache set on the line. The folder a command runs in is read as it is moved.
   */
  static inspectCommand(opts: { command: string; cwd: string }): IGitHit[] {
    const parsed = ShellParser.parseChecked({ command: opts.command });
    const folders = ShellFolders.foldersOf({
      commands: parsed.commands,
      cwd: opts.cwd,
      pwd: opts.cwd,
      home: process.env.HOME ?? '',
      env: process.env,
    });
    const hits: IGitHit[] = [];

    for (const [index, command] of parsed.commands.entries()) {
      const program = ShellParser.programOf({ command });

      const name = ShellParser.basenameOf({ word: program.name });

      hits.push(...PackageSwap.inspectSync({ name, args: program.args }));

      if (MANAGERS.has(name)) {
        const folder = folders[index];

        hits.push(
          ...PackageSwap.inspectManager({
            args: program.args,
            assignments: command.assignments,
            base: folder?.base ?? opts.cwd,
            isKnown: folder?.isKnown ?? true,
          }),
        );
      }
    }

    return hits;
  }

  /**
   * `vulcan sync` (also through `bun node_modules/.bin/vulcan` and `make vulcan-sync`) rewrites the hook bundle, the manifest and the settings the
   * guards run from, with the code of the package in `node_modules`: it is the owner's act, asked here and denied where every ask is.
   */
  private static inspectSync(opts: { name: string; args: string[] }): IGitHit[] {
    // The words of a program that only prints or searches are text, not a command.
    if (['echo', 'printf', 'grep', 'rg', 'cat', 'man', 'git', 'gh'].includes(opts.name)) {
      return [];
    }

    const isSync =
      (opts.name === 'vulcan' && opts.args.find((word) => !word.startsWith('-')) === 'sync') ||
      (opts.name === 'make' && opts.args.includes('vulcan-sync')) ||
      opts.args.some(
        (word, index) => /(?:^|\/)vulcan$/.test(word) && opts.args[index + 1] === 'sync',
      );

    return isSync
      ? [
          {
            rule: RULE,
            decision: GuardDecisions.ASK,
            message:
              'vulcan sync rewrites the hook bundle, the manifest and the settings the guards run from, using the package in node_modules: the owner runs it, outside the agent session',
          },
        ]
      : [];
  }

  /** What one package manager command does to the guard package. */
  private static inspectManager(opts: {
    args: string[];
    assignments: string[];
    base: string;
    isKnown: boolean;
  }): IGitHit[] {
    const hits: IGitHit[] = [];
    // A flag that moves the folder moves where a relative path is read from, wherever it stands on the line.
    const moved = opts.args.findIndex((word) => FOLDER_FLAGS.test(word));
    const movedTo =
      moved === -1 ? undefined : (opts.args[moved]?.split('=')[1] ?? opts.args[moved + 1]);
    // The words without the values of the flags that take one (`--filter x`), so a value is never read as the verb or a package.
    const args: string[] = [];

    for (let index = 0; index < opts.args.length; index += 1) {
      const word = opts.args[index] ?? '';

      args.push(word);

      if (
        word.startsWith('-') &&
        !word.includes('=') &&
        (FOLDER_FLAGS.test(word) || VALUE_FLAGS.test(word) || SOURCE_FLAGS.test(word)) &&
        !PackageRunners.SWITCHES.has(word)
      ) {
        index += 1;
      }
    }

    // The first word that is a verb: a flag before it, known or not, cannot hide it; a `run` or `exec` before it makes it an argument.
    const stop = args.findIndex((word) => NOT_A_VERB.has(word));
    const verbAt = args.findIndex(
      (word, index) =>
        (stop === -1 || index < stop) && (INSTALL_VERBS.has(word) || PATCH_VERBS.has(word)),
    );

    if (verbAt === -1) {
      return hits;
    }

    const verb = args[verbAt] ?? '';
    const base = movedTo === undefined ? opts.base : resolve(opts.base, movedTo);

    if (
      args.some((word) => SOURCE_FLAGS.test(word)) ||
      opts.assignments.some((word) => SOURCE_VARIABLES.test(word))
    ) {
      hits.push(
        PackageSwap.hit({
          message: `${verb} sets the registry, the cache or the config of an install on the command line, which decides where the guard package comes from`,
          fix: 'leave the registry to the project config, which the owner edits',
        }),
      );
    }

    const words: string[] = [];

    for (let index = verbAt + 1; index < args.length; index += 1) {
      const word = args[index] ?? '';

      if (!word.startsWith('-')) {
        words.push(word);
      } else if (word === '--commit') {
        // The value of `bun patch --commit <path>` is the path to judge.
        words.push(args[index + 1] ?? '');
        index += 1;
      }
    }

    for (const word of words) {
      hits.push(...PackageSwap.inspectWord({ verb, word, base, isKnown: opts.isKnown }));
    }

    return hits;
  }

  /** One word a package manager is given: the guard package by name, a folder, or the installed copy. */
  private static inspectWord(opts: {
    verb: string;
    word: string;
    base: string;
    isKnown: boolean;
  }): IGitHit[] {
    const { verb, word, base } = opts;
    const isPatch = PATCH_VERBS.has(verb);

    if (isPatch && PackageSwap.isInstalledPackage({ path: word, base })) {
      return [
        PackageSwap.hit({
          message: `${verb} ${word} changes the installed guard package`,
          fix: 'the guard package is changed by the owner, through the registry',
        }),
      ];
    }

    const at = /^(@[\w.-]+\/[\w.-]+|[\w.-]+)@(.+)$/.exec(word);

    // An archive is a package whose name this check cannot read: left to the owner's review, as any other source it cannot name.
    if (at === null && /\.(?:tgz|tar|tar\.gz)$/.test(word)) {
      return [];
    }

    if (at === null && FOLDER_WORD.test(word)) {
      const name = PackageSwap.nameOfFolder({
        folder: resolve(base, word.replace(/^(?:file:|link:|workspace:)/, '')),
      });

      return !opts.isKnown || name === undefined || name === NAME
        ? [
            PackageSwap.hit({
              message: `${verb} ${word} takes a folder that is, or may be, the guard package (${name ?? 'no package.json to read, or the folder is not known'})`,
              fix: 'install from the registry, or leave it to the owner',
            }),
          ]
        : [];
    }

    const name = at?.[1] ?? word;
    const spec = at?.[2];

    if (name !== NAME) {
      return [];
    }

    return isPatch ||
      verb === 'link' ||
      verb === 'ln' ||
      (spec !== undefined && !PackageSwap.isRegistrySpec({ spec }))
      ? [
          PackageSwap.hit({
            message: `${verb} ${word} replaces the guard package, or takes it from somewhere other than the registry`,
            fix: 'add a registry version (bun add @venizia/vulcan@^<version>), or leave it to the owner',
          }),
        ]
      : [];
  }
}

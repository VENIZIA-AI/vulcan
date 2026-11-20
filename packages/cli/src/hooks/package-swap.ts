import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { GuardDecisions } from './common/index.ts';
import type { IGitHit } from './common/index.ts';
import { PackageRunners } from './package-runners.ts';
import { ShellParser } from './shell.ts';
import type { ISimpleCommand } from './shell.ts';
import { ShellWrites } from './shell-writes.ts';

/** One edit of a file tool: the text it replaces and the text it puts. */
export interface IFileEdit {
  oldString: string;
  newString: string;
}

const NAME = '@venizia/vulcan';
const RULE = 'V-S-05';

/** The files that decide where an install takes the guard package from, and what pins it. */
const CONFIG_FILES = new Set(['bunfig.toml', '.npmrc', '.yarnrc.yml', 'pnpm-workspace.yaml']);
const LOCK_FILES = new Set(['bun.lock', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml']);
/** A line of a config file that moves the source, the cache or the patches of a package. */
const CONFIG_LINE = /@venizia|registry|scope|cache|link|overrid|patch|preload/i;
const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
];
const NESTED_FIELDS = ['overrides', 'resolutions', 'patchedDependencies', 'pnpm'];
const INSTALL_VERBS = new Set([
  'add',
  'a',
  'install',
  'i',
  'link',
  'ln',
  'patch',
  'patch-commit',
  'upgrade',
  'up',
  'update',
]);
/** The flags and variables that decide where an install takes its packages from. */
const SOURCE_FLAGS = /^--(?:registry|cache-dir|config)(?:=|$)/;
const SOURCE_VARIABLES = /^(?:BUN_CONFIG_REGISTRY|npm_config_registry|NPM_CONFIG_REGISTRY)=/;
/** What `sed -i` or `perl -i` must not put into one of those files. */
const SCRIPT_WORDS =
  /@venizia|workspaces|overrides|resolutions|patchedDependencies|registry|scopes/;
/** A spec a registry serves: a version, a range or a tag. */
const REGISTRY_SPEC = /^(?:[~^<>=v*xX0-9. |-]+(?:-[\w.]+)?|[A-Za-z][\w.-]*)$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** What a package manager or a project file may do to the installed guard package: swap it for another. */
export class PackageSwap {
  /** Whether a spec is one a registry serves (`^0.5.0`, `next`), not a path, a link, a URL, a git ref or an alias. */
  private static isRegistrySpec(opts: { spec: string }): boolean {
    return !/[:/\\]/.test(opts.spec) && REGISTRY_SPEC.test(opts.spec);
  }

  /** The name and the spec of a word given to an install (`@scope/name@1`, `name@file:x`, `./dir`), or the way it names no package. */
  private static specOf(opts: {
    word: string;
  }): { name: string; spec: string | undefined } | { kind: 'path' | 'archive' | 'remote' } {
    const { word } = opts;

    // `name@spec` names the package, whatever the spec is; `git@host:path` is a repository.
    const named = /^(@[\w.-]+\/[\w.-]+|[\w.-]+)@(.+)$/.exec(word);

    if (named !== null && !word.startsWith('git@')) {
      return { name: named[1] ?? word, spec: named[2] };
    }

    if (/\.(?:tgz|tar|tar\.gz)$/.test(word)) {
      return { kind: 'archive' };
    }

    if (/^(?:\.{0,2}\/|~|file:|link:|workspace:)/.test(word) || word === '.' || word === '..') {
      return { kind: 'path' };
    }

    if (
      /^(?:git\+|git@|github:|gitlab:|bitbucket:|https?:)|^[\w.-]+\/[\w.-]+(?:#.*)?$/.test(word)
    ) {
      return { kind: 'remote' };
    }

    const at = word.indexOf('@', 1);

    return at === -1
      ? { name: word, spec: undefined }
      : { name: word.slice(0, at), spec: word.slice(at + 1) };
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

  /** Whether a path is the installed package, its store copy, or inside either (by name, and by where the link of the project leads). */
  private static isInstalledPackage(opts: { path: string; cwd: string }): boolean {
    const full = resolve(opts.cwd, opts.path);

    if (/node_modules\/@venizia\/vulcan(?:\/|$)|@venizia\+vulcan@/.test(full)) {
      return true;
    }

    try {
      const real = realpathSync(full);
      let folder = opts.cwd;

      for (;;) {
        const link = join(folder, 'node_modules', '@venizia', 'vulcan');

        if (
          existsSync(link) &&
          (real === realpathSync(link) || real.startsWith(`${realpathSync(link)}/`))
        ) {
          return true;
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

  private static hit(opts: {
    decision: IGitHit['decision'];
    message: string;
    fix?: string;
  }): IGitHit {
    return {
      rule: RULE,
      decision: opts.decision,
      message: opts.message,
      fix: opts.fix,
    };
  }

  /**
   * What a command line does to the guard package through a package manager: an add, install, link or patch that names it with a
   * source that is not a registry version, a folder, an archive or a repository that may hold it, a registry or cache set on the
   * line, a script that edits the project files that pin it, and a whole-file write of one of them.
   */
  static inspectCommand(opts: { command: string; cwd: string }): IGitHit[] {
    const hits: IGitHit[] = [];
    const parsed = ShellParser.parseChecked({ command: opts.command });

    for (const command of parsed.commands) {
      const program = ShellParser.programOf({ command });
      const name = ShellParser.basenameOf({ word: program.name });

      if (['bun', 'npm', 'pnpm', 'yarn'].includes(name)) {
        hits.push(...PackageSwap.inspectManager({ command, args: program.args, cwd: opts.cwd }));
      }

      if (name === 'sed' || name === 'perl') {
        const touched = program.args.filter((word) => PackageSwap.isGuardedFile({ path: word }));
        const isInPlace = program.args.some(
          (word) =>
            word === '--in-place' || word.startsWith('--in-place=') || /^-[a-zA-Z]*i/.test(word),
        );

        if (
          isInPlace &&
          touched.length > 0 &&
          program.args.some((word) => SCRIPT_WORDS.test(word))
        ) {
          hits.push(
            PackageSwap.hit({
              decision: GuardDecisions.DENY,
              message: `${name} edits ${touched.join(', ')} in a way that can change where the guard package comes from`,
              fix: 'leave the dependency, workspace, override and registry entries to the owner, or add a registry version of a package with bun add',
            }),
          );
        }
      }

      for (const target of ShellWrites.targetsOf({ command, base: opts.cwd, tmp: '' })) {
        const isWhole =
          PackageSwap.isGuardedFile({ path: target.word }) &&
          target.isLinkRead !== true &&
          target.isLinkSource !== true &&
          target.isEdit !== true &&
          target.isIntoFolder !== true &&
          (target.isProtectedOnly !== true ||
            (target.isNameInFolder === true &&
              PackageSwap.isFolder({ path: dirname(target.word), cwd: opts.cwd })));

        if (isWhole) {
          hits.push(
            PackageSwap.hit({
              decision: GuardDecisions.ASK,
              message: `${target.message}: the whole file is written, so what it pins cannot be checked`,
            }),
          );
        }
      }
    }

    return hits;
  }

  /** Whether a word names a folder that is there, so a file copied to it is written inside. */
  private static isFolder(opts: { path: string; cwd: string }): boolean {
    try {
      return statSync(resolve(opts.cwd, opts.path)).isDirectory();
    } catch {
      return false;
    }
  }

  private static isGuardedFile(opts: { path: string }): boolean {
    const file = basename(opts.path);

    return file === 'package.json' || CONFIG_FILES.has(file) || LOCK_FILES.has(file);
  }

  /** What one `bun`, `npm`, `pnpm` or `yarn` command does to the guard package. */
  private static inspectManager(opts: {
    command: ISimpleCommand;
    args: string[];
    cwd: string;
  }): IGitHit[] {
    const { args, cwd } = opts;
    const hits: IGitHit[] = [];
    // The verb is the first word that is not a flag or the value of one the table does not know to be a switch.
    let verbAt = -1;

    for (let index = 0; index < args.length; index += 1) {
      const word = args[index] ?? '';

      if (!word.startsWith('-')) {
        verbAt = index;
        break;
      }

      if (!word.includes('=') && !PackageRunners.SWITCHES.has(word)) {
        index += 1;
      }
    }

    const verb = verbAt === -1 ? '' : (args[verbAt] ?? '');
    const rest = verbAt === -1 ? [] : args.slice(verbAt + 1);

    // `npm pkg set`, `pnpm pkg set`, `bun pm pkg set` write an entry of package.json from the command line.
    if (verb === 'pkg' || (verb === 'pm' && rest[0] === 'pkg')) {
      const words = rest.filter((word) => !word.startsWith('-'));

      if (
        words.some(
          (word) =>
            SCRIPT_WORDS.test(word) || (/^dependencies\./.test(word) && word.includes(NAME)),
        )
      ) {
        hits.push(
          PackageSwap.hit({
            decision: GuardDecisions.DENY,
            message: `${verb} writes an entry of package.json that can change where the guard package comes from`,
            fix: 'leave it to the owner',
          }),
        );
      }

      return hits;
    }

    if (!INSTALL_VERBS.has(verb)) {
      return hits;
    }

    const isSource =
      rest.some((word) => SOURCE_FLAGS.test(word)) ||
      opts.command.assignments.some((word) => SOURCE_VARIABLES.test(word));

    if (isSource) {
      hits.push(
        PackageSwap.hit({
          decision: GuardDecisions.DENY,
          message: `${verb} sets the registry, the cache or the config of an install on the command line, which decides where the guard package comes from`,
          fix: 'leave the registry to the project config, which the owner edits',
        }),
      );
    }

    const words: string[] = [];

    for (let index = 0; index < rest.length; index += 1) {
      const word = rest[index] ?? '';

      if (!word.startsWith('-')) {
        words.push(word);
      } else if (
        !word.includes('=') &&
        !PackageRunners.SWITCHES.has(word) &&
        /^--(?:commit|registry|cache-dir|config|cwd|filter|prefix|tag)$/.test(word)
      ) {
        // The value of `bun patch --commit <path>` is the path to judge; the others are not packages.
        if (word === '--commit' && rest[index + 1] !== undefined) {
          words.push(rest[index + 1] ?? '');
        }

        index += 1;
      }
    }

    for (const word of words) {
      // `bun patch node_modules/@venizia/vulcan`: a path to the installed package is a path whatever it starts with.
      if (
        (verb === 'patch' || verb === 'patch-commit') &&
        PackageSwap.isInstalledPackage({ path: word, cwd })
      ) {
        hits.push(
          PackageSwap.hit({
            decision: GuardDecisions.DENY,
            message: `${verb} ${word} changes the installed guard package`,
            fix: 'the guard package is changed by the owner, through the registry',
          }),
        );

        continue;
      }

      const named = PackageSwap.specOf({ word });

      if ('kind' in named) {
        hits.push(...PackageSwap.inspectNameless({ verb, word, kind: named.kind, cwd }));
      } else if (named.name === NAME) {
        if (verb === 'patch' || verb === 'patch-commit' || verb === 'link' || verb === 'ln') {
          hits.push(
            PackageSwap.hit({
              decision: GuardDecisions.DENY,
              message: `${verb} ${word} replaces or changes the guard package`,
              fix: 'the guard package is changed by the owner, through the registry',
            }),
          );
        } else if (named.spec !== undefined && !PackageSwap.isRegistrySpec({ spec: named.spec })) {
          hits.push(
            PackageSwap.hit({
              decision: GuardDecisions.DENY,
              message: `${verb} ${word} takes the guard package from somewhere other than the registry`,
              fix: 'add a registry version, such as bun add @venizia/vulcan@^<version>, or leave it to the owner',
            }),
          );
        }
      }
    }

    return hits;
  }

  /** A word that names a folder, an archive or a repository: what package it holds is read for a folder and unknown for the others. */
  private static inspectNameless(opts: {
    verb: string;
    word: string;
    kind: 'path' | 'archive' | 'remote';
    cwd: string;
  }): IGitHit[] {
    const { verb, word, kind, cwd } = opts;

    if (kind === 'path') {
      const path = word.replace(/^(?:file:|link:|workspace:)/, '');

      if (verb === 'patch' || verb === 'patch-commit') {
        return PackageSwap.isInstalledPackage({ path, cwd }) ||
          PackageSwap.nameOfFolder({ folder: resolve(cwd, path) }) === NAME
          ? [
              PackageSwap.hit({
                decision: GuardDecisions.DENY,
                message: `${verb} ${word} changes the installed guard package`,
                fix: 'the guard package is changed by the owner, through the registry',
              }),
            ]
          : [];
      }

      const name = PackageSwap.nameOfFolder({
        folder: isAbsolute(path) ? path : resolve(cwd, path),
      });

      return name === undefined || name === NAME
        ? [
            PackageSwap.hit({
              decision: GuardDecisions.DENY,
              message: `${verb} ${word} installs a folder that is, or may be, the guard package (${name ?? 'no package.json to read'})`,
              fix: 'install from the registry, or leave it to the owner',
            }),
          ]
        : [];
    }

    return [
      PackageSwap.hit({
        decision: GuardDecisions.ASK,
        message: `${verb} ${word} installs ${kind === 'archive' ? 'an archive' : 'a repository or a URL'} whose package name this check cannot tell, and it may be the guard package`,
      }),
    ];
  }

  /**
   * What a write by a file tool does to a file that decides where the guard package comes from: the dependency spec of the
   * package, its overrides, resolutions and patches, the workspaces that were added, the lines of a config file that move a
   * source, and the lines of a lockfile that name the package. Judged by what changes, so an ordinary edit of the same file passes.
   */
  static inspectFile(opts: {
    filePath: string;
    content: string | undefined;
    edits: IFileEdit[];
  }): string[] {
    const file = basename(opts.filePath);

    if (!PackageSwap.isGuardedFile({ path: opts.filePath })) {
      return [];
    }

    let before = '';

    try {
      before = existsSync(opts.filePath) ? readFileSync(opts.filePath, 'utf8') : '';
    } catch {
      before = '';
    }

    let after = opts.content ?? before;

    for (const edit of opts.edits) {
      after = after.replace(edit.oldString, () => edit.newString);
    }

    if (after === before) {
      return [];
    }

    if (file === 'package.json') {
      return PackageSwap.comparePackageJson({ before, after, folder: dirname(opts.filePath) });
    }

    const lines = (text: string, pattern: RegExp): string[] =>
      text
        .split('\n')
        .filter((line) => pattern.test(line))
        .map((line) => line.trim())
        .sort();
    const pattern = LOCK_FILES.has(file)
      ? /@venizia\/vulcan/
      : CONFIG_FILES.has(file)
        ? CONFIG_LINE
        : /$^/;

    return JSON.stringify(lines(before, pattern)) === JSON.stringify(lines(after, pattern))
      ? []
      : [`${file}: a line that says where the guard package comes from or what pins it changes`];
  }

  private static comparePackageJson(opts: {
    before: string;
    after: string;
    folder: string;
  }): string[] {
    const parse = (text: string): Record<string, unknown> | undefined => {
      try {
        const parsed: unknown = JSON.parse(text);

        return isRecord(parsed) ? parsed : undefined;
      } catch {
        return undefined;
      }
    };
    const after = parse(opts.after);
    const before = opts.before === '' ? {} : parse(opts.before);

    if (after === undefined || before === undefined) {
      // Not JSON: the text is searched for the name next to a source that is not the registry.
      return opts.after
        .split('\n')
        .some(
          (line) =>
            line.includes(NAME) && /file:|link:|workspace:|git\+|github:|https?:|npm:/.test(line),
        )
        ? [
            'package.json: it does not parse, and a line names the guard package with a source other than the registry',
          ]
        : [];
    }

    const reasons: string[] = [];

    for (const field of DEPENDENCY_FIELDS) {
      const spec = (value: Record<string, unknown>): unknown =>
        isRecord(value[field]) ? value[field][NAME] : undefined;

      if (spec(before) !== spec(after)) {
        const next = spec(after);

        if (typeof next === 'string' && !PackageSwap.isRegistrySpec({ spec: next })) {
          reasons.push(
            `package.json: ${field} takes the guard package from \`${next}\`, not from the registry`,
          );
        }
      }
    }

    const nested = (value: Record<string, unknown>): string[] =>
      NESTED_FIELDS.flatMap((field) =>
        JSON.stringify(value[field] ?? null).includes(NAME)
          ? [`${field}=${JSON.stringify(value[field])}`]
          : [],
      );

    if (JSON.stringify(nested(before)) !== JSON.stringify(nested(after))) {
      reasons.push(
        'package.json: an override, a resolution or a patch of the guard package changes',
      );
    }

    const listed = (value: Record<string, unknown>): string[] => {
      const workspaces = value['workspaces'];
      const list = Array.isArray(workspaces)
        ? workspaces
        : isRecord(workspaces) && Array.isArray(workspaces['packages'])
          ? workspaces['packages']
          : [];

      return list.filter((entry): entry is string => typeof entry === 'string');
    };
    const known = new Set(listed(before));

    for (const entry of listed(after).filter((item) => !known.has(item))) {
      try {
        for (const found of new Bun.Glob(`${entry.replace(/\/$/, '')}/package.json`).scanSync({
          cwd: opts.folder,
        })) {
          if (PackageSwap.nameOfFolder({ folder: join(opts.folder, dirname(found)) }) === NAME) {
            reasons.push(
              `package.json: the workspace \`${entry}\` holds a package named ${NAME}, which would replace the installed one`,
            );
          }
        }
      } catch {
        // A glob the system cannot scan lists nothing.
      }
    }

    return reasons;
  }
}

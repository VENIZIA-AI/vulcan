import { TypeScriptCompiler } from '@venizia/vulcan-atlas';
import { builtinModules } from 'node:module';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { RecordValue } from '../common/record.ts';
import { ConfigConstants } from './common/index.ts';
import { ConfigLoader } from './loader.ts';

/** What an import may name without its extension, in the order a runtime tries them. */
const EXTENSIONS = ['.mts', '.ts', '.mjs', '.js', '.cts', '.cjs', '.json'];
/** A specifier written with the extension the compiled file has (`./claude.js`) names the TypeScript source beside it. */
const SOURCE_OF: Readonly<Record<string, string[]>> = {
  '.js': ['.ts'],
  '.mjs': ['.mts'],
  '.cjs': ['.cts'],
};
/** A package name as npm allows it, with an optional path after it: what a bare specifier must be to name a package. */
const PACKAGE_SPECIFIER = /^(@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*(\/.*)?$/;

/** A module of the config that the guards cannot protect, and why. */
export interface IConfigModuleProblem {
  /** Repository-relative where it can be, else absolute. */
  file: string;
  message: string;
}

const MOVE = 'move it under .configs/ so the guard protects it';

const isFile = (opts: { path: string }): boolean =>
  existsSync(opts.path) && statSync(opts.path).isFile();

/** The file a path names, as a runtime would find it: itself, the TypeScript source of a `.js` name, with an extension, or its index. */
const resolveFile = (opts: { base: string }): string | undefined => {
  const { base } = opts;
  const extension = EXTENSIONS.find((candidate) => base.endsWith(candidate));
  const sources = (extension === undefined ? [] : (SOURCE_OF[extension] ?? [])).map(
    (source) => `${base.slice(0, -(extension ?? '').length)}${source}`,
  );

  return [
    base,
    ...sources,
    ...EXTENSIONS.map((candidate) => `${base}${candidate}`),
    ...EXTENSIONS.map((candidate) => join(base, `index${candidate}`)),
  ].find((path) => isFile({ path }));
};

/** The first string target of a `package.json` `imports` entry: a string, or the first string of its conditions. */
const firstTargetOf = (opts: { value: unknown }): string | undefined => {
  if (typeof opts.value === 'string') {
    return opts.value;
  }

  if (!RecordValue.isRecord(opts.value)) {
    return undefined;
  }

  for (const nested of Object.values(opts.value)) {
    const found = firstTargetOf({ value: nested });

    if (found !== undefined) {
      return found;
    }
  }

  return undefined;
};

/** How the project maps a non-relative specifier to its own files: `compilerOptions.paths` of the root tsconfig and `imports` of the root package.json. */
interface IAliases {
  paths: { pattern: string; targets: string[]; base: string }[];
  imports: Record<string, unknown>;
  /** The packages the root package.json declares: a package not installed yet is still a package. */
  declared: Set<string>;
}

const readJson = (opts: { path: string }): unknown => {
  try {
    return JSON.parse(readFileSync(opts.path, 'utf8'));
  } catch {
    return undefined;
  }
};

/** A specifier mapped through a `*` pattern (`@/*` to `src/*`), or `undefined` when the pattern does not match. */
const mapPattern = (opts: {
  pattern: string;
  target: string;
  specifier: string;
}): string | undefined => {
  const star = opts.pattern.indexOf('*');

  if (star === -1) {
    return opts.pattern === opts.specifier ? opts.target : undefined;
  }

  const head = opts.pattern.slice(0, star);
  const tail = opts.pattern.slice(star + 1);

  return opts.specifier.startsWith(head) &&
    opts.specifier.endsWith(tail) &&
    opts.specifier.length >= head.length + tail.length
    ? opts.target.replace(
        '*',
        opts.specifier.slice(head.length, opts.specifier.length - tail.length),
      )
    : undefined;
};

/** The local modules a config is made of: what `.configs/vulcan.config.mts` imports, followed through every module it reaches. */
export class ConfigImports {
  /**
   * The files under `.configs/` the config imports, directly or through another module, relative to `root` and sorted, each
   * by its path and by its real path when a link leads elsewhere; the config file itself is not one. A project with no
   * config has none.
   */
  static localModules(opts: { root: string }): string[] {
    return ConfigImports.scan(opts).modules;
  }

  /**
   * The modules of the config and what the guards cannot protect: a module reached outside `.configs/` (a relative import, an
   * alias of the root tsconfig `paths` or package.json `imports`, a link that leads out), and a specifier that names neither a
   * file of the project nor an installed package. The files are read with the TypeScript pre-processor, never run.
   */
  static scan(opts: { root: string }): { modules: string[]; problems: IConfigModuleProblem[] } {
    const root = existsSync(opts.root) ? realpathSync(opts.root) : opts.root;
    const config = ConfigLoader.findFile({ root });

    if (config === undefined) {
      return { modules: [], problems: [] };
    }

    const typescript = TypeScriptCompiler.load({ from: root });
    const configs = join(root, ConfigConstants.DIRECTORY);
    const aliases = ConfigImports.aliasesOf({ root });
    const shown = (path: string): string =>
      path.startsWith(`${root}${sep}`) ? relative(root, path).split(sep).join('/') : path;
    const isUnder = (path: string): boolean => path.startsWith(`${configs}${sep}`);
    const modules = new Set<string>();
    const problems: IConfigModuleProblem[] = [];
    const seen = new Set<string>([config]);
    const pending = [config];

    for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
      const { importedFiles } = typescript.preProcessFile(readFileSync(file, 'utf8'), true, true);

      for (const { fileName: specifier } of importedFiles) {
        const found = ConfigImports.resolveSpecifier({ root, from: file, specifier, aliases });

        if (found === 'package') {
          continue;
        }

        if (found === undefined) {
          problems.push({
            file: shown(file),
            message: `imports '${specifier}', which names no file of the project and no installed package: the guard cannot tell what it is; ${MOVE} and import it by a relative path`,
          });
          continue;
        }

        if (seen.has(found)) {
          continue;
        }

        seen.add(found);
        pending.push(found);

        const real = realpathSync(found);

        if (isUnder(found)) {
          modules.add(shown(found));
        }

        if (isUnder(real)) {
          modules.add(shown(real));
        }

        if (!isUnder(found) || !isUnder(real)) {
          problems.push({
            file: shown(found),
            message: `a module of the config${real === found ? '' : ` (a link to ${shown(real)})`} outside .configs/, reached from ${shown(file)}: an agent can change the policy through it; ${MOVE}`,
          });
        }
      }
    }

    modules.delete(shown(config));

    return { modules: [...modules].sort(), problems };
  }

  private static aliasesOf(opts: { root: string }): IAliases {
    const tsconfig = readJson({ path: join(opts.root, 'tsconfig.json') });
    const compiler = RecordValue.isRecord(tsconfig) ? tsconfig['compilerOptions'] : undefined;
    const paths = RecordValue.isRecord(compiler) ? compiler['paths'] : undefined;
    const baseUrl =
      RecordValue.isRecord(compiler) && typeof compiler['baseUrl'] === 'string'
        ? compiler['baseUrl']
        : '.';
    const manifest = readJson({ path: join(opts.root, 'package.json') });
    const imports = RecordValue.isRecord(manifest) ? manifest['imports'] : undefined;

    return {
      paths: RecordValue.isRecord(paths)
        ? Object.entries(paths).map(([pattern, targets]) => ({
            pattern,
            targets: Array.isArray(targets)
              ? targets.filter((target): target is string => typeof target === 'string')
              : [],
            base: resolve(opts.root, baseUrl),
          }))
        : [],
      imports: RecordValue.isRecord(imports) ? imports : {},
      declared: new Set(
        ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].flatMap(
          (field) => {
            const block = RecordValue.isRecord(manifest) ? manifest[field] : undefined;

            return RecordValue.isRecord(block) ? Object.keys(block) : [];
          },
        ),
      ),
    };
  }

  /** The file a specifier names (its lexical path), `package` for an installed package or a built-in, `undefined` when it names nothing known. */
  private static resolveSpecifier(opts: {
    root: string;
    from: string;
    specifier: string;
    aliases: IAliases;
  }): string | 'package' | undefined {
    const { specifier, aliases } = opts;

    if (specifier.startsWith('./') || specifier.startsWith('../')) {
      return resolveFile({ base: resolve(dirname(opts.from), specifier) });
    }

    if (specifier.startsWith('node:') || builtinModules.includes(specifier)) {
      return 'package';
    }

    if (specifier.startsWith('#')) {
      for (const [pattern, value] of Object.entries(aliases.imports)) {
        const target = firstTargetOf({ value });
        const mapped =
          target === undefined ? undefined : mapPattern({ pattern, target, specifier });

        if (mapped !== undefined) {
          return mapped.startsWith('./')
            ? resolveFile({ base: resolve(opts.root, mapped) })
            : undefined;
        }
      }

      return undefined;
    }

    for (const { pattern, targets, base } of aliases.paths) {
      for (const target of targets) {
        const mapped = mapPattern({ pattern, target, specifier });
        const file =
          mapped === undefined ? undefined : resolveFile({ base: resolve(base, mapped) });

        if (file !== undefined) {
          return file;
        }
      }
    }

    const name = specifier.startsWith('@')
      ? specifier.split('/').slice(0, 2).join('/')
      : (specifier.split('/')[0] ?? '');

    return PACKAGE_SPECIFIER.test(specifier) &&
      (aliases.declared.has(name) || ConfigImports.isInstalled({ from: opts.root, name }))
      ? 'package'
      : undefined;
  }

  /** Whether `name` is installed in a `node_modules` of `from` or of a folder above it, as a runtime looks one up. */
  private static isInstalled(opts: { from: string; name: string }): boolean {
    for (let directory = opts.from; ; directory = dirname(directory)) {
      if (existsSync(join(directory, 'node_modules', opts.name, 'package.json'))) {
        return true;
      }

      if (dirname(directory) === directory) {
        return false;
      }
    }
  }
}

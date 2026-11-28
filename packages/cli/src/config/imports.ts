import { TypeScriptCompiler } from '@venizia/vulcan-atlas';
import { builtinModules } from 'node:module';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { RecordValue } from '../common/record.ts';
import { ConfigConstants } from './common/index.ts';
import { ImportSpecifiers } from './import-specifiers.ts';
import { ConfigLoader } from './loader.ts';
import { FallbackUtility } from '../common/utilities/fallback.utility.ts';

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
  /** The packages the root package.json declares, each with its version or protocol (`file:`, `workspace:`...). */
  declared: Map<string, string>;
}

/** What a specifier names: a file of the project (and the alias it went through), a package, a package of this repository, or nothing known. */
type TResolved =
  | { found: 'file'; path: string; alias?: string }
  | { found: 'package' }
  | { found: 'local-package'; where: string }
  | { found: 'unknown' };

/** A version that makes a package the project's own code: a folder, a link or a member of the workspace. */
const LOCAL_PROTOCOL = /^(?:file|link|workspace|portal):/;

const readJson = (opts: { path: string }): unknown => {
  return FallbackUtility.of({
    read: () => JSON.parse(readFileSync(opts.path, 'utf8')),
    otherwise: undefined,
  });
};

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

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
   * The modules of the config and what the guards cannot protect: the config file or a module reached outside `.configs/`
   * (a relative import, a link that leads out, a package of this repository), a module reached through an alias of the root
   * tsconfig `paths` or package.json `imports`, a specifier that names nothing the project has, and a file that cannot be
   * read. Only imports that bring a value are followed; the files are parsed, never run.
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

    const realOf = (path: string): string | undefined => {
      try {
        return realpathSync(path);
      } catch (error) {
        problems.push({
          file: shown(path),
          message: `cannot be resolved (${errorText(error)}): the guard cannot tell where it is`,
        });

        return undefined;
      }
    };

    const configReal = realOf(config);

    if (configReal !== undefined && configReal !== config && !isUnder(configReal)) {
      problems.push({
        file: shown(config),
        message: `is a link to ${shown(configReal)}, outside .configs/: an agent can change the policy through it; move the file under .configs/ so the guard protects it`,
      });
    }

    const seen = new Set<string>([config]);
    const pending = [config];

    for (let current = pending.pop(); current !== undefined; current = pending.pop()) {
      let specifiers: string[];

      try {
        specifiers = ImportSpecifiers.of({ typescript, text: readFileSync(current, 'utf8') });
      } catch (error) {
        problems.push({
          file: shown(current),
          message: `cannot be read (${errorText(error)}): the guard cannot tell what it imports`,
        });
        continue;
      }

      for (const specifier of specifiers) {
        const resolved = ConfigImports.resolveSpecifier({
          root,
          from: current,
          specifier,
          aliases,
        });

        if (resolved.found === 'package') {
          continue;
        }

        if (resolved.found === 'unknown') {
          problems.push({
            file: shown(current),
            message: `imports '${specifier}', which names no file of the project and no installed package: the guard cannot tell what it is; ${MOVE} and import it by a relative path`,
          });
          continue;
        }

        if (resolved.found === 'local-package') {
          problems.push({
            file: shown(current),
            message: `imports '${specifier}', a package of this repository (${resolved.where}): an agent can change the policy through it; ${MOVE} and import it by a relative path`,
          });
          continue;
        }

        if (resolved.alias !== undefined) {
          problems.push({
            file: shown(current),
            message: `imports ${shown(resolved.path)} through the alias '${resolved.alias}': import it by a relative path, so the guard reads the same file the runtime loads`,
          });
        }

        if (seen.has(resolved.path)) {
          continue;
        }

        seen.add(resolved.path);
        pending.push(resolved.path);

        const real = realOf(resolved.path);

        if (isUnder(resolved.path)) {
          modules.add(shown(resolved.path));
        }

        if (real !== undefined && isUnder(real)) {
          modules.add(shown(real));
        }

        if (real !== undefined && (!isUnder(resolved.path) || !isUnder(real))) {
          problems.push({
            file: shown(resolved.path),
            message: `a module of the config${real === resolved.path ? '' : ` (a link to ${shown(real)})`} outside .configs/, reached from ${shown(current)}: an agent can change the policy through it; ${MOVE}`,
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
      declared: new Map(
        ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].flatMap(
          (field) => {
            const block = RecordValue.isRecord(manifest) ? manifest[field] : undefined;

            return RecordValue.isRecord(block)
              ? Object.entries(block).map(([name, version]): [string, string] => [
                  name,
                  typeof version === 'string' ? version : '',
                ])
              : [];
          },
        ),
      ),
    };
  }

  private static resolveSpecifier(opts: {
    root: string;
    from: string;
    specifier: string;
    aliases: IAliases;
  }): TResolved {
    const { specifier, aliases } = opts;

    const fileOf = (base: string, alias?: string): TResolved => {
      const path = resolveFile({ base });

      return path === undefined
        ? { found: 'unknown' }
        : { found: 'file', path, ...(alias === undefined ? {} : { alias }) };
    };

    if (specifier.startsWith('./') || specifier.startsWith('../')) {
      return fileOf(resolve(dirname(opts.from), specifier));
    }

    if (specifier.startsWith('node:') || builtinModules.includes(specifier)) {
      return { found: 'package' };
    }

    if (specifier.startsWith('#')) {
      for (const [pattern, value] of Object.entries(aliases.imports)) {
        const target = firstTargetOf({ value });
        const mapped =
          target === undefined ? undefined : mapPattern({ pattern, target, specifier });

        if (mapped !== undefined) {
          return mapped.startsWith('./')
            ? fileOf(resolve(opts.root, mapped), specifier)
            : { found: 'unknown' };
        }
      }

      return { found: 'unknown' };
    }

    for (const { pattern, targets, base } of aliases.paths) {
      for (const target of targets) {
        const mapped = mapPattern({ pattern, target, specifier });
        const path =
          mapped === undefined ? undefined : resolveFile({ base: resolve(base, mapped) });

        if (path !== undefined) {
          return { found: 'file', path, alias: specifier };
        }
      }
    }

    if (!PACKAGE_SPECIFIER.test(specifier)) {
      return { found: 'unknown' };
    }

    const name = specifier.startsWith('@')
      ? specifier.split('/').slice(0, 2).join('/')
      : (specifier.split('/')[0] ?? '');
    const installed = ConfigImports.installedOf({ from: opts.root, name });
    const declared = aliases.declared.get(name);

    if (installed !== undefined) {
      // A package whose folder is the project's own code (a workspace member, a `file:` or `link:` dependency) is a local module.
      // Inside the root or not: a project that is a folder of a monorepo gets the members of the workspace through links above it.
      return !installed.split(sep).includes('node_modules')
        ? { found: 'local-package', where: relative(opts.root, installed).split(sep).join('/') }
        : { found: 'package' };
    }

    if (declared !== undefined) {
      return LOCAL_PROTOCOL.test(declared)
        ? { found: 'local-package', where: `declared as ${declared}, not installed` }
        : { found: 'package' };
    }

    return { found: 'unknown' };
  }

  /** The real folder of `name` in a `node_modules` of `from` or of a folder above it, as a runtime looks one up; `undefined` when none. */
  private static installedOf(opts: { from: string; name: string }): string | undefined {
    for (let directory = opts.from; ; directory = dirname(directory)) {
      const folder = join(directory, 'node_modules', opts.name);

      if (existsSync(join(folder, 'package.json'))) {
        try {
          return realpathSync(folder);
        } catch {
          return folder;
        }
      }

      if (dirname(directory) === directory) {
        return undefined;
      }
    }
  }
}

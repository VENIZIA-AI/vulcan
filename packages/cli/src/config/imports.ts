import { TypeScriptCompiler } from '@venizia/vulcan-atlas';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
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

const isFile = (opts: { path: string }): boolean =>
  existsSync(opts.path) && statSync(opts.path).isFile();

/** The file a relative specifier names from `from`, or `undefined` when none is found. */
const resolveModule = (opts: { from: string; specifier: string }): string | undefined => {
  const base = resolve(dirname(opts.from), opts.specifier);
  const extension = EXTENSIONS.find((candidate) => base.endsWith(candidate));
  const sources = (extension === undefined ? [] : (SOURCE_OF[extension] ?? [])).map(
    (source) => `${base.slice(0, -(extension ?? '').length)}${source}`,
  );
  const candidates = [
    base,
    ...sources,
    ...EXTENSIONS.map((candidate) => `${base}${candidate}`),
    ...EXTENSIONS.map((candidate) => join(base, `index${candidate}`)),
  ];

  return candidates.find((path) => isFile({ path }));
};

/** The local modules a config is made of: what `.configs/vulcan.config.mts` imports, followed through every module it reaches. */
export class ConfigImports {
  /**
   * The files under `.configs/` the config imports, directly or through another module, relative to `root` and sorted; the
   * config file itself is not one. Only relative specifiers are followed (a package is not the project's), and the files are
   * read as text with the TypeScript pre-processor, never run. A project with no config has none.
   */
  static localModules(opts: { root: string }): string[] {
    const config = ConfigLoader.findFile({ root: opts.root });

    if (config === undefined) {
      return [];
    }

    const typescript = TypeScriptCompiler.load({ from: opts.root });
    const configs = join(opts.root, ConfigConstants.DIRECTORY);
    const seen = new Set<string>([config]);
    const pending = [config];

    for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
      const { importedFiles } = typescript.preProcessFile(readFileSync(file, 'utf8'), true, true);

      for (const imported of importedFiles) {
        if (!imported.fileName.startsWith('./') && !imported.fileName.startsWith('../')) {
          continue;
        }

        const found = resolveModule({ from: file, specifier: imported.fileName });

        if (
          found !== undefined &&
          !seen.has(found) &&
          found.startsWith(`${opts.root}${sep}`) &&
          !found.split(sep).includes('node_modules')
        ) {
          seen.add(found);
          pending.push(found);
        }
      }
    }

    return [...seen]
      .filter((file) => file !== config && file.startsWith(`${configs}${sep}`))
      .map((file) => relative(opts.root, file).split(sep).join('/'))
      .sort();
  }
}

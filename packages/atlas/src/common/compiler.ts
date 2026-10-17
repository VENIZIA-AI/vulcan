import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type TypeScript from 'typescript';
import { StderrLogger } from './logger';
import { PROJECT_ROOT } from './project';
import { hasAtlasProject, readAtlasProject } from './project-config';

/** TypeScript 7's main export is its version and nothing else: a compiler is what carries the API atlas calls. */
const hasCompilerApi = (candidate: unknown): candidate is typeof TypeScript =>
  typeof candidate === 'object' &&
  candidate !== null &&
  'createProgram' in candidate &&
  typeof candidate.createProgram === 'function' &&
  'ModuleResolutionKind' in candidate &&
  'SymbolFlags' in candidate;

/**
 * The `typescript` package directory Node resolution would pick from `from`: the nearest
 * `node_modules/typescript` going up. Looked up on disk, never through `require`: a bare require that
 * finds nothing makes Bun auto-install the NEWEST typescript from the registry (7.x, no compiler API).
 */
const findTypeScript = (opts: { from: string }): string | undefined => {
  let directory = opts.from;

  for (;;) {
    const candidate = join(directory, 'node_modules', 'typescript');

    if (existsSync(join(candidate, 'package.json'))) {
      return candidate;
    }

    const parent = dirname(directory);

    if (parent === directory) {
      return undefined;
    }

    directory = parent;
  }
};

const requireFrom = (opts: { directory: string }): unknown =>
  createRequire(join(opts.directory, 'package.json'))(opts.directory);

/**
 * The TypeScript compiler of the project being read, not one of atlas's own: the `.d.ts` it emitted
 * is read with the same compiler. Loaded on first use, so the MCP server never pays for it.
 */
export class TypeScriptCompiler {
  private static compiler: typeof TypeScript | undefined;

  static get(): typeof TypeScript {
    const compiler =
      this.compiler ??
      this.load({ from: hasAtlasProject() ? readAtlasProject().typescriptFrom : PROJECT_ROOT });

    this.compiler = compiler;

    return compiler;
  }

  /**
   * The compiler `typescript` resolves to from `from` - it emitted the declarations being read - else
   * atlas's own (a runtime dependency since 0.2.0-0), so a clean install still reads an installed
   * package or a tarball, and so does a project whose `typescript` has no compiler API. Nothing is
   * ever installed: with no typescript in either place it fails and says what to install. `own` is
   * where atlas's install is looked up (default: next to this file).
   */
  static load(opts: { from: string; own?: string }): typeof TypeScript {
    const fromProject = findTypeScript({ from: opts.from });

    if (fromProject !== undefined) {
      try {
        const candidate = requireFrom({ directory: fromProject });

        if (hasCompilerApi(candidate)) {
          return candidate;
        }
      } catch (error) {
        StderrLogger.get(TypeScriptCompiler.name)
          .for('load')
          .debug(
            'typescript from the project did not load, reading with atlas own | error: %s',
            error,
          );
      }
    }

    const fromAtlas = findTypeScript({ from: opts.own ?? dirname(__filename) });
    const own = fromAtlas === undefined ? undefined : requireFrom({ directory: fromAtlas });

    if (hasCompilerApi(own)) {
      return own;
    }

    throw new Error(
      `atlas: cannot find typescript (looked in ${opts.from} and in atlas's own install) - install it with \`bun add typescript\``,
    );
  }
}

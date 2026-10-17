import { createRequire } from 'node:module';
import { join } from 'node:path';
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
   * atlas's (a runtime dependency since 0.2.0-0), so a clean install still reads an installed package
   * or a tarball, and so does a project whose `typescript` has no compiler API.
   */
  static load(opts: { from: string }): typeof TypeScript {
    const own = (): typeof TypeScript => createRequire(__filename)('typescript');
    let candidate: unknown;

    try {
      candidate = createRequire(join(opts.from, 'package.json'))('typescript');
    } catch (error) {
      StderrLogger.get(TypeScriptCompiler.name)
        .for('load')
        .debug('no typescript from the project, reading with atlas own | error: %s', error);

      return own();
    }

    return hasCompilerApi(candidate) ? candidate : own();
  }
}

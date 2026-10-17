import { createRequire } from 'node:module';
import { join } from 'node:path';
import type TypeScript from 'typescript';
import { PROJECT_ROOT } from './project';
import { hasAtlasProject, readAtlasProject } from './project-config';

/**
 * The TypeScript compiler of the project being read, not one of atlas's own: the `.d.ts` it emitted
 * is read with the same compiler. Loaded on first use, so the MCP server never pays for it.
 */
export class TypeScriptCompiler {
  private static compiler: typeof TypeScript | undefined;

  static get(): typeof TypeScript {
    const compiler = this.compiler ?? this.load();

    this.compiler = compiler;

    return compiler;
  }

  /**
   * The project's own compiler when it has one - it emitted the declarations being read - else atlas's
   * (a runtime dependency since 0.2.0-0), so a clean install still reads an installed package or a
   * tarball.
   */
  private static load(): typeof TypeScript {
    const from = hasAtlasProject() ? readAtlasProject().typescriptFrom : PROJECT_ROOT;

    try {
      return createRequire(join(from, 'package.json'))('typescript');
    } catch {
      return createRequire(__filename)('typescript');
    }
  }
}

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

  private static load(): typeof TypeScript {
    // `atlas.typescriptFrom`: a project whose root does not carry typescript names the package that does.
    const from = hasAtlasProject() ? readAtlasProject().typescriptFrom : PROJECT_ROOT;

    return createRequire(join(from, 'package.json'))('typescript');
  }
}

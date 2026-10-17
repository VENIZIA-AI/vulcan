import { createRequire } from 'node:module';
import { join } from 'node:path';
import type TypeScript from 'typescript';
import { PROJECT_ROOT } from './project';

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
    return createRequire(join(PROJECT_ROOT, 'package.json'))('typescript');
  }
}

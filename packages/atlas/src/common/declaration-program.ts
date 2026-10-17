import { existsSync } from 'node:fs';
import type TypeScript from 'typescript';
import { TypeScriptCompiler } from './compiler';

/** An entry's module symbol and the checker that resolves it. */
export interface IDeclarationModule {
  checker: TypeScript.TypeChecker;
  moduleSymbol: TypeScript.Symbol;
}

/**
 * One TypeScript program over every entry of a run: a program per entry re-parsed the shared
 * dependency graph each time, which is where nearly all of a generator's time went.
 */
export class DeclarationProgram {
  private readonly checker: TypeScript.TypeChecker;

  private constructor(
    private readonly program: TypeScript.Program,
    private readonly scope: string,
  ) {
    this.checker = program.getTypeChecker();
  }

  static create(opts: { files: string[]; scope: string }): DeclarationProgram {
    const missing = opts.files.find(file => !existsSync(file));

    if (missing !== undefined) {
      throw new Error(`[${opts.scope}] ${missing} does not exist - build the package first`);
    }

    const compiler = TypeScriptCompiler.get();
    const program = compiler.createProgram(opts.files, {
      skipLibCheck: true,
      moduleResolution: compiler.ModuleResolutionKind.Bundler,
    });

    return new DeclarationProgram(program, opts.scope);
  }

  moduleOf(opts: { file: string }): IDeclarationModule {
    const source = this.program.getSourceFile(opts.file);
    const moduleSymbol = source ? this.checker.getSymbolAtLocation(source) : undefined;

    if (!moduleSymbol) {
      throw new Error(`[${this.scope}] ${opts.file} is not a module`);
    }

    return { checker: this.checker, moduleSymbol };
  }
}

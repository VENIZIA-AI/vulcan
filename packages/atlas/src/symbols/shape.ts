import { TypeScriptCompiler } from '@/common/compiler';
import type TypeScript from 'typescript';

const SHAPE_LENGTH = 12;

export class SymbolShape {
  /**
   * The whole declaration as the compiler prints it without comments - so layout and comments never
   * move it - reduced to a digest. A class or interface counts its members; a function, every parameter.
   */
  static of(opts: { declaration: TypeScript.Declaration }): string {
    const compiler = TypeScriptCompiler.get();
    const printed = compiler
      .createPrinter({ removeComments: true })
      .printNode(compiler.EmitHint.Unspecified, opts.declaration, opts.declaration.getSourceFile());

    return SymbolShape.digestOf({ text: printed });
  }

  static digestOf(opts: { text: string }): string {
    return new Bun.CryptoHasher('sha256').update(opts.text).digest('hex').slice(0, SHAPE_LENGTH);
  }
}

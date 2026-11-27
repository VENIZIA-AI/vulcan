import { TypeScriptCompiler } from '@/common/compiler';
import type TypeScript from 'typescript';

const SHAPE_LENGTH = 12;

export class SymbolShape {
  /** Printing is most of the cost of a record, and a namespace lists declarations other records already printed. */
  private static readonly digests = new WeakMap<TypeScript.Declaration, string>();

  /**
   * The whole declaration as the compiler prints it without comments - so layout and comments never
   * move it - reduced to a digest. A class or interface counts its members; a function, every parameter.
   */
  static of(opts: { declaration: TypeScript.Declaration }): string {
    const known = SymbolShape.digests.get(opts.declaration);

    if (known !== undefined) {
      return known;
    }

    const compiler = TypeScriptCompiler.get();
    const printed = compiler
      .createPrinter({ removeComments: true })
      .printNode(compiler.EmitHint.Unspecified, opts.declaration, opts.declaration.getSourceFile());

    const digest = SymbolShape.digestOf({ text: printed });

    SymbolShape.digests.set(opts.declaration, digest);

    return digest;
  }

  static digestOf(opts: { text: string }): string {
    return new Bun.CryptoHasher('sha256').update(opts.text).digest('hex').slice(0, SHAPE_LENGTH);
  }
}

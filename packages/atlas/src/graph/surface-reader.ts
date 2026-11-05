import { TypeScriptCompiler } from '@/common/compiler';
import type TypeScript from 'typescript';

/**
 * The skeleton of a source file: its tokens in order, without comments, whitespace and the block bodies of functions,
 * methods, constructors and accessors. An edit inside a body, a comment or the layout leaves it as it was; a new export, a
 * changed type, an initializer or an import moves it. It errs toward moving: a value that sets an inferred type is kept.
 */
export class SurfaceReader {
  static of(opts: { text: string; path: string }): string {
    const compiler = TypeScriptCompiler.get();
    const isJsx = opts.path.endsWith('x');
    const source = compiler.createSourceFile(
      opts.path,
      opts.text,
      compiler.ScriptTarget.Latest,
      false,
    );
    const bodies = SurfaceReader.bodiesOf({ source }).sort((a, b) => a[0] - b[0]);
    let reduced = '';
    let cursor = 0;

    for (const [start, end] of bodies) {
      reduced += `${opts.text.slice(cursor, start)}{}`;
      cursor = end;
    }

    reduced += opts.text.slice(cursor);

    const scanner = compiler.createScanner(
      compiler.ScriptTarget.Latest,
      true,
      isJsx ? compiler.LanguageVariant.JSX : compiler.LanguageVariant.Standard,
      reduced,
    );
    const tokens: string[] = [];

    for (
      let kind = scanner.scan();
      kind !== compiler.SyntaxKind.EndOfFileToken;
      kind = scanner.scan()
    ) {
      tokens.push(scanner.getTokenText());
    }

    return tokens.join(' ');
  }

  /** The `[start, end]` of each outermost block body of a function-like node; bodies inside bodies are not listed. */
  private static bodiesOf(opts: { source: TypeScript.SourceFile }): [number, number][] {
    const compiler = TypeScriptCompiler.get();
    const found: [number, number][] = [];
    const visit = (node: TypeScript.Node): void => {
      if (
        (compiler.isFunctionDeclaration(node) ||
          compiler.isFunctionExpression(node) ||
          compiler.isArrowFunction(node) ||
          compiler.isMethodDeclaration(node) ||
          compiler.isConstructorDeclaration(node) ||
          compiler.isGetAccessorDeclaration(node) ||
          compiler.isSetAccessorDeclaration(node)) &&
        node.body !== undefined &&
        compiler.isBlock(node.body)
      ) {
        found.push([node.body.getStart(opts.source), node.body.end]);

        return;
      }

      compiler.forEachChild(node, visit);
    };

    visit(opts.source);

    return found;
  }
}

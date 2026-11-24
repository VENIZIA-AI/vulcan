import type { TypeScriptCompiler } from '@venizia/vulcan-atlas';

type TTypeScript = ReturnType<typeof TypeScriptCompiler.load>;
type TNode = Parameters<TTypeScript['forEachChild']>[0];

/** What a module imports at run time: a type-only import or export brings no value, so no policy, and is left out. */
export class ImportSpecifiers {
  /** The specifiers of `text`, in order: static imports and re-exports, `import x = require()`, dynamic `import()` and `require()` with a literal. */
  static of(opts: { typescript: TTypeScript; text: string }): string[] {
    const { typescript } = opts;
    const source = typescript.createSourceFile(
      'module.mts',
      opts.text,
      typescript.ScriptTarget.Latest,
      true,
      typescript.ScriptKind.TS,
    );
    const found: string[] = [];
    const literalOf = (node: TNode | undefined): string | undefined =>
      node !== undefined && typescript.isStringLiteralLike(node) ? node.text : undefined;
    const visit = (node: TNode): void => {
      if (typescript.isImportDeclaration(node)) {
        const specifier = literalOf(node.moduleSpecifier);

        if (specifier !== undefined && node.importClause?.isTypeOnly !== true) {
          found.push(specifier);
        }

        return;
      }

      if (typescript.isExportDeclaration(node)) {
        const specifier = literalOf(node.moduleSpecifier);

        if (specifier !== undefined && !node.isTypeOnly) {
          found.push(specifier);
        }

        return;
      }

      if (
        typescript.isImportEqualsDeclaration(node) &&
        !node.isTypeOnly &&
        typescript.isExternalModuleReference(node.moduleReference)
      ) {
        const specifier = literalOf(node.moduleReference.expression);

        if (specifier !== undefined) {
          found.push(specifier);
        }

        return;
      }

      if (typescript.isCallExpression(node)) {
        const isImport = node.expression.kind === typescript.SyntaxKind.ImportKeyword;
        const isRequire =
          typescript.isIdentifier(node.expression) && node.expression.text === 'require';
        const specifier = isImport || isRequire ? literalOf(node.arguments[0]) : undefined;

        if (specifier !== undefined) {
          found.push(specifier);
        }
      }

      typescript.forEachChild(node, visit);
    };

    typescript.forEachChild(source, visit);

    return found;
  }
}

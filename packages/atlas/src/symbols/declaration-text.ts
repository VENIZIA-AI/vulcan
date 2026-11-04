import { TypeScriptCompiler } from '@/common/compiler';
import type TypeScript from 'typescript';

/** What a symbol record keeps of its declaration. */
export interface IDeclarationText {
  /** The declaration as the `.d.ts` has it - its TSDoc, its members, the unexported declarations it uses - capped. */
  declaration: string;
  /** The TSDoc of the export alone, comment markers removed; empty when it has none. */
  doc: string;
  /** Names of exported symbols the declaration refers to, in order of appearance. */
  uses: string[];
}

/** A `lib.*.d.ts` of the compiler: `Promise`, `Record` and the like never document the export that uses them. */
const LIB_FILE = /[\\/]lib\.[^\\/]*\.d\.ts$/;

/**
 * The text of one declaration read from a built `.d.ts`: the same text for the `symbol` tool and for
 * the generated API pages, so a reader of either sees what the package ships.
 */
export class DeclarationText {
  /** A class of hundreds of members is cut here, at a line, and says so. */
  static readonly RECORD_MAX_CHARS = 40_000;
  static readonly CUT_MARK = '// ... cut';

  static of(opts: {
    declaration: TypeScript.Declaration;
    checker: TypeScript.TypeChecker;
  }): IDeclarationText {
    // A module re-exported as a namespace is the whole file: nothing of it is this export's declaration.
    if (TypeScriptCompiler.get().isSourceFile(opts.declaration)) {
      return { declaration: '', doc: '', uses: [] };
    }

    const statement = DeclarationText.statementOf({ declaration: opts.declaration });
    const own = DeclarationText.textOf({ statement, declaration: opts.declaration });
    const locals: TypeScript.Node[] = [];
    const uses: string[] = [];
    const ownName = TypeScriptCompiler.get().getNameOfDeclaration(opts.declaration)?.getText();

    DeclarationText.collect({
      node: statement,
      statement,
      checker: opts.checker,
      locals,
      uses,
      seen: new Set<TypeScript.Node>([statement]),
    });

    const parts = [
      own.text,
      ...locals.map(
        (local) => DeclarationText.textOf({ statement: local, declaration: local }).text,
      ),
    ];

    return {
      declaration: DeclarationText.cut({
        text: parts.join('\n\n'),
        max: DeclarationText.RECORD_MAX_CHARS,
      }),
      doc: DeclarationText.cleanDoc({ comment: own.comment }),
      uses: [...new Set(uses)].filter((name) => name !== ownName),
    };
  }

  /** The TSDoc of an export alone, for a declaration in a source file, where the statement text would hold bodies. */
  static docOf(opts: { declaration: TypeScript.Declaration }): string {
    const statement = DeclarationText.statementOf({ declaration: opts.declaration });

    return DeclarationText.cleanDoc({
      comment: DeclarationText.textOf({ statement, declaration: opts.declaration }).comment,
    });
  }

  /** The text without its leading TSDoc block, for a reader that shows the prose apart from the code. */
  static withoutDoc(opts: { declaration: string }): string {
    const text = opts.declaration.trimStart();

    if (!text.startsWith('/**')) {
      return opts.declaration;
    }

    const end = text.indexOf('*/');

    return end === -1 ? opts.declaration : text.slice(end + 2).replace(/^\s*\n/, '');
  }

  /** `text` cut at a line break so that it and its mark fit in `max` characters; whole when it fits. */
  static cut(opts: { text: string; max: number }): string {
    if (opts.text.length <= opts.max) {
      return opts.text;
    }

    const head = opts.text.slice(0, Math.max(0, opts.max - DeclarationText.CUT_MARK.length - 1));
    const at = head.lastIndexOf('\n');

    return `${at === -1 ? head : head.slice(0, at)}\n${DeclarationText.CUT_MARK}`;
  }

  /** The statement a declaration is written in: a variable's declaration is one of several in its statement. */
  private static statementOf(opts: { declaration: TypeScript.Declaration }): TypeScript.Node {
    const compiler = TypeScriptCompiler.get();
    let node: TypeScript.Node = opts.declaration;

    while (
      node.parent !== undefined &&
      !compiler.isSourceFile(node.parent) &&
      !compiler.isModuleBlock(node.parent)
    ) {
      node = node.parent;
    }

    return node;
  }

  /** A statement with its TSDoc block; a variable statement of several names keeps only the one asked for. */
  private static textOf(opts: { statement: TypeScript.Node; declaration: TypeScript.Node }): {
    text: string;
    comment: string;
  } {
    const compiler = TypeScriptCompiler.get();
    const { statement } = opts;
    const sourceFile = statement.getSourceFile();
    const ranges =
      compiler.getLeadingCommentRanges(sourceFile.text, statement.getFullStart()) ?? [];
    const last = ranges.at(-1);
    const comment =
      last !== undefined && sourceFile.text.startsWith('/**', last.pos)
        ? sourceFile.text.slice(last.pos, last.end)
        : '';
    const isShared =
      compiler.isVariableStatement(statement) &&
      statement.declarationList.declarations.length > 1 &&
      compiler.isVariableDeclaration(opts.declaration);
    const body = isShared
      ? `export declare const ${opts.declaration.getText(sourceFile)};`
      : statement.getText(sourceFile);

    return { text: comment === '' ? body : `${comment}\n${body}`, comment };
  }

  /**
   * Walks a declaration for the names it refers to. A name declared in the same file without `export` is
   * an internal type of the package: its declaration is kept with the export. A name declared elsewhere is
   * listed by name, for a reader that can look it up.
   */
  private static collect(opts: {
    node: TypeScript.Node;
    statement: TypeScript.Node;
    checker: TypeScript.TypeChecker;
    locals: TypeScript.Node[];
    uses: string[];
    seen: Set<TypeScript.Node>;
  }): void {
    const compiler = TypeScriptCompiler.get();

    const visit = (node: TypeScript.Node): void => {
      if (compiler.isIdentifier(node) && DeclarationText.isReference({ node })) {
        DeclarationText.take({ ...opts, identifier: node });
      }

      compiler.forEachChild(node, visit);
    };

    visit(opts.node);
  }

  private static take(opts: {
    identifier: TypeScript.Identifier;
    statement: TypeScript.Node;
    checker: TypeScript.TypeChecker;
    locals: TypeScript.Node[];
    uses: string[];
    seen: Set<TypeScript.Node>;
  }): void {
    const compiler = TypeScriptCompiler.get();
    const found = opts.checker.getSymbolAtLocation(opts.identifier);

    if (found === undefined) {
      return;
    }

    const symbol =
      found.flags & compiler.SymbolFlags.Alias ? opts.checker.getAliasedSymbol(found) : found;
    const target = symbol.getDeclarations()?.[0];

    // A module (`export * as ns`) is not a declaration to quote, and a type parameter belongs to the statement.
    if (
      target === undefined ||
      compiler.isSourceFile(target) ||
      compiler.isTypeParameterDeclaration(target)
    ) {
      return;
    }

    const targetFile = target.getSourceFile();

    if (LIB_FILE.test(targetFile.fileName)) {
      return;
    }

    const targetStatement = DeclarationText.statementOf({ declaration: target });

    // Inside the statement itself (a member, a parameter): nothing to add.
    if (
      targetFile === opts.statement.getSourceFile() &&
      targetStatement.pos >= opts.statement.pos &&
      targetStatement.end <= opts.statement.end
    ) {
      return;
    }

    const isTopLevel = compiler.isSourceFile(targetStatement.parent);
    const isExported =
      (compiler.getCombinedModifierFlags(target) & compiler.ModifierFlags.Export) !== 0;

    if (targetFile === opts.statement.getSourceFile() && isTopLevel && !isExported) {
      if (!opts.seen.has(targetStatement)) {
        opts.seen.add(targetStatement);
        opts.locals.push(targetStatement);
        DeclarationText.collect({ ...opts, node: targetStatement });
      }

      return;
    }

    opts.uses.push(symbol.getName());
  }

  /** An identifier that names something, not one that is itself the name being declared or a member key. */
  private static isReference(opts: { node: TypeScript.Identifier }): boolean {
    const compiler = TypeScriptCompiler.get();
    const { parent } = opts.node;

    if (parent === undefined) {
      return false;
    }

    if (compiler.isPropertySignature(parent) || compiler.isPropertyDeclaration(parent)) {
      return parent.name !== opts.node;
    }

    if (compiler.isMethodSignature(parent) || compiler.isMethodDeclaration(parent)) {
      return parent.name !== opts.node;
    }

    if (compiler.isParameter(parent)) {
      return parent.name !== opts.node;
    }

    return true;
  }

  /** The TSDoc block without `/**`, `*\/` and the leading ` * ` of each line. */
  private static cleanDoc(opts: { comment: string }): string {
    return opts.comment
      .replace(/^\/\*\*+/, '')
      .replace(/\*+\/$/, '')
      .split('\n')
      .map((line) => line.replace(/^\s*\*\s?/, '').trimEnd())
      .join('\n')
      .trim();
  }
}

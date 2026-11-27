import type TypeScript from 'typescript';
import { TypeScriptCompiler } from '@/common/compiler';
import type { ISymbolRecord } from './common';
import { DeclarationText } from './declaration-text';
import type { IDeclarationParts } from './declaration-text';
import { SymbolShape } from './shape';
import { SourceSignature } from './source-signature';
import { ThirdPartyUtility } from './utilities/third-party.utility';

interface IWalk {
  checker: TypeScript.TypeChecker;
  repoRoot: string;
  /** Each module already listed, with the dotted path it is listed under: a cycle ends here. */
  listed: Map<TypeScript.Symbol, string>;
  members: Set<string>;
  uses: Set<string>;
  /** The exported name and the shape of every member, in order: what the digest of the namespace is made of. */
  shapes: string[];
}

const INDENT = '    ';
const MODIFIERS = /^(?:export\s+)?(?:default\s+)?(?:declare\s+)?/;

/**
 * The text of a module re-exported as a namespace (`export * as X from`, `import * as X` then `export { X }`),
 * read from declaration files: each export of the module with its declaration and TSDoc, as the members of a class are.
 */
export class NamespaceText {
  /** How many namespaces deep members are listed. */
  static readonly MAX_DEPTH = 8;

  /** What a record of a module re-exported as a namespace adds; nothing for any other export. */
  static fieldsOf(opts: {
    symbol: TypeScript.Symbol;
    /** What the export stands for, its aliases followed. */
    resolved: TypeScript.Symbol;
    checker: TypeScript.TypeChecker;
    repoRoot: string;
  }): Partial<ISymbolRecord> {
    const declaration = opts.resolved.getDeclarations()?.[0];
    const own = opts.symbol.getDeclarations()?.[0];

    if (
      declaration === undefined ||
      own === undefined ||
      !TypeScriptCompiler.get().isSourceFile(declaration) ||
      !declaration.isDeclarationFile
    ) {
      return {};
    }

    const name = opts.symbol.getName();
    const walk: IWalk = {
      checker: opts.checker,
      repoRoot: opts.repoRoot,
      listed: new Map([[opts.resolved, name]]),
      members: new Set(),
      uses: new Set(),
      shapes: [],
    };
    const lines = NamespaceText.blockOf({
      walk,
      module: opts.resolved,
      path: [name],
      outer: new Set(),
    });
    const text = DeclarationText.commented({
      comment: DeclarationText.commentOf({ declaration: own }),
      body: [`export declare namespace ${name} {`, ...lines, '}'].join('\n'),
    });

    return {
      declaration: DeclarationText.cut({ text, max: DeclarationText.RECORD_MAX_CHARS }),
      uses: [...walk.uses].filter((used) => !walk.members.has(used)),
      isModuleNamespace: true,
      shape: SymbolShape.digestOf({ text: walk.shapes.join('\n') }),
    };
  }

  /** The lines inside the braces of a namespace: its members by name, then the unexported declarations they use. */
  private static blockOf(opts: {
    walk: IWalk;
    module: TypeScript.Symbol;
    path: string[];
    /** What the namespaces around this one already show. */
    outer: ReadonlySet<TypeScript.Node>;
  }): string[] {
    const compiler = TypeScriptCompiler.get();
    const exported = opts.walk.checker
      .getExportsOfModule(opts.module)
      .sort((left, right) => (left.getName() < right.getName() ? -1 : 1));
    const shown = new Set(opts.outer);
    const declarations: TypeScript.Declaration[] = [];

    // Said before any member is read, so a local that is also a member is not repeated.
    for (const symbol of exported) {
      const own = NamespaceText.resolvedOf({ ...opts, symbol }).getDeclarations() ?? [];

      for (const declaration of own) {
        shown.add(
          compiler.isVariableDeclaration(declaration) ? declaration.parent.parent : declaration,
        );
      }

      declarations.push(...own);
      opts.walk.members.add(symbol.getName());
    }

    // Taken before any nested namespace is listed, so a local is shown at the highest level that uses it.
    const locals: string[] = [];

    for (const declaration of declarations) {
      for (const local of NamespaceText.partsOf({ ...opts, declaration })?.locals ?? []) {
        if (!shown.has(local.statement)) {
          shown.add(local.statement);
          locals.push(NamespaceText.indented({ text: local.text.replace(MODIFIERS, '') }));
        }
      }
    }

    const lines = exported.flatMap((symbol) =>
      NamespaceText.memberOf({ walk: opts.walk, path: opts.path, symbol, shown }),
    );

    return [...lines, ...locals];
  }

  /** The parts of a declaration quoted as text: one of this package, written in a declaration file. */
  private static partsOf(opts: {
    walk: IWalk;
    declaration: TypeScript.Declaration;
  }): IDeclarationParts | undefined {
    const { declaration, walk } = opts;
    const file = declaration.getSourceFile();

    if (
      !file.isDeclarationFile ||
      TypeScriptCompiler.get().isSourceFile(declaration) ||
      ThirdPartyUtility.isThirdParty({ repoRoot: walk.repoRoot, path: file.fileName })
    ) {
      return undefined;
    }

    return DeclarationText.partsOf({ declaration, checker: walk.checker });
  }

  private static memberOf(opts: {
    walk: IWalk;
    symbol: TypeScript.Symbol;
    path: string[];
    shown: ReadonlySet<TypeScript.Node>;
  }): string[] {
    const { walk, symbol } = opts;
    const compiler = TypeScriptCompiler.get();
    const name = symbol.getName();
    const resolved = NamespaceText.resolvedOf(opts);
    const declarations = resolved.getDeclarations() ?? [];
    const note = (text: string): string[] => [`${INDENT}// \`${name}\`: ${text}`];

    if (declarations.length === 0) {
      walk.shapes.push(name);

      return note('no declaration was found');
    }

    const own = symbol.getDeclarations()?.[0];
    const exportComment =
      own !== undefined && (compiler.isNamespaceExport(own) || compiler.isExportSpecifier(own))
        ? DeclarationText.commentOf({ declaration: own })
        : '';

    return declarations.flatMap((declaration, at) => {
      const file = declaration.getSourceFile();

      if (ThirdPartyUtility.isThirdParty({ repoRoot: walk.repoRoot, path: file.fileName })) {
        walk.shapes.push(name);

        return at === 0 ? note('re-exported from a third-party package') : [];
      }

      if (compiler.isSourceFile(declaration) && file.isDeclarationFile) {
        return NamespaceText.nestedOf({
          ...opts,
          module: resolved,
          comment: exportComment,
          outer: opts.shown,
        });
      }

      walk.shapes.push(`${name}:${SymbolShape.of({ declaration })}`);

      const parts = NamespaceText.partsOf({ walk, declaration });

      // A source file holds values: only what its signature says is quoted.
      if (parts === undefined) {
        return [`${INDENT}${SourceSignature.of({ declaration, name })};`];
      }

      const declared = compiler.getNameOfDeclaration(declaration)?.getText();
      const comment = parts.comment === '' && at === 0 ? exportComment : parts.comment;
      const body = parts.body.replace(MODIFIERS, '');

      for (const used of parts.uses) {
        walk.uses.add(used);
      }

      return [
        ...(declared === name ? [] : [`${INDENT}// exported as \`${name}\``]),
        NamespaceText.indented({ text: DeclarationText.commented({ comment, body }) }),
      ];
    });
  }

  private static nestedOf(opts: {
    walk: IWalk;
    module: TypeScript.Symbol;
    symbol: TypeScript.Symbol;
    path: string[];
    comment: string;
    outer: ReadonlySet<TypeScript.Node>;
  }): string[] {
    const { walk, module } = opts;
    const name = opts.symbol.getName();
    const path = [...opts.path, name];
    const listedAs = walk.listed.get(module);

    if (listedAs !== undefined) {
      walk.shapes.push(`${name}=${listedAs.split('.').slice(1).join('.')}`);

      return [`${INDENT}// \`${name}\`: the same members as \`${listedAs}\``];
    }

    if (path.length > NamespaceText.MAX_DEPTH) {
      walk.shapes.push(name);

      return [
        `${INDENT}// \`${name}\`: not listed: deeper than ${NamespaceText.MAX_DEPTH} namespaces`,
      ];
    }

    walk.listed.set(module, path.join('.'));
    walk.shapes.push(`${name}{`);

    const lines = NamespaceText.blockOf({ walk, module, path, outer: opts.outer });

    walk.shapes.push('}');

    const body = [`namespace ${name} {`, ...lines, '}'].join('\n');

    return [
      NamespaceText.indented({
        text: DeclarationText.commented({ comment: opts.comment, body }),
      }),
    ];
  }

  private static resolvedOf(opts: { walk: IWalk; symbol: TypeScript.Symbol }): TypeScript.Symbol {
    return opts.symbol.flags & TypeScriptCompiler.get().SymbolFlags.Alias
      ? opts.walk.checker.getAliasedSymbol(opts.symbol)
      : opts.symbol;
  }

  private static indented(opts: { text: string }): string {
    return opts.text
      .split('\n')
      .map((line) => (line === '' ? line : `${INDENT}${line}`))
      .join('\n');
  }
}

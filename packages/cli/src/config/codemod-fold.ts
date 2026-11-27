import { posix } from 'node:path';
import { CodemodConstants } from './common/index.ts';
import type { TExportDeclaration, TSourceFile, TTypeScript } from './format.ts';
import { ConfigTypeRewriter } from './config-types-rewrite.ts';

/** The modules of an old split the codemod folds into the groups, and why one cannot be folded or replaced. */
export class CodemodFoldReader {
  /** Whether a path, as the config's folder reaches it, is a file of `.configs/vulcan/`: the only place the codemod folds and deletes from. */
  static isContained(opts: { path: string }): boolean {
    const normal = posix.normalize(opts.path);

    return (
      normal.startsWith(`${CodemodConstants.MODULES_DIRECTORY}/`) &&
      !normal.split('/').includes('..')
    );
  }

  private static outsideReason(opts: { path: string }): string {
    return `${posix.normalize(opts.path)} is not under ${CodemodConstants.MODULES_DIRECTORY}/: the codemod folds and deletes only files there; put its value in the config by hand, or move the file there`;
  }

  /** The line (1-based) and the first words of a statement: what a refusal names. */
  private static whereOf(opts: {
    source: TSourceFile;
    statement: { getStart: (s: TSourceFile) => number; getText: (s: TSourceFile) => string };
  }): string {
    const { line } = opts.source.getLineAndCharacterOfPosition(
      opts.statement.getStart(opts.source),
    );

    return `line ${line + 1}: \`${opts.statement.getText(opts.source).split('\n')[0].slice(0, 70)}\``;
  }

  /**
   * The value a module of the old split exports as `name`, with the comment above it: through `export { name } from './x.mts'`
   * or `export * from './x.mts'`.
   * Only a file of `.configs/vulcan/` that holds nothing but the type import and that one exported const is folded: a module with
   * another export, a local name or a statement would lose it, so it is refused with its line.
   */
  static moduleValue(opts: {
    typescript: TTypeScript;
    read: (path: string) => string | undefined;
    path: string;
    name: string;
    folded: Set<string>;
    /** The files followed only for what they re-export. */
    barrels: Set<string>;
    depth: number;
  }): { text: string; comment: string } | { reason: string } {
    const { typescript } = opts;

    if (!CodemodFoldReader.isContained({ path: opts.path })) {
      return { reason: CodemodFoldReader.outsideReason({ path: opts.path }) };
    }

    const text = opts.read(opts.path);

    if (text === undefined || opts.depth > 3) {
      return { reason: `${opts.path} is not readable, so its value cannot be moved` };
    }

    const source = typescript.createSourceFile(
      opts.path,
      text,
      typescript.ScriptTarget.Latest,
      true,
      typescript.ScriptKind.TS,
    );
    const isTypeImport = (statement: (typeof source.statements)[number]): boolean =>
      ConfigTypeRewriter.isTypeImport({ typescript, statement });
    const exporting = source.statements.find(
      (statement) =>
        typescript.isExportDeclaration(statement) &&
        statement.moduleSpecifier !== undefined &&
        statement.exportClause !== undefined &&
        typescript.isNamedExports(statement.exportClause) &&
        statement.exportClause.elements.some((element) => element.name.text === opts.name),
    );

    const follow = (from: string): { text: string; comment: string } | { reason: string } => {
      // A file that only re-exports (an index): nothing else may live in it.
      const stray = source.statements.find(
        (statement) =>
          !isTypeImport(statement) &&
          !(typescript.isExportDeclaration(statement) && statement.moduleSpecifier !== undefined),
      );

      if (stray !== undefined) {
        return {
          reason: `${opts.path} has more than re-exports (${CodemodFoldReader.whereOf({ source, statement: stray })}): folding the modules would lose it`,
        };
      }

      opts.folded.add(opts.path);
      opts.barrels.add(opts.path);

      return CodemodFoldReader.moduleValue({ ...opts, path: from, depth: opts.depth + 1 });
    };

    if (exporting !== undefined && typescript.isExportDeclaration(exporting)) {
      return follow(
        CodemodFoldReader.targetOf({ typescript, path: opts.path, statement: exporting }),
      );
    }

    for (const statement of source.statements) {
      if (!typescript.isVariableStatement(statement)) {
        continue;
      }

      const declaration = statement.declarationList.declarations.find(
        (entry) => typescript.isIdentifier(entry.name) && entry.name.text === opts.name,
      );

      if (declaration === undefined || declaration.initializer === undefined) {
        continue;
      }

      const stray = source.statements.find((other) => other !== statement && !isTypeImport(other));

      if (stray !== undefined || statement.declarationList.declarations.length !== 1) {
        return {
          reason: `${opts.path} holds more than the type import and \`${opts.name}\` (${CodemodFoldReader.whereOf({ source, statement: stray ?? statement })}): another export, a local name or a statement would be lost, so it is not folded; move that out by hand first`,
        };
      }

      let init = declaration.initializer;

      while (
        typescript.isSatisfiesExpression(init) ||
        typescript.isAsExpression(init) ||
        typescript.isParenthesizedExpression(init)
      ) {
        init = init.expression;
      }

      opts.folded.add(opts.path);

      return {
        text: init.getText(source),
        comment: source.text.slice(statement.getFullStart(), statement.getStart(source)).trim(),
      };
    }

    const stars = CodemodFoldReader.starTargets({ typescript, source, path: opts.path });
    const outside = stars.find((path) => !CodemodFoldReader.isContained({ path }));

    if (outside !== undefined) {
      return { reason: CodemodFoldReader.outsideReason({ path: outside }) };
    }

    const providers = stars.flatMap((path) => {
      const origins = CodemodFoldReader.originsOf({ ...opts, path, seen: new Set([opts.path]) });

      return origins.length === 0 ? [] : [{ path, origins }];
    });

    if (new Set(providers.flatMap((provider) => provider.origins)).size > 1) {
      return {
        reason: `${opts.path} gets \`${opts.name}\` from more than one \`export *\` (${providers.map((provider) => provider.path).join(', ')}): name the one you mean`,
      };
    }

    // Several indexes may reach the one module that declares the name: each is followed, so each is folded.
    const [value] = providers.map((provider) => follow(provider.path));

    if (value !== undefined) {
      return value;
    }

    return {
      reason: `${opts.path} does not export \`${opts.name}\` as a value the codemod can read`,
    };
  }

  /** The file an `export ... from` of the module at `path` names. */
  private static targetOf(opts: {
    typescript: TTypeScript;
    path: string;
    statement: TExportDeclaration;
  }): string {
    const { moduleSpecifier } = opts.statement;

    return posix.join(
      posix.dirname(opts.path),
      moduleSpecifier !== undefined && opts.typescript.isStringLiteral(moduleSpecifier)
        ? moduleSpecifier.text
        : '',
    );
  }

  /** The files the `export * from` statements of a module name. */
  private static starTargets(opts: {
    typescript: TTypeScript;
    source: TSourceFile;
    path: string;
  }): string[] {
    const { typescript } = opts;

    return opts.source.statements.flatMap((statement) =>
      typescript.isExportDeclaration(statement) &&
      statement.moduleSpecifier !== undefined &&
      statement.exportClause === undefined
        ? [CodemodFoldReader.targetOf({ typescript, path: opts.path, statement })]
        : [],
    );
  }

  /**
   * The files that declare what the module at `path` exports as `name`, through named re-exports and `export *`; `seen` holds
   * the files on the way here, so a loop ends.
   */
  private static originsOf(opts: {
    typescript: TTypeScript;
    read: (path: string) => string | undefined;
    path: string;
    name: string;
    seen: Set<string>;
  }): string[] {
    const { typescript, path, name } = opts;

    if (opts.seen.has(path) || !CodemodFoldReader.isContained({ path })) {
      return [];
    }

    const text = opts.read(path);

    if (text === undefined) {
      return [];
    }

    const seen = new Set([...opts.seen, path]);
    const source = typescript.createSourceFile(
      path,
      text,
      typescript.ScriptTarget.Latest,
      true,
      typescript.ScriptKind.TS,
    );

    for (const statement of source.statements) {
      if (
        typescript.isVariableStatement(statement) &&
        statement.declarationList.declarations.some(
          (entry) => typescript.isIdentifier(entry.name) && entry.name.text === name,
        )
      ) {
        return [path];
      }

      if (
        typescript.isExportDeclaration(statement) &&
        statement.exportClause !== undefined &&
        typescript.isNamedExports(statement.exportClause) &&
        statement.exportClause.elements.some((element) => element.name.text === name)
      ) {
        return statement.moduleSpecifier === undefined
          ? [path]
          : CodemodFoldReader.originsOf({
              ...opts,
              path: CodemodFoldReader.targetOf({ typescript, path, statement }),
              seen,
            });
      }
    }

    return CodemodFoldReader.starTargets({ typescript, source, path }).flatMap((target) =>
      CodemodFoldReader.originsOf({ ...opts, path: target, seen }),
    );
  }

  /**
   * Why a file that only re-exports cannot be replaced or deleted, or `undefined`: every file it re-exports from is one this run
   * folds, so none of its exports is lost.
   */
  static barrelRefusal(opts: {
    typescript: TTypeScript;
    read: (path: string) => string | undefined;
    barrels: Set<string>;
    folded: Set<string>;
  }): string | undefined {
    const { typescript } = opts;

    for (const path of opts.barrels) {
      const source = typescript.createSourceFile(
        path,
        opts.read(path) ?? '',
        typescript.ScriptTarget.Latest,
        true,
        typescript.ScriptKind.TS,
      );

      for (const statement of source.statements) {
        if (!typescript.isExportDeclaration(statement) || statement.moduleSpecifier === undefined) {
          continue;
        }

        if (
          statement.exportClause !== undefined &&
          !typescript.isNamedExports(statement.exportClause)
        ) {
          return `${path} uses \`export * as\` (${CodemodFoldReader.whereOf({ source, statement })}): the name would be lost, so nothing is written`;
        }

        const target = CodemodFoldReader.targetOf({ typescript, path, statement });

        if (!opts.folded.has(target)) {
          return `${path} re-exports ${target}, which this run does not fold: its exports would be lost, so nothing is written`;
        }
      }
    }

    return undefined;
  }

  /**
   * Why the `index.mts` that is there cannot be replaced by the one of the groups, or `undefined`: it holds only re-exports, and
   * each name it lists is one this run folded (`barrelRefusal` checks the files behind them).
   */
  static indexRefusal(opts: {
    typescript: TTypeScript;
    text: string | undefined;
    folded: Set<string>;
  }): string | undefined {
    if (opts.text === undefined) {
      return undefined;
    }

    const { typescript } = opts;
    const source = typescript.createSourceFile(
      'index.mts',
      opts.text,
      typescript.ScriptTarget.Latest,
      true,
      typescript.ScriptKind.TS,
    );

    for (const statement of source.statements) {
      if (
        typescript.isImportDeclaration(statement) &&
        /^import type/.test(statement.getText(source))
      ) {
        continue;
      }

      if (
        typescript.isExportDeclaration(statement) &&
        statement.moduleSpecifier !== undefined &&
        statement.exportClause === undefined
      ) {
        continue;
      }

      if (
        !typescript.isExportDeclaration(statement) ||
        statement.exportClause === undefined ||
        !typescript.isNamedExports(statement.exportClause)
      ) {
        return `${CodemodConstants.MODULES_DIRECTORY}/index.mts has more than re-exports (${CodemodFoldReader.whereOf({ source, statement })}): it would be replaced, so it is left: merge it by hand`;
      }

      const unknown = statement.exportClause.elements.find(
        (element) => !opts.folded.has(element.name.text),
      );

      if (unknown !== undefined) {
        return `${CodemodConstants.MODULES_DIRECTORY}/index.mts exports \`${unknown.name.text}\`, which this run does not fold: it would be lost, so nothing is written`;
      }
    }

    return undefined;
  }
}

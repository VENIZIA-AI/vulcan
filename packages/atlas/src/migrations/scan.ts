import { readdirSync, readFileSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { join, relative } from 'node:path';
import type TypeScript from 'typescript';
import { TypeScriptCompiler } from '@/common/compiler';

/** One place in the app's code a migration item reaches. */
export interface IMigrationTouch {
  /** Relative to the app directory. */
  file: string;
  line: number;
  symbol: string;
}

/** What to look for: the symbols of one migration item, as imported from the packages it names. */
export interface IScanTarget {
  id: string;
  /** npm package names; an import counts when its specifier is one of them or a sub-path of one. */
  packages: string[];
  /** `Name`, `Name.member` or a module specifier, as a changelog entry spells them. */
  symbols: string[];
}

/** What one source file says about names it imports and where it uses them. */
interface IFileFacts {
  /** Every `import ... from` and `export ... from` with a string specifier, and `import('...')`. */
  modules: { specifier: string; line: number }[];
  /** `export * from '<specifier>'`: everything of the module, so every bare name of it. */
  stars: { specifier: string; line: number }[];
  /** Named imports and the names `export { } from` re-exports. */
  named: { specifier: string; imported: string; line: number }[];
  /** Local names bound by an import: `{ A as B }` binds `B` to `A`; `* as ns` and a default import bind the local to everything. */
  bindings: { local: string; imported: string; specifier: string; isNamespace: boolean }[];
  /** Every identifier that is not a member name, with the member read from it (`a.b.c`: member `b`, deeper `c`). */
  uses: { local: string; member?: string; deeper?: string; line: number }[];
}

const SOURCE_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'build', 'coverage']);

const belongsTo = (opts: { specifier: string; packages: string[] }): boolean =>
  opts.packages.some((name) => opts.specifier === name || opts.specifier.startsWith(`${name}/`));

/** Source files under `directory`; a folder that cannot be read is named in `unreadable` and left out. */
const filesOf = (opts: { directory: string; unreadable: string[]; root?: string }): string[] => {
  const root = opts.root ?? opts.directory;
  let entries: Dirent[];

  try {
    entries = readdirSync(opts.directory, { withFileTypes: true });
  } catch {
    opts.unreadable.push(relative(root, opts.directory) || '.');

    return [];
  }

  return entries.flatMap((entry) => {
    const path = join(opts.directory, entry.name);

    if (entry.isDirectory()) {
      return entry.name.startsWith('.') || SKIPPED_DIRECTORIES.has(entry.name)
        ? []
        : filesOf({ directory: path, unreadable: opts.unreadable, root });
    }

    return entry.isFile() && SOURCE_FILE.test(entry.name) ? [path] : [];
  });
};

/**
 * Where an app's code uses what a migration names. Syntax only (no program, no type check): an
 * import binding is followed to its uses by name, so a local that shadows an import is counted -
 * the plan lists a place to look, never an edit.
 */
/** What a scan found: the touches of each target by id, and the files it could not read. */
export interface IScanResult {
  touches: Record<string, IMigrationTouch[]>;
  /** Relative paths of files or folders that could not be read; the rest was scanned. */
  unreadable: string[];
}

export class AppScan {
  static scan(opts: { app: string; targets: IScanTarget[] }): IScanResult {
    const compiler = TypeScriptCompiler.get();
    const found: Record<string, IMigrationTouch[]> = Object.fromEntries(
      opts.targets.map((target) => [target.id, []]),
    );
    const unreadable: string[] = [];
    const needles = opts.targets.flatMap((target) =>
      target.symbols.map((symbol) => (symbol.startsWith('@') ? symbol : symbol.split('.')[0])),
    );
    const packages = opts.targets.flatMap((target) => target.packages);

    for (const path of filesOf({ directory: opts.app, unreadable })) {
      let text: string;

      try {
        text = readFileSync(path, 'utf8');
      } catch {
        unreadable.push(relative(opts.app, path));

        continue;
      }

      // Most files name none of the symbols: they are never parsed. `export *` names none, only the package.
      const names = needles.some((needle) => text.includes(needle));
      const stars = text.includes('export *') && packages.some((name) => text.includes(name));

      if (!names && !stars) {
        continue;
      }

      const facts = AppScan.factsOf({ compiler, path, text });
      const file = relative(opts.app, path);

      for (const target of opts.targets) {
        for (const symbol of target.symbols) {
          for (const line of AppScan.linesOf({ facts, target, symbol })) {
            found[target.id].push({ file, line, symbol });
          }
        }
      }
    }

    return { touches: found, unreadable: unreadable.map((path) => path) };
  }

  private static factsOf(opts: {
    compiler: typeof TypeScript;
    path: string;
    text: string;
  }): IFileFacts {
    const { compiler } = opts;
    const source = compiler.createSourceFile(
      opts.path,
      opts.text,
      compiler.ScriptTarget.Latest,
      true,
    );
    const facts: IFileFacts = { modules: [], stars: [], named: [], bindings: [], uses: [] };
    const lineOf = (node: TypeScript.Node): number =>
      source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    const specifierOf = (node: TypeScript.Node | undefined): string | undefined =>
      node !== undefined && compiler.isStringLiteralLike(node) ? node.text : undefined;

    const visit = (node: TypeScript.Node): void => {
      if (compiler.isImportDeclaration(node) || compiler.isExportDeclaration(node)) {
        const specifier = specifierOf(node.moduleSpecifier);

        if (specifier === undefined) {
          return;
        }

        facts.modules.push({ specifier, line: lineOf(node) });

        const clause = compiler.isImportDeclaration(node)
          ? node.importClause?.namedBindings
          : node.exportClause;

        if (compiler.isExportDeclaration(node) && node.exportClause === undefined) {
          facts.stars.push({ specifier, line: lineOf(node) });
        }

        if (compiler.isImportDeclaration(node) && node.importClause?.name !== undefined) {
          facts.bindings.push({
            local: node.importClause.name.text,
            imported: 'default',
            specifier,
            isNamespace: true,
          });
        }

        if (clause !== undefined && compiler.isNamespaceImport(clause)) {
          facts.bindings.push({
            local: clause.name.text,
            imported: '*',
            specifier,
            isNamespace: true,
          });
        }

        if (
          clause !== undefined &&
          (compiler.isNamedImports(clause) || compiler.isNamedExports(clause))
        ) {
          for (const element of clause.elements) {
            const imported = (element.propertyName ?? element.name).text;

            facts.named.push({ specifier, imported, line: lineOf(element) });

            if (compiler.isImportSpecifier(element)) {
              facts.bindings.push({
                local: element.name.text,
                imported,
                specifier,
                isNamespace: false,
              });
            }
          }
        }

        return;
      }

      if (
        compiler.isCallExpression(node) &&
        node.expression.kind === compiler.SyntaxKind.ImportKeyword
      ) {
        const specifier = specifierOf(node.arguments[0]);

        if (specifier !== undefined) {
          facts.modules.push({ specifier, line: lineOf(node) });
        }
      }

      if (compiler.isIdentifier(node)) {
        const access = compiler.isPropertyAccessExpression(node.parent) ? node.parent : undefined;

        // `a.Name` reads a member of `a`: the identifier `Name` is not a name of this file.
        if (access?.name !== node) {
          const outer =
            access !== undefined && compiler.isPropertyAccessExpression(access.parent)
              ? access.parent
              : undefined;

          facts.uses.push({
            local: node.text,
            member: access?.expression === node ? access.name.text : undefined,
            deeper:
              outer !== undefined && outer.expression === access ? outer.name.text : undefined,
            line: lineOf(node),
          });
        }
      }

      compiler.forEachChild(node, visit);
    };

    visit(source);

    return facts;
  }

  /** The lines of one file where `symbol` is reached through the target's packages, each once. */
  private static linesOf(opts: {
    facts: IFileFacts;
    target: IScanTarget;
    symbol: string;
  }): number[] {
    const { facts, target, symbol } = opts;
    const lines = new Set<number>();

    if (symbol.startsWith('@')) {
      for (const module of facts.modules.filter((entry) => entry.specifier === symbol)) {
        lines.add(module.line);
      }

      return [...lines];
    }

    const [head, member] = symbol.split('.');
    const ours = (specifier: string): boolean =>
      belongsTo({ specifier, packages: target.packages });

    // The import (or re-export) of the bare name is itself a place the migration reaches.
    if (member === undefined) {
      for (const star of facts.stars.filter((candidate) => ours(candidate.specifier))) {
        lines.add(star.line);
      }

      for (const entry of facts.named.filter(
        (candidate) => candidate.imported === head && ours(candidate.specifier),
      )) {
        lines.add(entry.line);
      }
    }

    for (const use of facts.uses) {
      const binding = facts.bindings.find(
        (candidate) => candidate.local === use.local && ours(candidate.specifier),
      );

      if (binding === undefined) {
        continue;
      }

      // `ns.Name` and `ns.Name.member` read through a namespace import; a named import is read by its local name.
      const reached = binding.isNamespace ? use.member : binding.imported;
      const reachedMember = binding.isNamespace ? use.deeper : use.member;

      if (reached === head && (member === undefined || reachedMember === member)) {
        lines.add(use.line);
      }
    }

    return [...lines].sort((left, right) => left - right);
  }
}

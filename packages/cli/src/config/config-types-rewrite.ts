import { CodemodConstants } from './common/index.ts';
import type { TSourceFile, TTypeScript } from './format.ts';

const PACKAGE = '@venizia/vulcan';
/** The namespace of the group types: its name is the same before and after. */
const NAMESPACE = 'VulcanConfig';
const WHOLE = 'VulcanConfigType';
const GROUPS = ['Project', 'Agent', 'Guard', 'Board', 'Knowledge', 'Check', 'Common', 'Groups'];
/** The keys of the whole-file type that a grouped config has: any other key read from it belongs to the flat shape. */
const GROUP_KEYS = new Set(
  GROUPS.filter((group) => group !== 'Groups').map((group) => group.toLowerCase()),
);
const FLAT_NAMES: readonly [string, string][] = [
  ['TFlatConfig', 'TVulcanConfigInput'],
  ['TResolvedConfig', 'TVulcanConfigOutput'],
];

type TNode = Parameters<TTypeScript['forEachChild']>[0];
type TStatement = TSourceFile['statements'][number];

interface ISpan {
  start: number;
  end: number;
  text: string;
}

interface IImportBinding {
  imported: string;
  local: string;
  isAliased: boolean;
  isTypeModifier: boolean;
  /** The imported name, and the whole specifier. */
  name: TNode;
  specifier: TNode;
  siblings: readonly TNode[];
  statement: TNode;
}

/** A use of a local name: bare (`C`), or with the member read from it (`C.Board`). */
interface IReference {
  node: TNode;
  local: string;
  member?: { node: TNode; text: string };
  /** The key of an indexed access on a bare use (`C['board']`). */
  indexed?: string;
}

interface IFileNames {
  bindings: IImportBinding[];
  references: IReference[];
  /** The names the file declares, or imports from another module. */
  declared: Set<string>;
  exported: Set<string>;
  namespaceImports: Set<string>;
  notes: string[];
}

export interface IRewrite {
  text: string;
  count: number;
  /** What the file says that is left as written, one line each, without the path. */
  notes: string[];
}

/** The config type names of `@venizia/vulcan` in one file, rewritten from the earlier names to the new ones, or back. */
export class ConfigTypeRewriter {
  /** Whether a statement only imports the config types under their own names: what the earlier releases and this one write on top of a module. */
  static isTypeImport(opts: { typescript: TTypeScript; statement: TStatement }): boolean {
    const { typescript, statement } = opts;

    if (!typescript.isImportDeclaration(statement)) {
      return false;
    }

    const clause = statement.importClause;
    const named = clause?.namedBindings;

    return (
      typescript.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === PACKAGE &&
      clause !== undefined &&
      clause.name === undefined &&
      clause.isTypeOnly &&
      named !== undefined &&
      typescript.isNamedImports(named) &&
      named.elements.every(
        (element) =>
          element.propertyName === undefined &&
          (element.name.text === NAMESPACE || element.name.text === WHOLE),
      )
    );
  }

  static rewrite(opts: {
    typescript: TTypeScript;
    path: string;
    text: string;
    isReverse?: boolean;
  }): IRewrite {
    const { typescript } = opts;
    const source = typescript.createSourceFile(
      opts.path,
      opts.text,
      typescript.ScriptTarget.Latest,
      true,
      typescript.ScriptKind.TS,
    );
    const names = ConfigTypeRewriter.read({
      typescript,
      source,
      isReverse: opts.isReverse === true,
    });
    const planned = ConfigTypeRewriter.plan({ source, names, isReverse: opts.isReverse === true });

    if ('refusal' in planned) {
      return { text: opts.text, count: 0, notes: [...names.notes, planned.refusal] };
    }

    const text = [...planned.spans]
      .sort((left, right) => right.start - left.start)
      .reduce(
        (result, span) => `${result.slice(0, span.start)}${span.text}${result.slice(span.end)}`,
        opts.text,
      );

    return {
      text: planned.spans.length === 0 ? text : ConfigTypeRewriter.wrapExport({ text }),
      count: planned.spans.length,
      notes: [...names.notes, ...planned.notes],
    };
  }

  /** The `export default { a, b } satisfies X;` of a split config, one property a line once it passes the formatter's width. */
  static wrapExport(opts: { text: string }): string {
    return opts.text.replace(
      /^export default \{ ([\w, ]+) \} satisfies (\w+);$/m,
      (line: string, names: string, type: string) =>
        line.length <= CodemodConstants.LINE_WIDTH
          ? line
          : `export default {\n${names
              .split(', ')
              .map((name) => `  ${name},\n`)
              .join('')}} satisfies ${type};`,
    );
  }

  private static renamesOf(opts: { isReverse: boolean }): {
    whole: [string, string];
    flat: Map<string, string>;
    members: Map<string, string>;
    /** The member names that need no change. */
    done: Set<string>;
  } {
    const pairs = (list: readonly [string, string][]): [string, string][] =>
      list.map(([before, after]) => (opts.isReverse ? [after, before] : [before, after]));
    const members = pairs(GROUPS.map((group) => [group, `${group}Type`]));

    return {
      whole: opts.isReverse ? [WHOLE, NAMESPACE] : [NAMESPACE, WHOLE],
      flat: new Map(pairs(FLAT_NAMES)),
      members: new Map(members),
      done: new Set(members.map(([, after]) => after)),
    };
  }

  /** The imports from the package, every use of a name, and what cannot be rewritten. */
  private static read(opts: {
    typescript: TTypeScript;
    source: TSourceFile;
    isReverse: boolean;
  }): IFileNames {
    const { typescript, source } = opts;
    const renames = ConfigTypeRewriter.renamesOf({ isReverse: opts.isReverse });
    const old = new Set([renames.whole[0], ...renames.flat.keys()]);
    const found: IFileNames = {
      bindings: [],
      references: [],
      declared: new Set(),
      exported: new Set(),
      namespaceImports: new Set(),
      notes: [],
    };
    const isPackage = (node: TNode | undefined): boolean =>
      node !== undefined && typescript.isStringLiteral(node) && node.text === PACKAGE;
    const quote = (node: TNode): string => `\`${node.getText(source).split('\n')[0]}\``;

    const keyOf = (node: TNode): string | undefined => {
      const access = node.parent.parent;

      return typescript.isIndexedAccessTypeNode(access) &&
        access.objectType === node.parent &&
        typescript.isLiteralTypeNode(access.indexType) &&
        typescript.isStringLiteral(access.indexType.literal)
        ? access.indexType.literal.text
        : undefined;
    };

    const refer = (node: TNode, member?: TNode): void => {
      if (typescript.isIdentifier(node)) {
        found.references.push({
          node,
          local: node.text,
          indexed: member === undefined ? keyOf(node) : undefined,
          member:
            member !== undefined && typescript.isIdentifier(member)
              ? { node: member, text: member.text }
              : undefined,
        });
      }
    };

    const visit = (node: TNode): void => {
      if (typescript.isImportDeclaration(node)) {
        const clause = node.importClause;
        const named = clause?.namedBindings;
        const isOurs = isPackage(node.moduleSpecifier);

        if (clause?.name !== undefined) {
          found.declared.add(clause.name.text);
        }

        if (named !== undefined && typescript.isNamespaceImport(named)) {
          (isOurs ? found.namespaceImports : found.declared).add(named.name.text);
        } else if (named !== undefined && typescript.isNamedImports(named)) {
          for (const element of named.elements) {
            if (!isOurs) {
              found.declared.add(element.name.text);
              continue;
            }

            const imported = element.propertyName ?? element.name;

            found.bindings.push({
              imported: imported.text,
              local: element.name.text,
              isAliased: element.propertyName !== undefined,
              isTypeModifier: element.isTypeOnly,
              name: imported,
              specifier: element,
              siblings: named.elements,
              statement: node,
            });
          }
        }

        return;
      }

      if (typescript.isExportDeclaration(node)) {
        const clause = node.exportClause;

        if (clause !== undefined && typescript.isNamedExports(clause)) {
          for (const element of clause.elements) {
            const name = (element.propertyName ?? element.name).text;

            if (node.moduleSpecifier === undefined) {
              found.exported.add(name);
            } else if (isPackage(node.moduleSpecifier) && old.has(name)) {
              found.notes.push(
                `${quote(node)} is a re-export of ${name}: rename it by hand, with the files that read it`,
              );
            }
          }
        }

        return;
      }

      if (typescript.isImportTypeNode(node)) {
        const argument = node.argument;

        if (typescript.isLiteralTypeNode(argument) && isPackage(argument.literal)) {
          found.notes.push(`${quote(node)} reads a type through import(): check its name by hand`);
        }
      } else if (typescript.isTypeReferenceNode(node)) {
        refer(node.typeName);
      } else if (typescript.isQualifiedName(node)) {
        refer(node.left, node.right);
      } else if (typescript.isExpressionWithTypeArguments(node)) {
        refer(node.expression);
      } else if (typescript.isPropertyAccessExpression(node)) {
        refer(node.expression, node.name);
      } else if (
        (typescript.isTypeAliasDeclaration(node) ||
          typescript.isInterfaceDeclaration(node) ||
          typescript.isClassDeclaration(node) ||
          typescript.isEnumDeclaration(node) ||
          typescript.isModuleDeclaration(node) ||
          typescript.isTypeParameterDeclaration(node) ||
          typescript.isVariableDeclaration(node) ||
          typescript.isFunctionDeclaration(node)) &&
        node.name !== undefined &&
        typescript.isIdentifier(node.name)
      ) {
        found.declared.add(node.name.text);
      }

      typescript.forEachChild(node, visit);
    };

    typescript.forEachChild(source, visit);

    for (const { local, member, node } of found.references) {
      if (member !== undefined && found.namespaceImports.has(local) && old.has(member.text)) {
        found.notes.push(
          `\`${local}.${member.text}\` is read through \`import * as ${local}\`: rename it by hand (${quote(node.parent)})`,
        );
      }
    }

    return found;
  }

  /** The edits of a file, or why it is left whole: a name the rewrite needs is taken, or an imported name is exported again. */
  private static plan(opts: {
    source: TSourceFile;
    names: IFileNames;
    isReverse: boolean;
  }): { spans: ISpan[]; notes: string[] } | { refusal: string } {
    const { source, names } = opts;
    const { whole, flat, members, done } = ConfigTypeRewriter.renamesOf(opts);
    const [wholeBefore, wholeAfter] = whole;
    // A name bound twice has two sets of uses, and a second run would take the other one: the file is left to its owner.
    const twice = [NAMESPACE, wholeBefore, ...flat.keys()].find(
      (name) => names.bindings.filter((binding) => binding.imported === name).length > 1,
    );

    if (twice !== undefined) {
      return {
        refusal: `the file imports ${twice} twice, so nothing of it is changed: keep one import, then run the codemod again`,
      };
    }

    const spans: ISpan[] = [];
    const notes: string[] = [];
    const targets: string[] = [];
    const of = (imported: string): IImportBinding | undefined =>
      names.bindings.find((binding) => binding.imported === imported);
    const usesOf = (local: string): IReference[] =>
      names.references.filter((reference) => reference.local === local);

    const replace = (node: TNode, text: string): void => {
      spans.push({ start: node.getStart(source), end: node.getEnd(), text });
    };

    const bare = (local: string): IReference[] =>
      usesOf(local).filter((reference) => reference.member === undefined);

    // The specifier takes the new name; without an alias the uses take it too.
    const retarget = (binding: IImportBinding, name: string, uses: IReference[]): void => {
      const present = of(name);

      if (present !== undefined) {
        uses.forEach((use) => replace(use.node, present.local));
        spans.push(ConfigTypeRewriter.removalOf({ source, binding }));

        return;
      }

      targets.push(name);
      replace(binding.name, name);

      if (!binding.isAliased) {
        uses.forEach((use) => replace(use.node, name));
      }
    };

    for (const [before, after] of flat) {
      const binding = of(before);

      if (binding !== undefined) {
        retarget(binding, after, usesOf(binding.local));
      }
    }

    const namespace = of(NAMESPACE);
    const read = namespace === undefined ? [] : usesOf(namespace.local);
    const grouped = read.flatMap((reference) =>
      reference.member === undefined ? [] : [reference.member],
    );

    for (const member of grouped) {
      const renamed = members.get(member.text);

      if (renamed !== undefined) {
        replace(member.node, renamed);
      } else if (!done.has(member.text)) {
        notes.push(
          `\`${namespace?.local}.${member.text}\` is not a group type this codemod knows: check it by hand`,
        );
      }
    }

    const binding = of(wholeBefore);
    const uses = binding === undefined ? [] : bare(binding.local);
    const flatKey = opts.isReverse
      ? undefined
      : uses.map((use) => use.indexed).find((key) => key !== undefined && !GROUP_KEYS.has(key));

    if (flatKey !== undefined) {
      return {
        refusal: `\`${binding?.local}['${flatKey}']\` reads a key of the flat shape, so nothing of the file is changed: run \`config-groups\` first, which retypes it`,
      };
    }

    if (binding !== undefined && opts.isReverse) {
      retarget(binding, wholeAfter, uses);
    } else if (binding !== undefined && uses.length > 0) {
      if (grouped.length === 0) {
        retarget(binding, wholeAfter, uses);
      } else {
        // The namespace is still read: it stays, and the whole-file type is imported beside it.
        const present = of(wholeAfter);

        if (present === undefined) {
          targets.push(wholeAfter);
          spans.push({
            start: binding.specifier.getEnd(),
            end: binding.specifier.getEnd(),
            text: `, ${binding.isTypeModifier ? 'type ' : ''}${wholeAfter}`,
          });
        }

        uses.forEach((use) => replace(use.node, present?.local ?? wholeAfter));
      }
    }

    // An import exported again is read by other files, so its name is theirs to follow too.
    const exported = names.bindings.find(
      (entry) =>
        names.exported.has(entry.local) &&
        (entry.imported === wholeBefore || flat.has(entry.imported)),
    );

    if (exported !== undefined) {
      return {
        refusal: `the file exports ${exported.local} again, so nothing of it is changed: rename it by hand, with the files that read it`,
      };
    }

    if (spans.length === 0) {
      return { spans, notes };
    }

    const taken = [...targets, ...names.bindings.map((entry) => entry.local)].find((name) =>
      names.declared.has(name),
    );

    return taken === undefined
      ? { spans, notes }
      : {
          refusal: `the file has its own ${taken}, so nothing of it is changed: rename it, then run the codemod again`,
        };
  }

  /** A specifier with its comma, or the whole import when it is the only one. */
  private static removalOf(opts: { source: TSourceFile; binding: IImportBinding }): ISpan {
    const { source, binding } = opts;
    const { siblings, specifier, statement } = binding;
    const at = siblings.indexOf(specifier);

    if (siblings.length === 1) {
      const end = statement.getEnd();

      return {
        start: statement.getStart(source),
        end: source.text[end] === '\n' ? end + 1 : end,
        text: '',
      };
    }

    return at === 0
      ? { start: specifier.getStart(source), end: siblings[1].getStart(source), text: '' }
      : { start: siblings[at - 1].getEnd(), end: specifier.getEnd(), text: '' };
  }
}

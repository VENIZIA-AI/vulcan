import { posix } from 'node:path';
import { CodemodItemReader } from './codemod-items.ts';
import { ConfigConstants, ConfigKeyOrder, CodemodConstants } from './common/index.ts';
import type { ICodemodItem, IFileChange, TCodemodResult } from './common/index.ts';
import type { TSourceFile, TTypeScript } from './format.ts';
import { CodemodFoldReader } from './codemod-fold.ts';
import { ConfigTypeRewriter } from './config-types-rewrite.ts';

/** The markers of the block `vulcan package add` rewrites (`CreateConstants.APPS_BLOCK_START` begins with the first; the create layer imports this one, so it is not imported here). */
const APPS_BLOCK_START = '// vulcan:apps:start';
const APPS_BLOCK_END = '// vulcan:apps:end';

/** The type a group's module is checked against in a split config. */
const GROUP_TYPE: Readonly<Record<string, string>> = {
  project: 'VulcanConfig.ProjectType',
  agent: 'VulcanConfig.AgentType',
  guard: 'NonNullable<VulcanConfig.GuardType>',
  board: 'VulcanConfig.BoardType',
  knowledge: 'VulcanConfig.KnowledgeType',
  check: 'VulcanConfig.CheckType',
  common: 'VulcanConfig.CommonType',
};

/** `VulcanConfig['x']` of the modules the 0.5.0-7 and -8 scaffolds wrote, and the group type each is now. */
const TYPE_REWRITES: readonly [RegExp, string][] = [
  [/VulcanConfig\['claude'\]/g, "VulcanConfig.AgentType['claude']"],
  [/VulcanConfig\['doctor'\]/g, "VulcanConfig.CheckType['doctor']"],
  [/VulcanConfig\['okf'\]/g, "VulcanConfig.KnowledgeType['okf']"],
  [/VulcanConfig\['packages'\]/g, "VulcanConfig.ProjectType['packages']"],
];

/** The files of the grouped config, as one file or as one module per group. */
export class CodemodOutputBuilder {
  /** The groups of `items`, in order, each with its keys in order. */
  private static grouped(opts: {
    items: ICodemodItem[];
  }): { group: string; items: ICodemodItem[] }[] {
    return ConfigKeyOrder.GROUPS.filter((group) =>
      opts.items.some((item) => item.group === group),
    ).map((group) => ({
      group,
      items: opts.items
        .filter((item) => item.group === group)
        .sort(
          (left, right) =>
            ConfigKeyOrder.innerRankOf({ group, key: left.key }) -
            ConfigKeyOrder.innerRankOf({ group, key: right.key }),
        ),
    }));
  }

  /**
   * An item as lines, moved from the column it came from to `column`. `comment` is the comment a folded module had above its const:
   * it goes below the item's own comments. The first item of a group starts on its line, with no blank line after `{`.
   */
  private static render(opts: {
    item: ICodemodItem;
    column: number;
    body?: string;
    comment?: string;
    isFirst?: boolean;
  }): string {
    const by = opts.column - opts.item.column;
    let leading = CodemodItemReader.shift({ text: opts.item.leading, by, first: true });

    if (opts.comment !== undefined && opts.comment !== '') {
      const indent = ' '.repeat(opts.column);

      leading = `${leading.replace(/[ \t]*$/, '')}${opts.comment
        .split('\n')
        .map((line) => `${indent}${line.trim()}\n`)
        .join('')}${indent}`;
    }

    if (opts.isFirst === true) {
      leading = leading.replace(/^\n+/, '');
    }

    const body = CodemodItemReader.shift({ text: opts.body ?? opts.item.body, by, first: false });

    return `${leading}${body},${opts.item.trailing}`;
  }

  static singleOutput(opts: {
    opts: { read: (path: string) => string | undefined };
    typescript: TTypeScript;
    source: TSourceFile;
    items: ICodemodItem[];
    prefix: string;
    suffix: string;
  }): TCodemodResult {
    const parts: string[] = [];

    for (const { group, items } of CodemodOutputBuilder.grouped({ items: opts.items })) {
      if (group === 'guard') {
        parts.push(
          CodemodOutputBuilder.render({ item: items[0], column: CodemodConstants.TOP_COLUMN }),
        );
        continue;
      }

      parts.push(`  ${group}: {\n`);
      parts.push(
        ...items.map((item, index) =>
          CodemodOutputBuilder.render({
            item,
            column: CodemodConstants.GROUP_COLUMN,
            isFirst: index === 0,
          }),
        ),
      );
      parts.push('  },\n');
    }

    const changes: IFileChange[] = [
      { path: CodemodConstants.CONFIG_PATH, text: `${opts.prefix}${parts.join('')}${opts.suffix}` },
    ];
    const notes = [`${CodemodConstants.CONFIG_PATH}: the keys are in the seven groups`];

    const modules = CodemodOutputBuilder.moduleFiles({
      typescript: opts.typescript,
      source: opts.source,
      read: opts.opts.read,
    });

    for (const path of modules) {
      const old = opts.opts.read(path) ?? '';
      const next = TYPE_REWRITES.reduce((text, [pattern, to]) => text.replace(pattern, to), old);

      if (next !== old) {
        changes.push({ path, text: next });
        notes.push(`${path}: its type is the group's`);
      }
    }

    return { ok: true, changes, notes };
  }

  /** The files of `.configs/vulcan/` the config reaches through its imports and re-exports, however many files on the way. */
  static moduleFiles(opts: {
    typescript: TTypeScript;
    source: TSourceFile;
    read: (path: string) => string | undefined;
  }): string[] {
    const { typescript } = opts;
    const found = new Set(
      CodemodOutputBuilder.importedModules({
        typescript,
        source: opts.source,
        path: CodemodConstants.CONFIG_PATH,
      }),
    );

    // A set visits what is added while it is walked, and never a file twice.
    for (const path of found) {
      const source = typescript.createSourceFile(
        path,
        opts.read(path) ?? '',
        typescript.ScriptTarget.Latest,
        true,
        typescript.ScriptKind.TS,
      );

      for (const target of CodemodOutputBuilder.importedModules({ typescript, source, path })) {
        found.add(target);
      }
    }

    return [...found].filter((path) => opts.read(path) !== undefined);
  }

  /** The files of `.configs/vulcan/` a module names in an `import` or an `export ... from`. */
  private static importedModules(opts: {
    typescript: TTypeScript;
    source: TSourceFile;
    path: string;
  }): string[] {
    const { typescript } = opts;

    return opts.source.statements.flatMap((statement) => {
      const specifier =
        typescript.isImportDeclaration(statement) || typescript.isExportDeclaration(statement)
          ? statement.moduleSpecifier
          : undefined;

      if (specifier === undefined || !typescript.isStringLiteral(specifier)) {
        return [];
      }

      const target = posix.join(posix.dirname(opts.path), specifier.text);

      return specifier.text.startsWith('.') && CodemodFoldReader.isContained({ path: target })
        ? [target]
        : [];
    });
  }

  static splitOutput(opts: {
    opts: { read: (path: string) => string | undefined };
    typescript: TTypeScript;
    source: TSourceFile;
    items: ICodemodItem[];
  }): TCodemodResult {
    const { typescript, source } = opts;
    const imports = source.statements.filter((statement) =>
      typescript.isImportDeclaration(statement),
    );
    // The `vulcan:apps` block (what `vulcan package add` rewrites) moves, whole, to `project.mts` as `export const apps`.
    const markerStart = source.text.indexOf(APPS_BLOCK_START);
    const markerEnd = source.text.indexOf(APPS_BLOCK_END);
    const hasBlock = markerStart !== -1 && markerEnd > markerStart;
    const blockEnd = hasBlock ? markerEnd + APPS_BLOCK_END.length : -1;
    const inBlock = (statement: (typeof source.statements)[number]): boolean =>
      hasBlock && statement.getStart(source) >= markerStart && statement.end <= blockEnd;
    const others = source.statements.filter(
      (statement) =>
        !typescript.isImportDeclaration(statement) &&
        !typescript.isExportAssignment(statement) &&
        !inBlock(statement),
    );
    const blockText = hasBlock ? source.text.slice(markerStart, blockEnd) : undefined;

    if (blockText !== undefined && !/^\s*const apps = /m.test(blockText)) {
      return {
        ok: false,
        reason:
          'the `vulcan:apps` block does not declare `const apps`: fix the block by hand, then run the codemod again',
      };
    }

    if (others.length > 0) {
      return {
        ok: false,
        reason: `the file has a statement besides imports and \`export default\` (\`${others[0].getText(source).split('\n')[0].slice(0, 60)}\`): move it by hand before the groups become modules`,
      };
    }

    const bindings = new Map<
      string,
      { statement: string; specifier: string; name: string; isConfigType: boolean }
    >();

    for (const statement of imports) {
      const specifier = typescript.isStringLiteral(statement.moduleSpecifier)
        ? statement.moduleSpecifier.text
        : '';
      const clause = statement.importClause;
      const names: string[] = [];

      if (clause?.name !== undefined) {
        names.push(clause.name.text);
      }

      const named = clause?.namedBindings;

      if (named !== undefined && typescript.isNamedImports(named)) {
        names.push(...named.elements.map((element) => element.name.text));
      } else if (named !== undefined) {
        names.push(named.name.text);
      }

      for (const name of names) {
        bindings.set(name, {
          statement: statement.getText(source),
          specifier,
          name,
          isConfigType: ConfigTypeRewriter.isTypeImport({ typescript, statement }),
        });
      }
    }

    const folded = new Set<string>();
    const barrels = new Set<string>();
    const foldedNames = new Set<string>();
    const changes: IFileChange[] = [];
    const written: string[] = [];
    const exports: string[] = [];

    for (const { group, items } of CodemodOutputBuilder.grouped({ items: opts.items })) {
      const bodies = new Map<ICodemodItem, { body: string; comment: string }>();

      for (const item of items) {
        const binding = item.identifier === undefined ? undefined : bindings.get(item.identifier);

        if (
          binding === undefined ||
          !CodemodOutputBuilder.isModule({ specifier: binding.specifier })
        ) {
          continue;
        }

        const value = CodemodFoldReader.moduleValue({
          typescript,
          read: opts.opts.read,
          path: posix.join(ConfigConstants.DIRECTORY, binding.specifier),
          name: binding.name,
          folded,
          barrels,
          depth: 0,
        });

        if ('reason' in value) {
          return { ok: false, reason: `\`${item.key}\`: ${value.reason}` };
        }

        foldedNames.add(binding.name);
        bodies.set(item, {
          body: `${item.key}: ${CodemodItemReader.shift({ text: value.text, by: CodemodConstants.MODULE_COLUMN, first: false })}`,
          comment: value.comment,
        });
      }

      const used = [...bindings.values()].filter(
        (binding) =>
          !CodemodOutputBuilder.isModule({ specifier: binding.specifier }) &&
          !binding.isConfigType &&
          items.some((item) =>
            new RegExp(`\\b${binding.name}\\b`).test(`${bodies.get(item)?.body ?? item.body}`),
          ),
      );
      const isUsingApps =
        blockText !== undefined &&
        group !== 'project' &&
        items.some((item) =>
          CodemodOutputBuilder.readsApps({ text: bodies.get(item)?.body ?? item.body }),
        );
      const lines = [
        "import type { VulcanConfig } from '@venizia/vulcan';",
        ...(isUsingApps ? ["import { apps } from './project.mts';"] : []),
        ...[
          ...new Set(
            used.map((binding) => CodemodOutputBuilder.carried({ statement: binding.statement })),
          ),
        ],
        '',
      ];

      if (group === 'project' && blockText !== undefined) {
        lines.push(blockText.replace(/^(\s*)const apps = /m, '$1export const apps = '), '');
      }

      if (group === 'guard') {
        const [only] = items;

        const comment = CodemodItemReader.shift({
          text: only.leading,
          by: -CodemodConstants.TOP_COLUMN,
          first: true,
        }).trimEnd();

        lines.push(
          `${comment === '' ? '' : `${comment}\n`}export const guard = ${CodemodItemReader.shift({ text: only.value ?? 'undefined', by: -CodemodConstants.TOP_COLUMN, first: false })} satisfies ${GROUP_TYPE[group]};`,
        );
      } else {
        lines.push(`export const ${group} = {`);
        lines.push(
          ...items.map((item, index) =>
            CodemodOutputBuilder.render({
              item,
              column: CodemodConstants.MODULE_COLUMN,
              body: bodies.get(item)?.body,
              comment: bodies.get(item)?.comment,
              isFirst: index === 0,
            }).replace(/\n$/, ''),
          ),
        );
        lines.push(`} satisfies ${GROUP_TYPE[group]};`);
      }

      const path = `${CodemodConstants.MODULES_DIRECTORY}/${group}.mts`;
      const next = `${lines.join('\n')}\n`;
      const existing = opts.opts.read(path);

      // A file that is already there and is not what this run writes is somebody's: it is never overwritten.
      if (existing !== undefined && existing !== next) {
        return {
          ok: false,
          reason: `${path} exists and is not one of the modules this run folds: move it away or merge it by hand, then run the codemod again`,
        };
      }

      changes.push({ path, text: next });
      written.push(group);
      exports.push(`export { ${group} } from './${group}.mts';`);
    }

    if (blockText !== undefined && !written.includes('project')) {
      return {
        ok: false,
        reason:
          'the `vulcan:apps` block has no `project` group to sit in: add `project: { ... }` that reads it, then run the codemod again',
      };
    }

    const index =
      CodemodFoldReader.indexRefusal({
        typescript,
        text: opts.opts.read(`${CodemodConstants.MODULES_DIRECTORY}/index.mts`),
        folded: foldedNames,
      }) ??
      CodemodFoldReader.barrelRefusal({
        typescript,
        read: opts.opts.read,
        barrels: new Set([`${CodemodConstants.MODULES_DIRECTORY}/index.mts`, ...barrels]),
        folded,
      });

    if (index !== undefined) {
      return { ok: false, reason: index };
    }

    const first = source.statements[0];
    const exported = source.statements.find((statement) =>
      typescript.isExportAssignment(statement),
    );
    // The comment text of a range, without what lies between the block's markers (they travel with the block to `project.mts`).
    const outsideBlock = (range: { from: number; to: number }): string =>
      !hasBlock
        ? source.text.slice(range.from, range.to)
        : [
            range.from < markerStart
              ? source.text.slice(range.from, Math.min(range.to, markerStart))
              : '',
            range.to > blockEnd ? source.text.slice(Math.max(range.from, blockEnd), range.to) : '',
          ]
            .map((part) => part.trim())
            .filter((part) => part !== '')
            .join('\n');
    const trivia = (statement: typeof first | undefined): string =>
      statement === undefined
        ? ''
        : outsideBlock({
            from: statement.getFullStart(),
            to: statement.getStart(source),
          }).trim();
    // The comment at the top of the file, and the one above `export default` when it is not the same.
    const header = trivia(first);
    const above = exported === first ? '' : trivia(exported);

    changes.unshift({
      path: CodemodConstants.CONFIG_PATH,
      text: ConfigTypeRewriter.wrapExport({
        text: `${header === '' ? '' : `${header}\n`}import type { VulcanConfigType } from '@venizia/vulcan';\nimport { ${written.join(', ')} } from './vulcan/index.mts';\n\n${above === '' ? '' : `${above}\n`}export default { ${ConfigKeyOrder.GROUPS.filter((group) => written.includes(group)).join(', ')} } satisfies VulcanConfigType;\n`,
      }),
    });
    changes.push({
      path: `${CodemodConstants.MODULES_DIRECTORY}/index.mts`,
      text: `${exports.join('\n')}\n`,
    });

    for (const path of folded) {
      if (!changes.some((change) => change.path === path)) {
        changes.push({ path });
      }
    }

    return {
      ok: true,
      changes,
      notes: [
        `${CodemodConstants.CONFIG_PATH}: composes the groups from ${CodemodConstants.MODULES_DIRECTORY}/`,
        ...written.map((group) => `${CodemodConstants.MODULES_DIRECTORY}/${group}.mts`),
        ...changes
          .filter((change) => change.text === undefined)
          .map((change) => `${change.path}: folded into the groups, deleted`),
      ],
    };
  }

  /** Whether the text refers to the identifier `apps`: not the word inside a string, a comment or after a dot. */
  private static readsApps(opts: { text: string }): boolean {
    const bare = opts.text
      .replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '')
      .replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, '""');

    return /(?<![.\w$])apps\b(?!\s*:)/.test(bare);
  }

  private static isModule(opts: { specifier: string }): boolean {
    return opts.specifier.startsWith('./vulcan/');
  }

  /** An import of the config as it reads from a module one folder deeper. */
  private static carried(opts: { statement: string }): string {
    return opts.statement.replace(
      /(from\s+)(['"])(\.{1,2}\/)/,
      (_match, from: string, quote: string, dots: string) =>
        `${from}${quote}${dots === './' ? '../' : '../../'}`,
    );
  }
}

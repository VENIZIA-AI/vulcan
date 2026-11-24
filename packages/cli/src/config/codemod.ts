import { posix } from 'node:path';
import { TypeScriptCompiler } from '@venizia/vulcan-atlas';
import { ConfigConstants, ConfigKeyOrder } from './common/index.ts';
import { ConfigFormat } from './format.ts';
import type {
  IPropertySegment,
  TObjectElement,
  TObjectLiteral,
  TSourceFile,
  TTypeScript,
} from './format.ts';
import { ConfigGroups } from './groups.ts';

/** One file the codemod writes (`text`) or deletes (no `text`), by path relative to the project root. */
export interface IFileChange {
  path: string;
  text?: string;
}

export type TCodemodResult =
  | { ok: true; changes: IFileChange[]; notes: string[] }
  | { ok: false; reason: string };

/** A property of the config, cut into the text that moves with it, and where it goes. */
interface IItem {
  group: string;
  key: string;
  leading: string;
  /** The text from the property's first token to its end, without the comma (`key: value` or a shorthand). */
  body: string;
  /** The text after the comma up to the end of the line: a trailing comment and the line break. */
  trailing: string;
  /** The column the property started at in the file it came from. */
  column: number;
  /** The value alone, for a property that is the whole group (`guard`), or the identifier a shorthand names. */
  value?: string;
  /** The identifier the value is, when it is one (a module of the old split). */
  identifier?: string;
}

/** What the old flat keys become: the group and the key inside it. `project`, `doctor`, `knowledge`, `guard` and `remove` are handled apart. */
const PLACE: Readonly<Record<string, { group: string; key: string }>> = {
  name: { group: 'project', key: 'name' },
  layout: { group: 'project', key: 'layout' },
  packages: { group: 'project', key: 'packages' },
  presets: { group: 'project', key: 'presets' },
  agents: { group: 'agent', key: 'list' },
  packs: { group: 'agent', key: 'packs' },
  rules: { group: 'agent', key: 'rules' },
  digest: { group: 'agent', key: 'digest' },
  owner: { group: 'agent', key: 'owner' },
  claude: { group: 'agent', key: 'claude' },
  events: { group: 'board', key: 'events' },
  board: { group: 'board', key: 'page' },
  provider: { group: 'board', key: 'provider' },
  commit: { group: 'check', key: 'commit' },
  okf: { group: 'knowledge', key: 'okf' },
  atlas: { group: 'knowledge', key: 'atlas' },
  theme: { group: 'common', key: 'theme' },
  local: { group: 'common', key: 'local' },
};

/** The type a group's module is checked against in a split config. */
const GROUP_TYPE: Readonly<Record<string, string>> = {
  project: 'VulcanConfig.Project',
  agent: 'VulcanConfig.Agent',
  guard: 'NonNullable<VulcanConfig.Guard>',
  board: 'VulcanConfig.Board',
  knowledge: 'VulcanConfig.Knowledge',
  check: 'VulcanConfig.Check',
  common: 'VulcanConfig.Common',
};

/** `VulcanConfig['x']` of the modules the 0.5.0-7 and -8 scaffolds wrote, and the group type each is now. */
const TYPE_REWRITES: readonly [RegExp, string][] = [
  [/VulcanConfig\['claude'\]/g, "VulcanConfig.Agent['claude']"],
  [/VulcanConfig\['doctor'\]/g, "VulcanConfig.Check['doctor']"],
  [/VulcanConfig\['okf'\]/g, "VulcanConfig.Knowledge['okf']"],
  [/VulcanConfig\['packages'\]/g, "VulcanConfig.Project['packages']"],
];

const CONFIG_PATH = `${ConfigConstants.DIRECTORY}/${ConfigConstants.FILE}`;
const MODULES_DIRECTORY = `${ConfigConstants.DIRECTORY}/vulcan`;
/** Where the properties sit in a group (inside `group: {`) and in a group module (inside `export const group = {`). */
const GROUP_COLUMN = 4;
const MODULE_COLUMN = 2;
const TOP_COLUMN = 2;

/** `text` with every line moved `by` columns (negative: that many leading spaces taken off); the first line only when `first`. */
const shift = (opts: { text: string; by: number; first: boolean }): string => {
  if (opts.by === 0) {
    return opts.text;
  }

  return opts.text
    .split('\n')
    .map((line, index) => {
      if (line === '' || (index === 0 && !opts.first)) {
        return line;
      }

      return opts.by > 0
        ? `${' '.repeat(opts.by)}${line}`
        : line.replace(new RegExp(`^ {0,${-opts.by}}`), '');
    })
    .join('\n');
};

/**
 * The seven-group shape of a config file, from the flat one (the codemod `config-groups` of `vulcan config codemod`). The file is
 * read as text with TypeScript and never run: every value, comment and import stays as written; the properties move into their
 * groups, in the order of `ConfigKeyOrder`. With `split`, each group becomes a module `.configs/vulcan/<group>.mts` that the config
 * composes, and the modules of the old split are folded into them. A file the codemod cannot move without losing something is
 * refused with the reason, and nothing is written.
 */
export class ConfigCodemod {
  static readonly NAME = 'config-groups';

  static run(opts: {
    root: string;
    /** The text of a file by path relative to `root`, or `undefined` when it is not there. */
    read: (path: string) => string | undefined;
    split?: boolean;
    reverse?: boolean;
  }): TCodemodResult {
    const text = opts.read(CONFIG_PATH);

    if (text === undefined) {
      return { ok: true, changes: [], notes: [`no ${CONFIG_PATH}: nothing to do`] };
    }

    const typescript = TypeScriptCompiler.load({ from: opts.root });
    const source = typescript.createSourceFile(
      ConfigConstants.FILE,
      text,
      typescript.ScriptTarget.Latest,
      true,
      typescript.ScriptKind.TS,
    );
    const found = ConfigFormat.findObject({ typescript, source });

    if ('reason' in found) {
      return { ok: false, reason: found.reason };
    }

    const keys: string[] = [];

    for (const property of found.object.properties) {
      const key = ConfigFormat.keyOf({ typescript, property });

      if (typeof key !== 'string') {
        return { ok: false, reason: key.reason };
      }

      keys.push(key);
    }

    if (keys.length === 0) {
      return { ok: true, changes: [], notes: ['the config has no key: nothing to do'] };
    }

    const cut = ConfigFormat.cut({ typescript, source, object: found.object, keys });

    if ('reason' in cut) {
      return { ok: false, reason: cut.reason };
    }

    const context = { typescript, source, object: found.object, keys, segments: cut.segments };
    const isFlat = ConfigKeyOrder.isFlatShape({ keys });

    if (opts.reverse === true) {
      return isFlat
        ? { ok: true, changes: [], notes: ['the config is flat already: nothing to do'] }
        : ConfigCodemod.reverse({ ...context, prefix: cut.prefix, suffix: cut.suffix });
    }

    if (!isFlat && opts.split !== true) {
      return { ok: true, changes: [], notes: ['the config is in groups already: nothing to do'] };
    }

    const items = isFlat
      ? ConfigCodemod.itemsOfFlat(context)
      : ConfigCodemod.itemsOfGrouped(context);

    if ('reason' in items) {
      return { ok: false, reason: items.reason };
    }

    return opts.split === true
      ? ConfigCodemod.splitOutput({ opts, typescript, source, items: items.items })
      : ConfigCodemod.singleOutput({
          opts,
          items: items.items,
          prefix: cut.prefix,
          suffix: cut.suffix,
        });
  }

  // ----- the items -----

  private static itemsOfFlat(opts: {
    typescript: TTypeScript;
    source: TSourceFile;
    object: TObjectLiteral;
    keys: string[];
    segments: IPropertySegment[];
  }): { items: IItem[] } | { reason: string } {
    const { typescript, source } = opts;
    const items: IItem[] = [];
    const has = (key: string): boolean => opts.keys.includes(key);

    for (const [index, property] of opts.object.properties.entries()) {
      const key = opts.keys[index];
      const segment = opts.segments[index];
      const column = TOP_COLUMN;
      const base = { leading: segment.leading, trailing: segment.trailing, column };
      const literal = ConfigCodemod.literalOf({ typescript, property });

      if (key === 'guard') {
        items.push({
          group: 'guard',
          key,
          ...base,
          body: segment.body,
          value: ConfigCodemod.valueOf({ typescript, source, property }),
        });
        continue;
      }

      if (key === 'project') {
        const inner =
          literal === undefined
            ? undefined
            : ConfigCodemod.innerItems({ typescript, source, literal });

        if (inner === undefined || 'reason' in inner) {
          return {
            reason: `\`project\` is not an object literal the codemod can open${inner === undefined ? '' : `: ${inner.reason}`}`,
          };
        }

        items.push(...ConfigCodemod.carrying({ group: 'project', inner: inner.items, segment }));
        continue;
      }

      if (key === 'knowledge') {
        if (literal === undefined) {
          if (has('okf') || has('atlas')) {
            return {
              reason:
                '`knowledge` is not an object literal and `okf` or `atlas` has to join it: write `knowledge` as a literal first',
            };
          }

          items.push({ group: 'knowledge', key, ...base, body: segment.body });
          continue;
        }

        const inner = ConfigCodemod.innerItems({ typescript, source, literal });

        if ('reason' in inner) {
          return { reason: inner.reason };
        }

        items.push(...ConfigCodemod.carrying({ group: 'knowledge', inner: inner.items, segment }));
        continue;
      }

      if (key === 'doctor') {
        const layout = literal?.properties.some(
          (entry) => ConfigFormat.keyOf({ typescript, property: entry }) === 'layout',
        );

        if (layout === true) {
          return {
            reason:
              '`doctor` has a `layout` key: it is `check.layout` now; move it out of `doctor` by hand, then run the codemod',
          };
        }

        items.push({
          group: 'check',
          key,
          ...base,
          ...ConfigCodemod.bodyOf({ typescript, source, property }),
        });
        continue;
      }

      if (key === 'remove') {
        items.push({
          group: 'common',
          key,
          ...base,
          body: ConfigCodemod.removeBody({ typescript, source, property }),
        });
        continue;
      }

      const place = PLACE[key];

      if (place === undefined) {
        return { reason: `\`${key}\` is not a key of the config: fix it first (a typo?)` };
      }

      items.push({
        ...place,
        ...base,
        ...ConfigCodemod.bodyOf({
          typescript,
          source,
          property,
          rename: place.key === key ? undefined : place.key,
        }),
      });
    }

    return { items };
  }

  private static itemsOfGrouped(opts: {
    typescript: TTypeScript;
    source: TSourceFile;
    object: TObjectLiteral;
    keys: string[];
    segments: IPropertySegment[];
  }): { items: IItem[] } | { reason: string } {
    const { typescript, source } = opts;
    const items: IItem[] = [];

    for (const [index, property] of opts.object.properties.entries()) {
      const group = opts.keys[index];
      const segment = opts.segments[index];

      if (group === 'guard') {
        items.push({
          group,
          key: group,
          leading: segment.leading,
          body: segment.body,
          trailing: segment.trailing,
          column: TOP_COLUMN,
          value: ConfigCodemod.valueOf({ typescript, source, property }),
        });
        continue;
      }

      const literal = ConfigCodemod.literalOf({ typescript, property });

      if (literal === undefined) {
        return {
          reason: `\`${group}\` is not an object literal: it is a module or a variable already`,
        };
      }

      const inner = ConfigCodemod.innerItems({ typescript, source, literal });

      if ('reason' in inner) {
        return { reason: `in \`${group}\`: ${inner.reason}` };
      }

      items.push(...inner.items.map((entry) => ({ group, ...entry })));
    }

    return { items };
  }

  /**
   * The items of a property that is opened into its group (`project: { key }`, `knowledge: { ... }`): the comment above the property
   * goes above its first key, and one after its comma goes after its last, so a comment is never lost with the braces.
   */
  private static carrying(opts: {
    group: string;
    inner: Omit<IItem, 'group'>[];
    segment: IPropertySegment;
  }): IItem[] {
    // The comment lines at the column of the keys; the indentation that ends `leading` is the key's own, which the first key brings.
    const above = shift({
      text: opts.segment.leading,
      by: GROUP_COLUMN - TOP_COLUMN,
      first: true,
    }).replace(/[ \t]*$/, '');
    const after = opts.segment.trailing.replace(/^[ \t]*(?:\n)?$/, '').trim();

    return opts.inner.map((entry, index) => ({
      group: opts.group,
      ...entry,
      leading:
        index === 0 && opts.segment.leading.trim() !== ''
          ? `${above}${entry.leading}`
          : entry.leading,
      trailing:
        index === opts.inner.length - 1 && after !== ''
          ? `${entry.trailing.replace(/\n$/, '')} ${after}\n`
          : entry.trailing,
    }));
  }

  /** The properties of an object literal as items without a group: each with its comments. */
  private static innerItems(opts: {
    typescript: TTypeScript;
    source: TSourceFile;
    literal: TObjectLiteral;
  }): { items: Omit<IItem, 'group'>[] } | { reason: string } {
    const keys: string[] = [];

    for (const property of opts.literal.properties) {
      const key = ConfigFormat.keyOf({ typescript: opts.typescript, property });

      if (typeof key !== 'string') {
        return { reason: key.reason };
      }

      keys.push(key);
    }

    const literalText = opts.literal.getText(opts.source);

    // An object on one line (`{ key: 'ACME' }`) has no lines to carry comments: each property becomes a line of its own.
    if (!literalText.includes('\n')) {
      if (/\/\/|\/\*/.test(literalText)) {
        return { reason: 'an object on one line holds a comment: put each key on its own line' };
      }

      return {
        items: opts.literal.properties.map((property, index) => ({
          key: keys[index],
          leading: ' '.repeat(GROUP_COLUMN),
          trailing: '\n',
          column: GROUP_COLUMN,
          ...ConfigCodemod.bodyOf({ typescript: opts.typescript, source: opts.source, property }),
        })),
      };
    }

    const cut = ConfigFormat.cut({
      typescript: opts.typescript,
      source: opts.source,
      object: opts.literal,
      keys,
    });

    if ('reason' in cut) {
      return { reason: cut.reason };
    }

    return {
      items: cut.segments.map((segment, index) => ({
        key: segment.key,
        leading: segment.leading,
        trailing: segment.trailing,
        column: GROUP_COLUMN,
        ...ConfigCodemod.bodyOf({
          typescript: opts.typescript,
          source: opts.source,
          property: opts.literal.properties[index],
        }),
      })),
    };
  }

  private static literalOf(opts: {
    typescript: TTypeScript;
    property: TObjectElement;
  }): TObjectLiteral | undefined {
    const { typescript, property } = opts;

    return typescript.isPropertyAssignment(property) &&
      typescript.isObjectLiteralExpression(property.initializer)
      ? property.initializer
      : undefined;
  }

  /** The text of the value of a property: what follows `key:`, or the name of a shorthand. */
  private static valueOf(opts: {
    typescript: TTypeScript;
    source: TSourceFile;
    property: TObjectElement;
  }): string {
    const { typescript, source, property } = opts;

    return typescript.isPropertyAssignment(property)
      ? property.initializer.getText(source)
      : typescript.isShorthandPropertyAssignment(property)
        ? property.name.text
        : property.getText(source);
  }

  /**
   * A property's text and, when its value is a plain identifier (a module of the old split), that identifier. A rename changes the
   * key (`agents: [...]` is `list: [...]`; a shorthand `agents,` is `list: agents`).
   */
  private static bodyOf(opts: {
    typescript: TTypeScript;
    source: TSourceFile;
    property: TObjectElement;
    rename?: string;
  }): { body: string; identifier?: string } {
    const { typescript, source, property } = opts;
    const text = source.text.slice(property.getStart(source), property.end);
    const identifier = typescript.isShorthandPropertyAssignment(property)
      ? property.name.text
      : typescript.isPropertyAssignment(property) && typescript.isIdentifier(property.initializer)
        ? property.initializer.text
        : undefined;
    const idPart = identifier === undefined ? {} : { identifier };

    if (opts.rename === undefined) {
      return { body: text, ...idPart };
    }

    if (typescript.isShorthandPropertyAssignment(property)) {
      return { body: `${opts.rename}: ${property.name.text}`, ...idPart };
    }

    const name = (property as { name?: { getStart: (source: TSourceFile) => number; end: number } })
      .name;

    if (name === undefined) {
      return { body: text, ...idPart };
    }

    const start = name.getStart(source) - property.getStart(source);
    const end = name.end - property.getStart(source);

    return { body: `${text.slice(0, start)}${opts.rename}${text.slice(end)}`, ...idPart };
  }

  /** `remove`'s property with each key (a flat path) written as its group path. */
  private static removeBody(opts: {
    typescript: TTypeScript;
    source: TSourceFile;
    property: TObjectElement;
  }): string {
    const { typescript, source, property } = opts;
    const text = source.text.slice(property.getStart(source), property.end);

    if (
      !typescript.isPropertyAssignment(property) ||
      !typescript.isObjectLiteralExpression(property.initializer)
    ) {
      return text;
    }

    const base = property.getStart(source);
    const edits = property.initializer.properties.flatMap((entry) => {
      const name = entry.name;

      return name !== undefined && typescript.isStringLiteral(name)
        ? [{ start: name.getStart(source) - base, end: name.end - base, path: name.text }]
        : [];
    });
    let out = text;

    for (const edit of edits.sort((left, right) => right.start - left.start)) {
      out = `${out.slice(0, edit.start)}'${ConfigGroups.groupedPathOf({ path: edit.path })}'${out.slice(edit.end)}`;
    }

    return out;
  }

  // ----- the output -----

  /** The groups of `items`, in order, each with its keys in order. */
  private static grouped(opts: { items: IItem[] }): { group: string; items: IItem[] }[] {
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

  /** An item as lines, moved from the column it came from to `column`. */
  private static render(opts: { item: IItem; column: number; body?: string }): string {
    const by = opts.column - opts.item.column;
    const leading = shift({ text: opts.item.leading, by, first: true });
    const body = shift({ text: opts.body ?? opts.item.body, by, first: false });

    return `${leading}${body},${opts.item.trailing}`;
  }

  private static singleOutput(opts: {
    opts: { read: (path: string) => string | undefined };
    items: IItem[];
    prefix: string;
    suffix: string;
  }): TCodemodResult {
    const parts: string[] = [];

    for (const { group, items } of ConfigCodemod.grouped({ items: opts.items })) {
      if (group === 'guard') {
        parts.push(ConfigCodemod.render({ item: items[0], column: TOP_COLUMN }));
        continue;
      }

      parts.push(`  ${group}: {\n`);
      parts.push(...items.map((item) => ConfigCodemod.render({ item, column: GROUP_COLUMN })));
      parts.push('  },\n');
    }

    const changes: IFileChange[] = [
      { path: CONFIG_PATH, text: `${opts.prefix}${parts.join('')}${opts.suffix}` },
    ];
    const notes = [`${CONFIG_PATH}: the keys are in the seven groups`];

    for (const path of ConfigCodemod.moduleFiles({ read: opts.opts.read })) {
      const old = opts.opts.read(path) ?? '';
      const next = TYPE_REWRITES.reduce((text, [pattern, to]) => text.replace(pattern, to), old);

      if (next !== old) {
        changes.push({ path, text: next });
        notes.push(`${path}: its type is the group's`);
      }
    }

    return { ok: true, changes, notes };
  }

  /** The modules of a split config the 0.5.0 scaffolds wrote: the ones the codemod knows by name, and any other `.mts` the config imports from `.configs/vulcan/`. */
  private static moduleFiles(opts: { read: (path: string) => string | undefined }): string[] {
    return ['claude', 'doctor', 'okf', 'packages', 'index']
      .map((name) => `${MODULES_DIRECTORY}/${name}.mts`)
      .filter((path) => opts.read(path) !== undefined);
  }

  private static splitOutput(opts: {
    opts: { read: (path: string) => string | undefined };
    typescript: TTypeScript;
    source: TSourceFile;
    items: IItem[];
  }): TCodemodResult {
    const { typescript, source } = opts;
    const imports = source.statements.filter((statement) =>
      typescript.isImportDeclaration(statement),
    );
    const others = source.statements.filter(
      (statement) =>
        !typescript.isImportDeclaration(statement) && !typescript.isExportAssignment(statement),
    );

    if (others.length > 0) {
      return {
        ok: false,
        reason: `the file has a statement besides imports and \`export default\` (\`${others[0].getText(source).split('\n')[0].slice(0, 60)}\`): move it by hand before the groups become modules`,
      };
    }

    const bindings = new Map<string, { statement: string; specifier: string; name: string }>();

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
        bindings.set(name, { statement: statement.getText(source), specifier, name });
      }
    }

    const folded = new Set<string>();
    const changes: IFileChange[] = [];
    const written: string[] = [];
    const exports: string[] = [];

    for (const { group, items } of ConfigCodemod.grouped({ items: opts.items })) {
      const bodies = new Map<IItem, string>();

      for (const item of items) {
        const binding = item.identifier === undefined ? undefined : bindings.get(item.identifier);

        if (binding === undefined || !ConfigCodemod.isModule({ specifier: binding.specifier })) {
          continue;
        }

        const value = ConfigCodemod.moduleValue({
          typescript,
          read: opts.opts.read,
          path: posix.join(ConfigConstants.DIRECTORY, binding.specifier),
          name: binding.name,
          folded,
          depth: 0,
        });

        if ('reason' in value) {
          return { ok: false, reason: `\`${item.key}\`: ${value.reason}` };
        }

        bodies.set(
          item,
          `${item.key}: ${shift({ text: value.text, by: MODULE_COLUMN, first: false })}`,
        );
      }

      const used = [...bindings.values()].filter(
        (binding) =>
          !ConfigCodemod.isModule({ specifier: binding.specifier }) &&
          !ConfigCodemod.isVulcanType({ statement: binding.statement }) &&
          items.some((item) =>
            new RegExp(`\\b${binding.name}\\b`).test(`${bodies.get(item) ?? item.body}`),
          ),
      );
      const lines = [
        "import type { VulcanConfig } from '@venizia/vulcan';",
        ...[
          ...new Set(
            used.map((binding) => ConfigCodemod.carried({ statement: binding.statement })),
          ),
        ],
        '',
      ];

      if (group === 'guard') {
        const [only] = items;

        lines.push(
          `export const guard = ${shift({ text: only.value ?? 'undefined', by: -TOP_COLUMN, first: false })} satisfies ${GROUP_TYPE[group]};`,
        );
      } else {
        lines.push(`export const ${group} = {`);
        lines.push(
          ...items.map((item) =>
            ConfigCodemod.render({ item, column: MODULE_COLUMN, body: bodies.get(item) }).replace(
              /\n$/,
              '',
            ),
          ),
        );
        lines.push(`} satisfies ${GROUP_TYPE[group]};`);
      }

      const path = `${MODULES_DIRECTORY}/${group}.mts`;

      changes.push({ path, text: `${lines.join('\n')}\n` });
      written.push(group);
      exports.push(`export { ${group} } from './${group}.mts';`);
    }

    const first = source.statements[0];
    const header =
      first === undefined
        ? ''
        : source.text.slice(first.getFullStart(), first.getStart(source)).trimStart();

    changes.unshift({
      path: CONFIG_PATH,
      text: `${header}import type { VulcanConfig } from '@venizia/vulcan';\nimport { ${written.join(', ')} } from './vulcan/index.mts';\n\nexport default { ${ConfigKeyOrder.GROUPS.filter((group) => written.includes(group)).join(', ')} } satisfies VulcanConfig;\n`,
    });
    changes.push({ path: `${MODULES_DIRECTORY}/index.mts`, text: `${exports.join('\n')}\n` });

    for (const path of folded) {
      if (!changes.some((change) => change.path === path)) {
        changes.push({ path });
      }
    }

    return {
      ok: true,
      changes,
      notes: [
        `${CONFIG_PATH}: composes the groups from ${MODULES_DIRECTORY}/`,
        ...written.map((group) => `${MODULES_DIRECTORY}/${group}.mts`),
        ...[...folded].map((path) => `${path}: folded into the groups, deleted`),
      ],
    };
  }

  private static isModule(opts: { specifier: string }): boolean {
    return opts.specifier.startsWith('./vulcan/');
  }

  private static isVulcanType(opts: { statement: string }): boolean {
    return /^import type \{ VulcanConfig \}/.test(opts.statement);
  }

  /** An import of the config as it reads from a module one folder deeper. */
  private static carried(opts: { statement: string }): string {
    return opts.statement.replace(
      /(from\s+)(['"])(\.{1,2}\/)/,
      (_match, from: string, quote: string, dots: string) =>
        `${from}${quote}${dots === './' ? '../' : '../../'}`,
    );
  }

  /** The value a module of the old split exports as `name`: through `export { name } from './x.mts'` and `satisfies`, `as` and a type on the const. */
  private static moduleValue(opts: {
    typescript: TTypeScript;
    read: (path: string) => string | undefined;
    path: string;
    name: string;
    folded: Set<string>;
    depth: number;
  }): { text: string } | { reason: string } {
    const { typescript } = opts;
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

    for (const statement of source.statements) {
      if (
        typescript.isExportDeclaration(statement) &&
        statement.moduleSpecifier !== undefined &&
        statement.exportClause !== undefined &&
        typescript.isNamedExports(statement.exportClause) &&
        statement.exportClause.elements.some((element) => element.name.text === opts.name)
      ) {
        opts.folded.add(opts.path);

        return ConfigCodemod.moduleValue({
          ...opts,
          path: posix.join(
            posix.dirname(opts.path),
            typescript.isStringLiteral(statement.moduleSpecifier)
              ? statement.moduleSpecifier.text
              : '',
          ),
          depth: opts.depth + 1,
        });
      }

      if (typescript.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (
            typescript.isIdentifier(declaration.name) &&
            declaration.name.text === opts.name &&
            declaration.initializer !== undefined
          ) {
            let init = declaration.initializer;

            while (
              typescript.isSatisfiesExpression(init) ||
              typescript.isAsExpression(init) ||
              typescript.isParenthesizedExpression(init)
            ) {
              init = init.expression;
            }

            opts.folded.add(opts.path);

            return { text: init.getText(source) };
          }
        }
      }
    }

    return {
      reason: `${opts.path} does not export \`${opts.name}\` as a value the codemod can read`,
    };
  }

  // ----- back to the flat file -----

  private static reverse(opts: {
    typescript: TTypeScript;
    source: TSourceFile;
    object: TObjectLiteral;
    keys: string[];
    segments: IPropertySegment[];
    prefix: string;
    suffix: string;
  }): TCodemodResult {
    const items = ConfigCodemod.itemsOfGrouped(opts);

    if ('reason' in items) {
      return { ok: false, reason: items.reason };
    }

    const has = (group: string, key: string): boolean =>
      items.items.some((item) => item.group === group && item.key === key);

    if (has('check', 'doctor') && has('check', 'layout')) {
      return {
        ok: false,
        reason:
          '`check.doctor` and `check.layout` both exist: the flat `doctor` holds both, merge them by hand',
      };
    }

    const out: string[] = [];
    const flatKeys = new Map<string, string>();

    for (const item of items.items) {
      const found = Object.entries(PLACE).find(
        ([, place]) => place.group === item.group && place.key === item.key,
      );
      let flat = found?.[0];

      if (item.group === 'guard') {
        flat = 'guard';
      } else if (item.group === 'knowledge' && !['okf', 'atlas'].includes(item.key)) {
        flat = 'knowledge';
      } else if (item.group === 'check' && item.key === 'doctor') {
        flat = 'doctor';
      } else if (item.group === 'check' && item.key === 'layout') {
        flat = 'doctor';
      } else if (item.group === 'common' && item.key === 'remove') {
        flat = 'remove';
      } else if (item.group === 'project' && item.key === 'key') {
        flat = 'project';
      }

      if (flat === undefined) {
        return { ok: false, reason: `\`${item.group}.${item.key}\` has no flat key` };
      }

      flatKeys.set(`${item.group}.${item.key}`, flat);
    }

    const needsWrap = items.items.filter(
      (item) =>
        (item.group === 'knowledge' && !['okf', 'atlas'].includes(item.key)) ||
        (item.group === 'project' && item.key === 'key') ||
        (item.group === 'check' && item.key === 'layout'),
    );

    if (needsWrap.length > 0) {
      return {
        ok: false,
        reason:
          'the flat file wraps `knowledge`, `project.key` and `check.layout` in objects: restore the earlier file with git (the reverse of these three is not written)',
      };
    }

    for (const item of items.items) {
      const flat = flatKeys.get(`${item.group}.${item.key}`) ?? item.key;
      const place = Object.entries(PLACE).find(
        ([, entry]) => entry.group === item.group && entry.key === item.key,
      );
      const from = place?.[1].key ?? item.key;
      const body =
        flat === item.key || item.group === 'guard' || from === flat
          ? item.body
          : item.body.replace(new RegExp(`^${from}\\b`), flat);

      out.push(
        ConfigCodemod.render({
          item: { ...item, body },
          column: TOP_COLUMN,
        }),
      );
    }

    const ordered = out
      .map((text, index) => ({
        text,
        key: flatKeys.get(`${items.items[index].group}.${items.items[index].key}`) ?? '',
      }))
      .sort(
        (left, right) =>
          ConfigKeyOrder.rankOf({ key: left.key }) - ConfigKeyOrder.rankOf({ key: right.key }),
      );

    return {
      ok: true,
      changes: [
        {
          path: CONFIG_PATH,
          text: `${opts.prefix}${ordered.map((entry) => entry.text).join('')}${opts.suffix}`,
        },
      ],
      notes: [`${CONFIG_PATH}: the keys are flat again`],
    };
  }
}

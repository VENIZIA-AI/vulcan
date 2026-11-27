import { CodemodConstants } from './common/index.ts';
import type { ICodemodItem } from './common/index.ts';
import { ConfigFormat } from './format.ts';
import type {
  IPropertySegment,
  TObjectElement,
  TObjectLiteral,
  TSourceFile,
  TTypeScript,
} from './format.ts';
import { ConfigGroups } from './groups.ts';
import { CodemodTextUtility } from './utilities/codemod-text.utility.ts';

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

/** The properties of a config, flat or grouped, cut into items that carry their comments to a group. */
export class CodemodItemReader {
  static itemsOfFlat(opts: {
    typescript: TTypeScript;
    source: TSourceFile;
    object: TObjectLiteral;
    keys: string[];
    segments: IPropertySegment[];
  }): { items: ICodemodItem[] } | { reason: string } {
    const { typescript, source } = opts;
    const items: ICodemodItem[] = [];
    const has = (key: string): boolean => opts.keys.includes(key);

    for (const [index, property] of opts.object.properties.entries()) {
      const key = opts.keys[index];
      const segment = opts.segments[index];
      const column = CodemodConstants.TOP_COLUMN;
      const base = { leading: segment.leading, trailing: segment.trailing, column };
      const literal = CodemodItemReader.literalOf({ typescript, property });

      if (key === 'guard') {
        items.push({
          group: 'guard',
          key,
          ...base,
          body: segment.body,
          value: CodemodItemReader.valueOf({ typescript, source, property }),
        });
        continue;
      }

      if (key === 'project') {
        const inner =
          literal === undefined
            ? undefined
            : CodemodItemReader.innerItems({ typescript, source, literal });

        if (inner === undefined || 'reason' in inner) {
          return {
            reason: `\`project\` is not an object literal the codemod can open${inner === undefined ? '' : `: ${inner.reason}`}`,
          };
        }

        items.push(
          ...CodemodItemReader.carrying({ group: 'project', inner: inner.items, segment }),
        );
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

        const inner = CodemodItemReader.innerItems({ typescript, source, literal });

        if ('reason' in inner) {
          return { reason: inner.reason };
        }

        items.push(
          ...CodemodItemReader.carrying({ group: 'knowledge', inner: inner.items, segment }),
        );
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
          ...CodemodItemReader.bodyOf({ typescript, source, property }),
        });
        continue;
      }

      if (key === 'remove') {
        items.push({
          group: 'common',
          key,
          ...base,
          body: CodemodItemReader.removeBody({ typescript, source, property }),
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
        ...CodemodItemReader.bodyOf({
          typescript,
          source,
          property,
          rename: place.key === key ? undefined : place.key,
        }),
      });
    }

    return { items };
  }

  static itemsOfGrouped(opts: {
    typescript: TTypeScript;
    source: TSourceFile;
    object: TObjectLiteral;
    keys: string[];
    segments: IPropertySegment[];
  }): { items: ICodemodItem[] } | { reason: string } {
    const { typescript, source } = opts;
    const items: ICodemodItem[] = [];

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
          column: CodemodConstants.TOP_COLUMN,
          value: CodemodItemReader.valueOf({ typescript, source, property }),
        });
        continue;
      }

      const literal = CodemodItemReader.literalOf({ typescript, property });

      if (literal === undefined) {
        return {
          reason: `\`${group}\` is not an object literal: it is a module or a variable already`,
        };
      }

      const inner = CodemodItemReader.innerItems({ typescript, source, literal });

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
    inner: Omit<ICodemodItem, 'group'>[];
    segment: IPropertySegment;
  }): ICodemodItem[] {
    // The comment lines at the column of the keys; the indentation that ends `leading` is the key's own, which the first key brings.
    const above = CodemodTextUtility.shift({
      text: opts.segment.leading,
      by: CodemodConstants.GROUP_COLUMN - CodemodConstants.TOP_COLUMN,
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
  }): { items: Omit<ICodemodItem, 'group'>[] } | { reason: string } {
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
          leading: ' '.repeat(CodemodConstants.GROUP_COLUMN),
          trailing: '\n',
          column: CodemodConstants.GROUP_COLUMN,
          ...CodemodItemReader.bodyOf({
            typescript: opts.typescript,
            source: opts.source,
            property,
          }),
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
        column: CodemodConstants.GROUP_COLUMN,
        ...CodemodItemReader.bodyOf({
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
}

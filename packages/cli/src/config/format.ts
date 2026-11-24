import { TypeScriptCompiler } from '@venizia/vulcan-atlas';
import { ConfigKeyOrder } from './common/index.ts';

/** What `ConfigFormat.format` gives back: the text with its keys in order, or why it cannot order them. */
export type TConfigFormatResult =
  | {
      ok: true;
      text: string;
      /** The top-level keys in the order the text now has. */
      keys: string[];
      /** The keys that change place: the fewest whose move puts the rest in order. Empty when the file is in order. */
      moved: string[];
    }
  | { ok: false; reason: string };

/** One property of the object, cut into the text that moves with it. */
interface IPropertySegment {
  key: string;
  /** The text from the end of the property before it up to its first token: blank lines, comments, indentation. */
  leading: string;
  body: string;
  /** The text after its comma up to the end of its line: a trailing comment and the line break. */
  trailing: string;
  hasComma: boolean;
}

type TTypeScript = ReturnType<typeof TypeScriptCompiler.load>;
type TSourceFile = ReturnType<TTypeScript['createSourceFile']>;
type TObjectLiteral = ReturnType<TTypeScript['factory']['createObjectLiteralExpression']>;
type TObjectElement = TObjectLiteral['properties'][number];
type TExportAssignment = ReturnType<TTypeScript['factory']['createExportAssignment']>;

type TFound = { object: TObjectLiteral } | { reason: string };

const rankOf = (opts: { key: string }): number => {
  if (opts.key === ConfigKeyOrder.LAST) {
    return ConfigKeyOrder.KEYS.length + 1;
  }

  const index = ConfigKeyOrder.KEYS.indexOf(opts.key);

  return index === -1 ? ConfigKeyOrder.KEYS.length : index;
};

/** The indexes of `sequence` that make its longest strictly increasing run, in order. */
const findIncreasingRun = (opts: { sequence: number[] }): Set<number> => {
  const { sequence } = opts;
  const length = sequence.map(() => 1);
  const previous = sequence.map(() => -1);

  for (let index = 0; index < sequence.length; index++) {
    for (let before = 0; before < index; before++) {
      if (sequence[before] < sequence[index] && length[before] + 1 > length[index]) {
        length[index] = length[before] + 1;
        previous[index] = before;
      }
    }
  }

  const kept = new Set<number>();
  let at = length.indexOf(Math.max(0, ...length));

  while (at !== -1) {
    kept.add(at);
    at = previous[at];
  }

  return kept;
};

/** Puts the top-level keys of `.configs/vulcan.config.mts` in one order, as text: the file is parsed, never run. */
export class ConfigFormat {
  /** The text of the config with the keys of its default-export object in the order of `ConfigKeyOrder`; the same text when they are in order already. */
  static format(opts: { text: string; root: string }): TConfigFormatResult {
    const typescript = TypeScriptCompiler.load({ from: opts.root });
    const source = typescript.createSourceFile(
      'vulcan.config.mts',
      opts.text,
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

    const order = keys
      .map((key, index) => ({ key, index }))
      .sort((left, right) => rankOf({ key: left.key }) - rankOf({ key: right.key }));
    const target = new Map(order.map((entry, position) => [entry.index, position]));
    const kept = findIncreasingRun({ sequence: keys.map((_, index) => target.get(index) ?? 0) });
    const moved = order.filter((entry) => !kept.has(entry.index)).map((entry) => entry.key);

    if (moved.length === 0) {
      return { ok: true, text: opts.text, keys, moved };
    }

    const cut = ConfigFormat.cut({ typescript, source, object: found.object, keys });

    if ('reason' in cut) {
      return { ok: false, reason: cut.reason };
    }

    const last = cut.segments[cut.segments.length - 1];
    const body = order
      .map((entry, position) => {
        const segment = cut.segments[entry.index];
        const comma = position < order.length - 1 || last.hasComma ? ',' : '';

        return `${segment.leading}${segment.body}${comma}${segment.trailing}`;
      })
      .join('');

    const formatted = `${cut.prefix}${body}${cut.suffix}`;
    const { diagnostics = [] } = typescript.transpileModule(formatted, {
      reportDiagnostics: true,
      fileName: 'vulcan.config.mts',
    });

    if (diagnostics.length > 0) {
      return {
        ok: false,
        reason:
          'the keys could not be moved without breaking the file (a comma after a comment?): order them by hand',
      };
    }

    return { ok: true, text: formatted, keys: order.map((entry) => entry.key), moved };
  }

  /** The object of `export default { ... }`, through `satisfies`, `as`, parentheses and `defineConfig(...)`. */
  private static findObject(opts: { typescript: TTypeScript; source: TSourceFile }): TFound {
    const { typescript } = opts;
    const exported = opts.source.statements.find(
      (statement): statement is TExportAssignment =>
        typescript.isExportAssignment(statement) && statement.isExportEquals !== true,
    );

    if (exported === undefined) {
      return { reason: 'the file has no `export default`' };
    }

    let expression = exported.expression;

    for (;;) {
      if (
        typescript.isParenthesizedExpression(expression) ||
        typescript.isSatisfiesExpression(expression) ||
        typescript.isAsExpression(expression)
      ) {
        expression = expression.expression;
        continue;
      }

      if (
        typescript.isCallExpression(expression) &&
        typescript.isIdentifier(expression.expression) &&
        expression.expression.text === 'defineConfig' &&
        expression.arguments.length === 1
      ) {
        expression = expression.arguments[0];
        continue;
      }

      break;
    }

    return typescript.isObjectLiteralExpression(expression)
      ? { object: expression }
      : { reason: 'the default export is not an object literal (`export default { ... }`)' };
  }

  private static keyOf(opts: {
    typescript: TTypeScript;
    property: TObjectElement;
  }): string | { reason: string } {
    const { typescript, property } = opts;

    if (typescript.isSpreadAssignment(property)) {
      return {
        reason: `the object has a spread (\`${property.getText()}\`): its keys are known only when the config runs`,
      };
    }

    const name = property.name;

    if (typescript.isComputedPropertyName(name)) {
      return {
        reason: `the object has a computed key (\`${name.getText()}\`): its name is known only when the config runs`,
      };
    }

    return typescript.isIdentifier(name) ||
      typescript.isStringLiteral(name) ||
      typescript.isNumericLiteral(name) ||
      typescript.isNoSubstitutionTemplateLiteral(name)
      ? name.text
      : name.getText();
  }

  /** The object's text cut into what stays (before the first key, after the last) and one segment per property. */
  private static cut(opts: {
    typescript: TTypeScript;
    source: TSourceFile;
    object: TObjectLiteral;
    keys: string[];
  }): { prefix: string; segments: IPropertySegment[]; suffix: string } | { reason: string } {
    const { typescript, source, object } = opts;
    const text = source.text;
    const properties = object.properties;
    const firstLineEnd = text.indexOf('\n', object.getStart(source));

    if (firstLineEnd === -1 || properties[0].getStart(source) < firstLineEnd) {
      return { reason: 'the first key is on the line of `{`: put each key on its own line' };
    }

    const segments: IPropertySegment[] = [];
    let start = firstLineEnd + 1;

    for (const [index, property] of properties.entries()) {
      const bodyStart = property.getStart(source);
      let after = property.end;

      while (text[after] === ' ' || text[after] === '\t') {
        after++;
      }

      const hasComma = text[after] === ',';
      const trailingStart = hasComma ? after + 1 : property.end;
      const comments = typescript.getTrailingCommentRanges(text, trailingStart) ?? [];
      const lineEnd = text.indexOf(
        '\n',
        comments.length === 0 ? trailingStart : comments[comments.length - 1].end,
      );
      const next = properties[index + 1];
      const limit = next === undefined ? object.getEnd() - 1 : next.getStart(source);

      if (lineEnd === -1 || lineEnd >= limit) {
        return {
          reason: `\`${opts.keys[index]}\` shares its line with ${next === undefined ? 'the closing `}`' : `\`${opts.keys[index + 1]}\``}: put each key on its own line`,
        };
      }

      segments.push({
        key: opts.keys[index],
        leading: text.slice(start, bodyStart),
        body: text.slice(bodyStart, property.end),
        trailing: text.slice(trailingStart, lineEnd + 1),
        hasComma,
      });
      start = lineEnd + 1;
    }

    return { prefix: text.slice(0, firstLineEnd + 1), segments, suffix: text.slice(start) };
  }
}

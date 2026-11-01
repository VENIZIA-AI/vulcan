import { RuleConstants } from './common/index.ts';

const RULE_ROW = new RegExp(`^\\|\\s*(?:\\*\\*)?(${RuleConstants.ID_SOURCE})(?:\\*\\*)?\\s*\\|`);

const BASE_ID = new RegExp(`(?<![A-Z-])${RuleConstants.BASE_ID_SOURCE}\\b`, 'g');

const EXTENDS_LIST = new RegExp(
  `\\bExtends\\s+${RuleConstants.BASE_ID_SOURCE}(?:(?:\\s*,\\s*|\\s+and\\s+)${RuleConstants.BASE_ID_SOURCE})*`,
  'g',
);

const RETIRED_ITEM = new RegExp(`^- \`(${RuleConstants.BASE_ID_SOURCE})\` - `);

export class RuleParser {
  /** Rule IDs in table order, from rows whose first cell is `W-01`, `V-W-01` or either in bold. */
  static parseIds(opts: { markdown: string }): string[] {
    return opts.markdown
      .split('\n')
      .map((line) => RULE_ROW.exec(line)?.[1])
      .filter((id): id is string => id !== undefined);
  }

  /** The table rows of every rule, verbatim, in order. */
  static extractRows(opts: { markdown: string }): string[] {
    return opts.markdown.split('\n').filter((line) => RULE_ROW.test(line));
  }

  /**
   * The base IDs a project's rules point at, once each, in order: an `Extends V-X, V-Y and V-Z` list
   * in a table row, and every `V-` ID in a row's first cell. A `V-` ID in prose or a later cell is not one.
   */
  static parseBaseReferences(opts: { markdown: string }): string[] {
    const references = new Set<string>();

    for (const line of opts.markdown.split('\n').filter((row) => row.startsWith('|'))) {
      const firstCell = line.split('|')[1] ?? '';
      const lists = [...line.matchAll(EXTENDS_LIST)].map((match) => match[0]);

      for (const text of [...lists, firstCell]) {
        for (const match of text.matchAll(BASE_ID)) {
          references.add(match[0]);
        }
      }
    }

    return [...references];
  }

  /** The IDs the base retired, one `` - `V-X-NN` - why `` bullet each; they are never reused. */
  static parseRetiredIds(opts: { markdown: string }): string[] {
    return opts.markdown
      .split('\n')
      .map((line) => RETIRED_ITEM.exec(line)?.[1])
      .filter((id): id is string => id !== undefined);
  }
}

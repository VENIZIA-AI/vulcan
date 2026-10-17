import { RuleConstants } from './common/index.ts';

const RULE_ROW = new RegExp(`^\\|\\s*(?:\\*\\*)?(${RuleConstants.ID_SOURCE})(?:\\*\\*)?\\s*\\|`);

/** Rule IDs in table order, from rows whose first cell is `W-01`, `V-W-01` or either in bold. */
export const parseRuleIds = (opts: { markdown: string }): string[] =>
  opts.markdown
    .split('\n')
    .map(line => RULE_ROW.exec(line)?.[1])
    .filter((id): id is string => id !== undefined);

/** The table rows of every rule, verbatim, in order. */
export const extractRuleRows = (opts: { markdown: string }): string[] =>
  opts.markdown.split('\n').filter(line => RULE_ROW.test(line));

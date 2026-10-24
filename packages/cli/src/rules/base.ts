import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE_DIRECTORY } from '../common/index.ts';
import { extractRuleRows, parseRetiredRuleIds, parseRuleIds } from './parser.ts';

const readBaseMarkdown = (): string => readFileSync(join(BASE_DIRECTORY, 'rules.md'), 'utf8');

/** Each base rule's ID with its table row, verbatim. */
export const readBaseRules = (): Record<string, string> =>
  Object.fromEntries(
    extractRuleRows({ markdown: readBaseMarkdown() }).map((row) => {
      const [id] = parseRuleIds({ markdown: row });

      return [id, row];
    }),
  );

export const readRetiredRuleIds = (): string[] =>
  parseRetiredRuleIds({ markdown: readBaseMarkdown() });

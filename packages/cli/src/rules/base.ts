import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE_DIRECTORY } from '../common/index.ts';
import { RuleParser } from './parser.ts';

const readBaseMarkdown = (): string => readFileSync(join(BASE_DIRECTORY, 'rules.md'), 'utf8');

export class BaseRules {
  /** Each base rule's ID with its table row, verbatim. */
  static read(): Record<string, string> {
    return Object.fromEntries(
      RuleParser.extractRows({ markdown: readBaseMarkdown() }).map((row) => {
        const [id] = RuleParser.parseIds({ markdown: row });

        return [id, row];
      }),
    );
  }
}

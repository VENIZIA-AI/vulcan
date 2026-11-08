import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE_DIRECTORY } from '../common/index.ts';
import { RulePacks } from './packs.ts';
import { RuleParser } from './parser.ts';

const readBaseMarkdown = (): string => readFileSync(join(BASE_DIRECTORY, 'rules.md'), 'utf8');

/** Reads the base rule file shipped with the CLI as a map of rule ID to text; used by `vulcan sync` and `vulcan doctor`. */
export class BaseRules {
  /** Each base rule's ID with its table row, verbatim, and the rows of each rule pack named in `packs`. */
  static read(opts: { packs?: string[] } = {}): Record<string, string> {
    return Object.assign(
      Object.fromEntries(
        RuleParser.extractRows({ markdown: readBaseMarkdown() }).map((row) => {
          const [id] = RuleParser.parseIds({ markdown: row });

          return [id, row];
        }),
      ),
      ...(opts.packs ?? []).map((name) => RulePacks.rowsOf({ name })),
    );
  }
}

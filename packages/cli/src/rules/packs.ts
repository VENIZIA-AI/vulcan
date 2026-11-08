import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE_DIRECTORY } from '../common/index.ts';
import { RuleParser } from './parser.ts';

const PACKS_DIRECTORY = join(BASE_DIRECTORY, 'packs');

/** The rule packs shipped with the CLI: a markdown file of rule rows for one stack, which a project turns on with `packs` in its config. */
export class RulePacks {
  /** The shipped packs, by name. */
  static names(): string[] {
    return existsSync(PACKS_DIRECTORY)
      ? readdirSync(PACKS_DIRECTORY)
          .filter((file) => file.endsWith('.md'))
          .map((file) => file.slice(0, -'.md'.length))
          .sort()
      : [];
  }

  /** Where a pack's rules are, from the project root's `node_modules`, as the rules block names it. */
  static pathOf(opts: { name: string }): string {
    return `node_modules/@venizia/vulcan/base/packs/${opts.name}.md`;
  }

  /** The rows of one pack, each rule's ID with its table row verbatim; a name that is no shipped pack has none. */
  static rowsOf(opts: { name: string }): Record<string, string> {
    const file = join(PACKS_DIRECTORY, `${opts.name}.md`);

    // Only a name the folder lists: `../rules` is not a pack.
    return RulePacks.names().includes(opts.name) && existsSync(file)
      ? Object.fromEntries(
          RuleParser.extractRows({ markdown: readFileSync(file, 'utf8') }).map((row) => [
            RuleParser.parseIds({ markdown: row })[0],
            row,
          ]),
        )
      : {};
  }

  /** The shipped pack that holds rule `id`, or `undefined`: what `doctor` says when a project cites a rule of a pack it did not turn on. */
  static holderOf(opts: { id: string }): string | undefined {
    return RulePacks.names().find((name) => RulePacks.rowsOf({ name })[opts.id] !== undefined);
  }
}

import { RuleParser } from '../rules/index.ts';
import type { ISlot } from '../rules/index.ts';
import { GeneratedBlock } from './generated-block.ts';

const { start: RULES_BLOCK_START, end: RULES_BLOCK_END } = GeneratedBlock.markersOf({
  name: 'rules',
  origin: 'the base rules and .configs/vulcan.config.*',
});

/** A summary of a rule shorter than this takes the next sentence too (`Approval has a card.`). */
const SHORT_SUMMARY_CHARACTERS = 40;

export class RulesBlock {
  /** What the block may weigh with its markers: Claude Code gives a hook's output whole up to about 10,000 bytes (measured), so 6 KB leaves room for the rest of the session's context, and each rule line carries its whole first sentence. */
  static readonly MAX_BYTES = 6144;

  /** A rule row as one line: its whole first sentence, plain, with the next one when the first is only a title. */
  static summaryOf(opts: { row: string }): string {
    const cell = (opts.row.split('|')[2] ?? '').replaceAll('**', '').replace(/\s+/g, ' ').trim();
    const [first = '', second = ''] = cell.split(/(?<=[.!?])\s+/);
    return first.length < SHORT_SUMMARY_CHARACTERS ? `${first} ${second}`.trim() : first;
  }

  /** One line for each slot of the base rules: the option this project chose, or that it has not chosen. */
  static slotLinesOf(opts: {
    slots: Record<string, ISlot>;
    choices: Record<string, string | undefined>;
    command: string;
  }): string[] {
    return Object.entries(opts.slots).map(([id, slot]) => {
      const choice = opts.choices[id];

      return choice === undefined
        ? `- ${id}: this project has **not chosen** - run \`${opts.command} doctor\``
        : `- ${id}: this project: \`${choice}\` - ${slot.options[choice]?.text ?? `unknown option - run \`${opts.command} doctor\``}`;
    });
  }

  /**
   * The rules an agent must not skip, from the rules themselves: this project's slot choices, the write
   * boundaries, where scratch files go, and the rules sessions drop most (from the last, as many as fit
   * `MAX_BYTES`). `rows` are the base and project rule rows.
   */
  static render(opts: {
    rows: string[];
    slotLines: string[];
    /** The project's temp folder, relative to its root: the block is committed, so it holds no path of one machine. */
    tmp: string;
    oftenDropped: string[];
  }): string {
    const bullet = (id: string): string | undefined => {
      const row = opts.rows.find((item) => RuleParser.parseIds({ markdown: item })[0] === id);

      return row === undefined ? undefined : `- ${id}: ${RulesBlock.summaryOf({ row })}`;
    };
    const dropped = opts.oftenDropped.map((id) => bullet(id)).filter((line) => line !== undefined);
    const build = (count: number): string =>
      [
        RULES_BLOCK_START,
        '## Rules that must not be skipped',
        '',
        'Full text, cited by ID: `node_modules/@venizia/vulcan/base/rules.md` (V-*) and `.agents/rules.md`.',
        '',
        ...opts.slotLines,
        ...['V-W-02', 'V-W-03', 'V-W-06']
          .map((id) => bullet(id))
          .filter((line) => line !== undefined),
        `- V-B-08: Scratch and temporary files go in \`${opts.tmp}\`, never /tmp or the scratchpad folder a tool offers. Claude Code sets \`TMPDIR\` to it; elsewhere \`export TMPDIR="$PWD/${opts.tmp}"\` from the project root.`,
        ...dropped.slice(0, count),
        RULES_BLOCK_END,
        '',
      ].join('\n');
    let count = dropped.length;

    while (count > 0 && Buffer.byteLength(build(count)) > RulesBlock.MAX_BYTES) {
      count -= 1;
    }

    return build(count);
  }

  /** Puts the block into AGENTS.md; see `GeneratedBlock.merge`. */
  static merge(opts: { text: string; block: string }): { changed: boolean; text: string } {
    return GeneratedBlock.merge({ ...opts, name: 'rules' });
  }
}

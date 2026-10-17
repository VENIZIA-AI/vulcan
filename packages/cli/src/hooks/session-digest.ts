import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE_DIRECTORY, ProjectLayout } from '../common/index.ts';
import { loadConfig } from '../config/index.ts';
import { extractRuleRows, readSlots, RuleConstants } from '../rules/index.ts';

/** The base rules a session drops most; quoted from the rule file, so the digest cannot drift. */
const OFTEN_DROPPED = ['V-B-03', 'V-P-05', 'V-P-06', 'V-B-04', 'V-W-04', 'V-C-02', 'V-C-10'];

const TABLE_HEADER = ['| ID | Rule | Enforced by |', '|----|------|-------------|'];

const selectRows = (opts: { rows: string[]; ids: string[] }): string[] =>
  opts.ids
    .map(id => opts.rows.find(row => row.startsWith(`| ${id} |`)))
    .filter((row): row is string => row !== undefined);

const readRuleRows = (opts: { file: string }): string[] =>
  existsSync(opts.file) ? extractRuleRows({ markdown: readFileSync(opts.file, 'utf8') }) : [];

/** The SessionStart context: base write boundaries, this project's slot choices and own rules, the often-dropped rules. */
export const buildSessionDigest = async (opts: { projectRoot: string }): Promise<string> => {
  const baseRows = readRuleRows({ file: join(BASE_DIRECTORY, 'rules.md') });
  const projectRows = readRuleRows({ file: join(opts.projectRoot, '.agents', 'rules.md') });
  const loaded = await loadConfig({ root: opts.projectRoot });
  const choices = loaded.ok ? loaded.config.rules : {};

  const slotRows = Object.entries(readSlots()).map(([id, slot]) => {
    const choice = choices[id];

    if (choice === undefined) {
      return `| ${id} | this project: **not chosen** - run \`${ProjectLayout.VULCAN_COMMAND} doctor\` |`;
    }

    return `| ${id} | this project: \`${choice}\` - ${slot.options[choice]?.text ?? `unknown option - run \`${ProjectLayout.VULCAN_COMMAND} doctor\``} |`;
  });

  const lines = [
    '# VULCAN rules - read this before acting',
    '',
    'Base rules: `node_modules/@venizia/vulcan/base/rules.md`. This project: `.agents/rules.md`.',
    '',
    '## Write boundaries',
    '',
    ...TABLE_HEADER,
    ...baseRows.filter(row => row.startsWith(`| ${RuleConstants.BASE_NAMESPACE}W-`)),
    '',
    "## This project's slot choices",
    '',
    ...slotRows,
  ];

  if (projectRows.length > 0) {
    lines.push('', "## This project's own rules", '', ...TABLE_HEADER, ...projectRows);
  }

  lines.push(
    '',
    '## The rules sessions drop most',
    '',
    ...TABLE_HEADER,
    ...selectRows({ rows: baseRows, ids: OFTEN_DROPPED }),
  );

  return `${lines.join('\n')}\n`;
};

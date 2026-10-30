import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { BASE_DIRECTORY, ProjectLayout } from '../common/index.ts';
import { ConfigConstants, loadConfig } from '../config/index.ts';
import {
  isOwnerReplyOff,
  OWNER_SCHEMA,
  readProfile,
  renderOwnerShapeCard,
  renderProfileCard,
  resolveOwnerView,
} from '../owner/index.ts';
import { extractRuleRows, parseRuleIds, readSlots, RuleConstants } from '../rules/index.ts';
import { ClaudeLaunch } from '../sync/claude-launch.ts';
import { projectTmpOf } from './project-tmp.ts';

/** A project row whose first cell lists IDs - `| V-W-02, V-W-03 |` - elaborates those base rules. */
const ID_LIST_ROW =
  /^\|\s*(?:\*\*)?(?:[A-Z]+-)?[A-Z]-\d{2}(?:\*\*)?(?:\s*,\s*(?:\*\*)?(?:[A-Z]+-)?[A-Z]-\d{2}(?:\*\*)?)+\s*\|/;

/** The project's own picture of itself, printed verbatim at session start. */
const MINIMAP = /<!-- minimap-shape:start -->\n([\s\S]*?)\n?<!-- minimap-shape:end -->/;

const TABLE_HEADER = ['| ID | Rule | Enforced by |', '|----|------|-------------|'];

/** Each listed ID's row, plain or bold (`| **W-00** |`), quoted from its rule file so it cannot drift. */
const selectRows = (opts: { rows: string[]; ids: string[] }): string[] =>
  opts.ids
    .map((id) => opts.rows.find((row) => parseRuleIds({ markdown: row })[0] === id))
    .filter((row): row is string => row !== undefined);

const readText = (opts: { file: string }): string =>
  existsSync(opts.file) ? readFileSync(opts.file, 'utf8') : '';

/** The Atlas block: only for a project whose `.mcp.json` runs the atlas server. */
const buildAtlasBlock = (opts: {
  projectRoot: string;
  project: string;
  sources: string[];
}): string[] => {
  if (!/\batlas\b/.test(readText({ file: join(opts.projectRoot, '.mcp.json') }))) {
    return [];
  }

  return [
    '## Atlas',
    '',
    `The \`atlas\` MCP server holds the real code and docs of: ${[`${opts.project} (this repository)`, ...opts.sources].join(', ')}.`,
    'Look facts up there before you answer or write from memory: `symbol` for an export you import, `search` for how something works, `version` or `changes` for a release (V-P-07).',
    '',
  ];
};

/** The SessionStart context: base write boundaries, this project's slot choices and own rules, the often-dropped rules. */
export const buildSessionDigest = async (opts: {
  projectRoot: string;
  /** The environment of the session; `VULCAN_OWNER_REPLY=off` leaves out the owner's shape and profile cards. */
  env?: Record<string, string | undefined>;
}): Promise<string> => {
  const baseRows = extractRuleRows({
    markdown: readText({ file: join(BASE_DIRECTORY, 'rules.md') }),
  });
  const projectText = readText({ file: join(opts.projectRoot, '.agents', 'rules.md') });
  const projectRows = projectText
    .split('\n')
    .filter((line) => extractRuleRows({ markdown: line }).length > 0 || ID_LIST_ROW.test(line));
  const minimap = MINIMAP.exec(projectText)?.[1].trim();
  const loaded = await loadConfig({ root: opts.projectRoot });
  const choices = loaded.ok ? loaded.config.rules : {};
  const oftenDropped = loaded.ok
    ? loaded.config.digest.oftenDropped
    : ConfigConstants.DEFAULT_OFTEN_DROPPED;

  const slotRows = Object.entries(readSlots()).map(([id, slot]) => {
    const choice = choices[id];

    if (choice === undefined) {
      return `| ${id} | this project: **not chosen** - run \`${ProjectLayout.VULCAN_COMMAND} doctor\` |`;
    }

    return `| ${id} | this project: \`${choice}\` - ${slot.options[choice]?.text ?? `unknown option - run \`${ProjectLayout.VULCAN_COMMAND} doctor\``} |`;
  });

  const launchWarning = ClaudeLaunch.missWarning({
    root: opts.projectRoot,
    env: opts.env ?? process.env,
  });

  const lines = [
    '# VULCAN rules - read this before acting',
    '',
    ...(launchWarning === undefined ? [] : ['## Launch warning', '', launchWarning, '']),
    'Base rules: `node_modules/@venizia/vulcan/base/rules.md`. This project: `.agents/rules.md`.',
    '',
    ...buildAtlasBlock({
      projectRoot: opts.projectRoot,
      project: loaded.ok
        ? (loaded.config.name ?? basename(opts.projectRoot))
        : basename(opts.projectRoot),
      sources: loaded.ok ? loaded.config.atlas.sources.map((source) => source.name) : [],
    }),
    '## Write boundaries',
    '',
    ...TABLE_HEADER,
    ...baseRows.filter((row) => row.startsWith(`| ${RuleConstants.BASE_NAMESPACE}W-`)),
    '',
    '## Temporary files',
    '',
    `Scratch and temporary files go in \`${projectTmpOf({ root: opts.projectRoot })}\`, never /tmp (V-B-08). The scratchpad folder your tool offers is under /tmp too: do not use it, this rule wins over the tool's line. In Claude Code every Bash command already runs with \`TMPDIR\` set to it; in any other agent run \`export TMPDIR=${projectTmpOf({ root: opts.projectRoot })}\` first. Remove what you made when the task ends.`,
    '',
    "## This project's slot choices",
    '',
    ...slotRows,
  ];

  const profile = readProfile({ root: opts.projectRoot });
  const view = resolveOwnerView({
    owner: loaded.ok ? loaded.config.owner : OWNER_SCHEMA.parse(undefined),
    profile: profile.ok ? profile.profile : undefined,
  });
  const profileCard = renderProfileCard({ view });

  // A session whose reader is an agent: the owner's shape and the person's profile are not its business.
  if (!isOwnerReplyOff({ env: opts.env ?? process.env })) {
    lines.push('', ...renderOwnerShapeCard({ view }));

    if (profileCard.length > 0) {
      lines.push('', ...profileCard);
    }
  }

  if (projectRows.length > 0) {
    lines.push('', "## This project's own rules", '', ...TABLE_HEADER, ...projectRows);
  }

  if (minimap !== undefined && minimap.length > 0) {
    lines.push('', "## This project's minimap", '', minimap);
  }

  lines.push(
    '',
    '## The rules sessions drop most',
    '',
    ...TABLE_HEADER,
    ...selectRows({ rows: [...baseRows, ...projectRows], ids: oftenDropped }),
  );

  return `${lines.join('\n')}\n`;
};

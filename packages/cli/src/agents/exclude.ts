import { AgentConstants, AgentScopes } from './common/index.ts';
import { LOCAL_AGENTS_FILE } from './local.ts';
import { readAgentTable } from './table.ts';

export const EXCLUDE_BLOCK_START =
  '# vulcan:start - written by vulcan sync for the agents you chose; do not edit';
export const EXCLUDE_BLOCK_END = '# vulcan:end';
const START_PREFIX = '# vulcan:start';
const CLAUDE_SKILLS_DIRECTORY = '.claude/skills';

export interface IExcludeGroup {
  title: string;
  /** Root-relative and anchored with a leading slash; a folder ends with one. */
  paths: string[];
}

/**
 * What sync creates for the chosen agents and so keeps out of `git status` on this machine: the
 * shim and folder of Claude, each agent's own MCP file, the shipped-skill links of the folders the
 * agents read (once per folder), and the local choice file.
 */
export const excludePathsOf = (opts: {
  agents: string[];
  skillNames: string[];
}): IExcludeGroup[] => {
  const listedSkills = new Set<string>();
  let listedShared = false;
  const groups: IExcludeGroup[] = [];

  for (const entry of readAgentTable().filter(item => opts.agents.includes(item.id))) {
    const paths: string[] = [];

    if (entry.instructions.shim !== null) {
      paths.push(`/${entry.instructions.shim.path}`);
    }

    if (entry.id === AgentConstants.DEFAULT_AGENT) {
      paths.push('/.claude/');
    }

    if (entry.mcp.scope === AgentScopes.PROJECT) {
      paths.push(`/${entry.mcp.path}`);
    } else if (!listedShared) {
      // The root `.mcp.json` several agents read is listed once, under the first of them.
      listedShared = true;
      paths.push(`/${AgentConstants.SHARED_MCP_FILE}`);
    }

    if (entry.skills.dir !== CLAUDE_SKILLS_DIRECTORY && !listedSkills.has(entry.skills.dir)) {
      listedSkills.add(entry.skills.dir);
      paths.push(...opts.skillNames.map(name => `/${entry.skills.dir}/${name}`));
    }

    if (paths.length > 0) {
      groups.push({ title: entry.id, paths });
    }
  }

  return [...groups, { title: 'local', paths: [`/${LOCAL_AGENTS_FILE}`] }];
};

export const renderExcludeBlock = (opts: { groups: IExcludeGroup[] }): string =>
  [
    EXCLUDE_BLOCK_START,
    ...opts.groups.flatMap(group => [`# ${group.title}`, ...group.paths]),
    EXCLUDE_BLOCK_END,
    '',
  ].join('\n');

/** The block replaces itself between its markers; the user's own lines in the file are never touched. */
export const mergeExcludeBlock = (opts: {
  text: string | undefined;
  block: string;
}): { changed: boolean; text: string } => {
  if (opts.text === undefined || opts.text === '') {
    return { changed: true, text: opts.block };
  }

  const start = opts.text.indexOf(START_PREFIX);
  const end = opts.text.indexOf(EXCLUDE_BLOCK_END);

  if (start !== -1 && end > start) {
    const text = `${opts.text.slice(0, start)}${opts.block.trimEnd()}${opts.text.slice(end + EXCLUDE_BLOCK_END.length)}`;

    return { changed: text !== opts.text, text };
  }

  return {
    changed: true,
    text: `${opts.text}${opts.text.endsWith('\n') ? '' : '\n'}\n${opts.block}`,
  };
};

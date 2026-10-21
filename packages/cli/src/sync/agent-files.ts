import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  AgentConstants,
  AgentRenderers,
  AgentScopes,
  atlasServerEntry,
  canonicalAtlasEntry,
  mergeCodexToml,
  mergeMcpServers,
  readAgentTable,
} from '../agents/index.ts';
import type { TAgentEntry } from '../agents/index.ts';
import { SyncStatuses } from './common/index.ts';
import type { ISyncAction } from './common/index.ts';

const NO_CHANGE = (): void => {};

/** A file git tracks cannot be hidden by an exclude entry, and a per-developer edit would show as a diff. */
export const isTracked = (opts: { root: string; path: string }): boolean => {
  try {
    return (
      Bun.spawnSync(['git', 'ls-files', '--error-unmatch', opts.path], {
        cwd: opts.root,
        stdout: 'ignore',
        stderr: 'ignore',
      }).exitCode === 0
    );
  } catch {
    return false;
  }
};

const merge = (opts: { entry: TAgentEntry; root: string; text: string | undefined }) => {
  const server = atlasServerEntry({ root: opts.root });

  switch (opts.entry.mcp.renderer) {
    case AgentRenderers.CODEX_TOML: {
      return mergeCodexToml({ text: opts.text, root: opts.root });
    }

    case AgentRenderers.SERVERS: {
      return mergeMcpServers({
        text: opts.text,
        key: 'servers',
        entry: { type: 'stdio', ...server },
      });
    }

    default: {
      return mergeMcpServers({ text: opts.text, key: 'mcpServers', entry: server });
    }
  }
};

/** The atlas entry in the agent's own MCP file; an agent on the shared `.mcp.json` needs no file. */
const planAgentMcp = (opts: { root: string; entry: TAgentEntry }): ISyncAction[] => {
  if (opts.entry.mcp.scope !== AgentScopes.PROJECT) {
    return [];
  }

  const path = join(opts.root, opts.entry.mcp.path);
  const text = existsSync(path) ? readFileSync(path, 'utf8') : undefined;
  const merged = merge({ entry: opts.entry, root: opts.root, text });

  if (!merged.ok) {
    return [
      {
        path,
        status: SyncStatuses.SKIPPED,
        note: `${merged.reason} - left untouched; fix it, then re-run sync`,
        apply: NO_CHANGE,
      },
    ];
  }

  if (!merged.changed) {
    return [{ path, status: SyncStatuses.UNCHANGED, apply: NO_CHANGE }];
  }

  if (text !== undefined && isTracked({ root: opts.root, path: opts.entry.mcp.path })) {
    return [
      {
        path,
        status: SyncStatuses.SKIPPED,
        note: `tracked by git - left alone; add the atlas server by hand: bun ${join(opts.root, 'node_modules', '.bin', 'vulcan')} x atlas mcp --root ${opts.root}`,
        apply: NO_CHANGE,
      },
    ];
  }

  return [
    {
      path,
      status: text === undefined ? SyncStatuses.CREATED : SyncStatuses.REPLACED,
      apply: () => {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, merged.text);
      },
    },
  ];
};

/**
 * The root `.mcp.json` the chosen agents of the shared scope read: the canonical atlas entry, merged
 * into what is there. A file git tracks belongs to the project, not to this machine: it is never
 * rewritten (the doctor says how to hand it over).
 */
const planSharedMcp = (opts: { root: string }): ISyncAction[] => {
  const path = join(opts.root, AgentConstants.SHARED_MCP_FILE);
  const text = existsSync(path) ? readFileSync(path, 'utf8') : undefined;
  const merged = mergeMcpServers({ text, key: 'mcpServers', entry: canonicalAtlasEntry() });

  if (!merged.ok) {
    return [
      {
        path,
        status: SyncStatuses.SKIPPED,
        note: `${merged.reason} - left untouched; fix it, then re-run sync`,
        apply: NO_CHANGE,
      },
    ];
  }

  if (
    !merged.changed ||
    (text !== undefined && isTracked({ root: opts.root, path: AgentConstants.SHARED_MCP_FILE }))
  ) {
    return [{ path, status: SyncStatuses.UNCHANGED, apply: NO_CHANGE }];
  }

  return [
    {
      path,
      status: text === undefined ? SyncStatuses.CREATED : SyncStatuses.REPLACED,
      apply: () => writeFileSync(path, merged.text),
    },
  ];
};

/** The MCP files of every chosen agent, in table order; the shared `.mcp.json` once, at its first reader. */
export const planAgentFiles = (opts: { root: string; agents: string[] }): ISyncAction[] => {
  let sharedPlanned = false;

  return readAgentTable()
    .filter(entry => opts.agents.includes(entry.id))
    .flatMap(entry => {
      if (entry.mcp.scope === AgentScopes.PROJECT) {
        return planAgentMcp({ root: opts.root, entry });
      }

      if (sharedPlanned) {
        return [];
      }

      sharedPlanned = true;

      return planSharedMcp({ root: opts.root });
    });
};

/** One line per note of a chosen agent (a trust prompt only the user can answer). */
export const agentNotes = (opts: { agents: string[] }): { agent: string; note: string }[] =>
  readAgentTable()
    .filter(entry => opts.agents.includes(entry.id))
    .flatMap(entry => entry.notes.map(note => ({ agent: entry.id, note })));

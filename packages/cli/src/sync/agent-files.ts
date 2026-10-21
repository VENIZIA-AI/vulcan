import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  AgentRenderers,
  AgentScopes,
  atlasServerEntry,
  mergeCodexToml,
  mergeMcpServers,
  readAgentTable,
} from '../agents/index.ts';
import type { TAgentEntry } from '../agents/index.ts';
import { SyncStatuses } from './common/index.ts';
import type { ISyncAction } from './common/index.ts';

const NO_CHANGE = (): void => {};

/** A file git tracks cannot be hidden by an exclude entry, and a per-developer edit would show as a diff. */
const isTracked = (opts: { root: string; path: string }): boolean => {
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

/** The MCP files of every chosen agent, in table order. */
export const planAgentFiles = (opts: { root: string; agents: string[] }): ISyncAction[] =>
  readAgentTable()
    .filter(entry => opts.agents.includes(entry.id))
    .flatMap(entry => planAgentMcp({ root: opts.root, entry }));

/** One line per note of a chosen agent (a trust prompt only the user can answer). */
export const agentNotes = (opts: { agents: string[] }): { agent: string; note: string }[] =>
  readAgentTable()
    .filter(entry => opts.agents.includes(entry.id))
    .flatMap(entry => entry.notes.map(note => ({ agent: entry.id, note })));

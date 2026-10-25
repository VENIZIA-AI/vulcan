import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { BASE_DIRECTORY } from '../common/index.ts';
import {
  AgentConstants,
  AgentGuardKinds,
  AgentRenderers,
  AgentScopes,
  atlasServerEntry,
  canonicalAtlasEntry,
  GUARD_HOOK_NAME,
  mergeCodexToml,
  mergeGuardHook,
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

/**
 * The guard extension of an agent that takes one (omp, pi): the shipped template, copied into the folder the
 * agent loads extensions from. A file that does not start with sync's marker is the user's own, and a file
 * git tracks belongs to the project: both are left alone and the line says so.
 */
const planGuardExtension = (opts: { root: string; entry: TAgentEntry }): ISyncAction[] => {
  if (opts.entry.guards === null) {
    return [];
  }

  const path = join(opts.root, opts.entry.guards.path);
  const text = readFileSync(join(BASE_DIRECTORY, AgentConstants.GUARD_EXTENSION_TEMPLATE), 'utf8');
  const before = existsSync(path) ? readFileSync(path, 'utf8') : undefined;

  if (before === text) {
    return [{ path, status: SyncStatuses.UNCHANGED, apply: NO_CHANGE }];
  }

  if (before !== undefined && !before.startsWith(AgentConstants.GUARD_EXTENSION_MARKER)) {
    return [
      {
        path,
        status: SyncStatuses.SKIPPED,
        note: `a file of your own is there - left alone; copy node_modules/@venizia/vulcan/base/${AgentConstants.GUARD_EXTENSION_TEMPLATE} over it to add the guards`,
        apply: NO_CHANGE,
      },
    ];
  }

  if (before !== undefined && isTracked({ root: opts.root, path: opts.entry.guards.path })) {
    return [
      {
        path,
        status: SyncStatuses.SKIPPED,
        note: 'tracked by git - left alone; copy the shipped extension over it to update the guards',
        apply: NO_CHANGE,
      },
    ];
  }

  return [
    {
      path,
      status: before === undefined ? SyncStatuses.CREATED : SyncStatuses.REPLACED,
      apply: () => {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, text);
      },
    },
  ];
};

/**
 * The guard hook in an agent's hooks file (Antigravity): one entry under a key of VULCAN's own, merged into
 * what is there, every other hook left as written. A file that is not JSON, or that git tracks, is left alone.
 */
const planGuardHooksJson = (opts: { root: string; entry: TAgentEntry }): ISyncAction[] => {
  if (opts.entry.guards === null) {
    return [];
  }

  const path = join(opts.root, opts.entry.guards.path);
  const text = existsSync(path) ? readFileSync(path, 'utf8') : undefined;
  const merged = mergeGuardHook({ text });

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

  if (text !== undefined && isTracked({ root: opts.root, path: opts.entry.guards.path })) {
    return [
      {
        path,
        status: SyncStatuses.SKIPPED,
        note: `tracked by git - left alone; add the '${GUARD_HOOK_NAME}' hook by hand (see the hooks reference)`,
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

const planAgentGuards = (opts: { root: string; entry: TAgentEntry }): ISyncAction[] =>
  opts.entry.guards?.kind === AgentGuardKinds.HOOKS_JSON
    ? planGuardHooksJson(opts)
    : planGuardExtension(opts);

/** The MCP files and guard files of every chosen agent, in table order; the shared `.mcp.json` once, at its first reader. */
export const planAgentFiles = (opts: { root: string; agents: string[] }): ISyncAction[] => {
  let sharedPlanned = false;

  return readAgentTable()
    .filter((entry) => opts.agents.includes(entry.id))
    .flatMap((entry) => {
      const guards = planAgentGuards({ root: opts.root, entry });

      if (entry.mcp.scope === AgentScopes.PROJECT) {
        return [...planAgentMcp({ root: opts.root, entry }), ...guards];
      }

      if (sharedPlanned) {
        return guards;
      }

      sharedPlanned = true;

      return [...planSharedMcp({ root: opts.root }), ...guards];
    });
};

/** One line per note of a chosen agent (a trust prompt only the user can answer). */
export const agentNotes = (opts: { agents: string[] }): { agent: string; note: string }[] =>
  readAgentTable()
    .filter((entry) => opts.agents.includes(entry.id))
    .flatMap((entry) => entry.notes.map((note) => ({ agent: entry.id, note })));

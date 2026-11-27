import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { LayoutFolder } from '../common/layout-folder.ts';
import { RecordValue } from '../common/record.ts';
import { BOARD_AGENTS } from '../board/schema.ts';
import { EventSettings } from '../events/settings.ts';
import { AgentConstants } from './common/index.ts';
import type { TLocalChoice, TLocalMigrationFailure } from './common/index.ts';
import { ProfileKeys } from './profile-keys.ts';
import { AgentTable } from './table.ts';

export const LOCAL_AGENTS_FILE = AgentConstants.LOCAL_FILE;

/** The keys `sync --agents` owns in the profile; every other key of the file is kept as it is. */
const OWNED_KEYS = ['schemaVersion'];

/** A key of the old shape: optional, and refused when present with where it went, instead of a bare "unrecognized key". */
const REMOVED_KEY = (opts: { to: string }) =>
  z
    .unknown()
    .superRefine((_value, context) => {
      context.addIssue({
        code: 'custom',
        message: `removed: it is ${opts.to} now; run vulcan project sync to move it`,
      });
    })
    .optional();

/** The machine's keys of the profile, in the groups of the config: the shape the owner's `PROFILE_SCHEMA` and the reader of the choice share. */
export const MACHINE_KEYS = {
  /** `list` is the agents of this machine, over `agent.list` of the committed config. */
  agent: z.strictObject({ list: z.array(z.string()).optional() }).optional(),
  board: z
    .strictObject({
      /** `page.agents` is the roster of the board for this checkout; it replaces `board.page.agents` of the committed config. */
      page: z.strictObject({ agents: BOARD_AGENTS.optional() }).optional(),
      /** `events.dir` replaces `board.events.dir` of the committed config: an absolute folder, such as one shared by several repositories. */
      events: z
        .strictObject({
          dir: z
            .string()
            .superRefine((dir, context) => {
              const message = EventSettings.dirError({ dir });

              if (message !== undefined) {
                context.addIssue({ code: 'custom', message });
              }
            })
            .optional(),
        })
        .optional(),
      /** `serve.autoStart` starts the board at session start on this machine; personal, so a teammate's commit cannot start a listener here. */
      serve: z.strictObject({ autoStart: z.boolean().optional() }).optional(),
      agents: REMOVED_KEY({ to: 'board.page.agents' }),
    })
    .optional(),
  /** `local.tmp` replaces `common.local.tmp` of the committed config. */
  common: z
    .strictObject({
      local: z
        .strictObject({
          tmp: z
            .string()
            .superRefine((folder, context) => {
              const message = LayoutFolder.layoutFolderProblem({ folder });

              if (message !== undefined) {
                context.addIssue({ code: 'custom', message });
              }
            })
            .optional(),
        })
        .optional(),
    })
    .optional(),
};

/** The top-level keys of the old shape, each refused by name; kept out of `MACHINE_KEYS`, which a reset reads as the keys to keep. */
export const REMOVED_MACHINE_KEYS = {
  agents: REMOVED_KEY({ to: 'agent.list' }),
  events: REMOVED_KEY({ to: 'board.events' }),
  local: REMOVED_KEY({ to: 'common.local' }),
};

const LOCAL_SCHEMA = z.object({
  schemaVersion: z.literal(AgentConstants.LOCAL_SCHEMA_VERSION),
  ...MACHINE_KEYS,
  ...REMOVED_MACHINE_KEYS,
});

export class LocalChoice {
  /** The file for `agent.list`; every key `sync` does not own (`board`, `common`, the rest of `agent`) is kept from `previous`, the text of the file as it is. */
  static render(opts: { agents: string[]; previous?: string }): string {
    const kept = LocalChoice.kept({ text: opts.previous });
    const agent = RecordValue.isRecord(kept['agent']) ? kept['agent'] : {};

    return `${JSON.stringify(
      {
        schemaVersion: AgentConstants.LOCAL_SCHEMA_VERSION,
        ...kept,
        agent: { ...agent, list: opts.agents },
      },
      null,
      2,
    )}\n`;
  }

  private static kept(opts: { text: string | undefined }): Record<string, unknown> {
    try {
      const before: unknown = JSON.parse(opts.text ?? '');

      return RecordValue.isRecord(before)
        ? Object.fromEntries(Object.entries(before).filter(([key]) => !OWNED_KEYS.includes(key)))
        : {};
      // eslint-disable-next-line venizia/no-silent-catch -- an old file that cannot be read keeps nothing; migrate reports the unreadable file itself
    } catch {
      return {};
    }
  }

  /**
   * The file `read` takes the choice from: the profile when it has an `agents` key, or when it cannot be read as JSON (that is
   * an error to report, never a reason to fall back to another file); else the file of the earlier release, when it exists.
   */
  private static choiceFile(opts: { root: string }): string {
    const own = join(opts.root, LOCAL_AGENTS_FILE);
    const legacy = join(opts.root, AgentConstants.LEGACY_LOCAL_FILE);

    if (!existsSync(own)) {
      return existsSync(legacy) ? legacy : own;
    }

    try {
      const parsed: unknown = JSON.parse(readFileSync(own, 'utf8'));

      return (RecordValue.isRecord(parsed) &&
        (Object.hasOwn(parsed, 'agent') || Object.hasOwn(parsed, 'agents'))) ||
        !existsSync(legacy)
        ? own
        : legacy;
    } catch {
      return own;
    }
  }

  /**
   * The keys of the file of the earlier release moved into the profile: `schemaVersion` and the machine keys (`MACHINE_KEYS`)
   * only. A key the profile already has keeps the profile's value; `board`, `local` and `events` merge one level down, so a
   * profile that sets `board.serve` still takes `board.agents` from the old file (`kept` names each key the profile won, as
   * `board.agents`). A key the profile does not know stays in the old file: `left` names it, and the old file must stay.
   * `failed` says which file could not be read.
   */
  static migrate(opts: {
    root: string;
  }): { text: string; kept: string[]; left: string[] } | { failed: TLocalMigrationFailure } {
    const read = (file: string): unknown => {
      try {
        return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
        // eslint-disable-next-line venizia/no-silent-catch -- undefined is the unreadable mark: migrate turns it into its failed result
      } catch {
        return undefined;
      }
    };

    const old = read(join(opts.root, AgentConstants.LEGACY_LOCAL_FILE));
    const current = read(join(opts.root, LOCAL_AGENTS_FILE));

    if (!RecordValue.isRecord(old)) {
      return { failed: 'old' };
    }

    if (!RecordValue.isRecord(current)) {
      return { failed: 'profile' };
    }

    // The legacy file has the old paths; its machine keys are put at the new ones and merged under what the profile has.
    const machine = ['agents', 'board', 'events', 'local'];
    const left = Object.keys(old).filter(
      (key) => key !== '$generated' && key !== 'schemaVersion' && !machine.includes(key),
    );
    const incoming = ProfileKeys.toNew({
      value: Object.fromEntries(Object.entries(old).filter(([key]) => machine.includes(key))),
    });
    const merge = ProfileKeys.merge({
      incoming: incoming.value,
      own: ProfileKeys.toNew({ value: current }).value,
      path: '',
    });
    const merged = {
      schemaVersion: AgentConstants.LOCAL_SCHEMA_VERSION,
      ...(RecordValue.isRecord(merge.value) ? merge.value : {}),
    };

    return { text: `${JSON.stringify(merged, null, 2)}\n`, kept: merge.kept, left };
  }

  /** The developer's stored choice: absent is "not chosen yet", a broken file is an error, never a silent default. */
  static read(opts: {
    root: string;
    /** The profile as it will be after `sync` has moved its keys, for a dry run that has not written it. */
    profile?: Record<string, unknown>;
  }): TLocalChoice {
    // The profile first; a machine not yet synced since the upgrade still has its choice in the file of the earlier release.
    const file =
      opts.profile === undefined
        ? LocalChoice.choiceFile(opts)
        : join(opts.root, LOCAL_AGENTS_FILE);

    if (opts.profile === undefined && !existsSync(file)) {
      return { ok: true, agents: undefined };
    }

    let parsed: unknown;

    try {
      parsed = opts.profile ?? JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      return {
        ok: false,
        error: `${LOCAL_AGENTS_FILE} is not valid JSON - fix it (or move it aside), then run: vulcan project sync --agents <list>`,
      };
    }

    // The file of the earlier release has the old paths, and is read as that: it is moved into the profile by `sync`.
    const isLegacy = file === join(opts.root, AgentConstants.LEGACY_LOCAL_FILE);
    const checked = LOCAL_SCHEMA.safeParse(
      isLegacy && RecordValue.isRecord(parsed)
        ? ProfileKeys.toNew({ value: parsed }).value
        : parsed,
    );
    const issue = checked.success ? undefined : checked.error.issues[0];

    if (!checked.success) {
      return {
        ok: false,
        error: `${LOCAL_AGENTS_FILE}: ${[issue?.path.join('.'), issue?.message].filter(Boolean).join(': ')} - fix that key, then run: vulcan project sync`,
      };
    }

    const known = new Set(AgentTable.agentIds());
    const unknown = (checked.data.agent?.list ?? []).find((id) => !known.has(id));

    if (unknown !== undefined) {
      return {
        ok: false,
        error: `${LOCAL_AGENTS_FILE} names unknown agent '${unknown}' - one of: ${[...known].join(', ')}`,
      };
    }

    return { ok: true, agents: checked.data.agent?.list };
  }
}

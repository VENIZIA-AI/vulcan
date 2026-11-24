import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { LayoutFolder } from '../common/layout-folder.ts';
import { RecordValue } from '../common/record.ts';
import { BOARD_AGENTS } from '../board/schema.ts';
import { EventSettings } from '../events/settings.ts';
import { AgentConstants } from './common/index.ts';
import type { TLocalChoice } from './common/index.ts';
import { AgentTable } from './table.ts';

export const LOCAL_AGENTS_FILE = AgentConstants.LOCAL_FILE;

/** The keys `sync --agents` owns in the profile; every other key of the file is kept as it is. */
const OWNED_KEYS = ['schemaVersion', 'agents'];

/** The machine's keys of the profile: the shape the owner's `PROFILE_SCHEMA` and the reader of the choice share. */
export const MACHINE_KEYS = {
  agents: z.array(z.string()).optional(),
  /** The roster of the board for this checkout; it replaces `board.agents` of the committed config. */
  board: z
    .strictObject({
      agents: BOARD_AGENTS.optional(),
      /** `serve.autoStart` starts the board at session start on this machine; personal, so a teammate's commit cannot start a listener here. */
      serve: z.strictObject({ autoStart: z.boolean().optional() }).optional(),
    })
    .optional(),
  /** `dir` replaces `events.dir` of the committed config: an absolute folder, such as one shared by several repositories. */
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
  /** `tmp` replaces `local.tmp` of the committed config. */
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
};

const LOCAL_SCHEMA = z.object({
  schemaVersion: z.literal(AgentConstants.LOCAL_SCHEMA_VERSION),
  ...MACHINE_KEYS,
});

export class LocalChoice {
  /** The file for `agents`; every key `sync` does not own (`board`, `local`) is kept from `previous`, the text of the file as it is. */
  static render(opts: { agents: string[]; previous?: string }): string {
    return `${JSON.stringify(
      {
        schemaVersion: AgentConstants.LOCAL_SCHEMA_VERSION,
        agents: opts.agents,
        ...LocalChoice.kept({ text: opts.previous }),
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

      return (RecordValue.isRecord(parsed) && Object.hasOwn(parsed, 'agents')) ||
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
  }): { text: string; kept: string[]; left: string[] } | { failed: 'old' | 'profile' } {
    const read = (file: string): unknown => {
      try {
        return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
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

    const kept: string[] = [];
    const moved: Record<string, unknown> = {};
    const left = Object.keys(old).filter(
      (key) => key !== '$generated' && key !== 'schemaVersion' && !Object.hasOwn(MACHINE_KEYS, key),
    );

    for (const key of Object.keys(MACHINE_KEYS)) {
      const incoming = old[key];
      const own = current[key];

      if (incoming === undefined) {
        continue;
      }

      if (own === undefined) {
        moved[key] = incoming;
      } else if (RecordValue.isRecord(incoming) && RecordValue.isRecord(own)) {
        moved[key] = { ...incoming, ...own };
        kept.push(
          ...Object.keys(own)
            .filter(
              (sub) =>
                incoming[sub] !== undefined &&
                JSON.stringify(incoming[sub]) !== JSON.stringify(own[sub]),
            )
            .map((sub) => `${key}.${sub}`),
        );
      } else if (JSON.stringify(incoming) !== JSON.stringify(own)) {
        kept.push(key);
      }
    }

    const merged = { schemaVersion: AgentConstants.LOCAL_SCHEMA_VERSION, ...current, ...moved };

    return { text: `${JSON.stringify(merged, null, 2)}\n`, kept, left };
  }

  /** The developer's stored choice: absent is "not chosen yet", a broken file is an error, never a silent default. */
  static read(opts: { root: string }): TLocalChoice {
    // The profile first; a machine not yet synced since the upgrade still has its choice in the file of the earlier release.
    const file = LocalChoice.choiceFile(opts);

    if (!existsSync(file)) {
      return { ok: true, agents: undefined };
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      return {
        ok: false,
        error: `${LOCAL_AGENTS_FILE} is not valid JSON - fix it (or move it aside), then run: vulcan project sync --agents <list>`,
      };
    }

    const checked = LOCAL_SCHEMA.safeParse(parsed);
    const issue = checked.success ? undefined : checked.error.issues[0];

    if (!checked.success) {
      return {
        ok: false,
        error: `${LOCAL_AGENTS_FILE}: ${[issue?.path.join('.'), issue?.message].filter(Boolean).join(': ')} - fix that key, then run: vulcan project sync`,
      };
    }

    const known = new Set(AgentTable.agentIds());
    const unknown = (checked.data.agents ?? []).find((id) => !known.has(id));

    if (unknown !== undefined) {
      return {
        ok: false,
        error: `${LOCAL_AGENTS_FILE} names unknown agent '${unknown}' - one of: ${[...known].join(', ')}`,
      };
    }

    return { ok: true, agents: checked.data.agents };
  }
}

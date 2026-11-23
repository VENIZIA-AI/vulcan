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

/** The keys of the file `sync` writes; any other key is reported by `vulcan doctor` and kept. */
const OWNED_KEYS = ['$generated', 'schemaVersion', 'agents'];
const LOCAL_SCHEMA = z.object({
  schemaVersion: z.literal(AgentConstants.LOCAL_SCHEMA_VERSION),
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
});

export class LocalChoice {
  /** The file for `agents`; every key `sync` does not own (`board`, `local`) is kept from `previous`, the text of the file as it is. */
  static render(opts: { agents: string[]; previous?: string }): string {
    return `${JSON.stringify(
      {
        $generated: AgentConstants.LOCAL_NOTE,
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

  /** The keys of the file that no part of VULCAN reads: a typo such as `boards` would otherwise do nothing, quietly. */
  static unknownKeys(opts: { root: string }): string[] {
    try {
      const file: unknown = JSON.parse(readFileSync(join(opts.root, LOCAL_AGENTS_FILE), 'utf8'));

      return RecordValue.isRecord(file)
        ? Object.keys(file).filter(
            (key) => key !== '$generated' && !Object.hasOwn(LOCAL_SCHEMA.shape, key),
          )
        : [];
    } catch {
      return [];
    }
  }

  /** The developer's stored choice: absent is "not chosen yet", a broken file is an error, never a silent default. */
  static read(opts: { root: string }): TLocalChoice {
    const file = join(opts.root, LOCAL_AGENTS_FILE);

    if (!existsSync(file)) {
      return { ok: true, agents: undefined };
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      return {
        ok: false,
        error: `${LOCAL_AGENTS_FILE} is not valid JSON - delete it and run: vulcan sync --agents <list>`,
      };
    }

    const checked = LOCAL_SCHEMA.safeParse(parsed);
    const issue = checked.success ? undefined : checked.error.issues[0];

    if (!checked.success) {
      return {
        ok: false,
        error: `${LOCAL_AGENTS_FILE}: ${[issue?.path.join('.'), issue?.message].filter(Boolean).join(': ')} - fix that key, or delete the file and run: vulcan sync --agents <list>`,
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

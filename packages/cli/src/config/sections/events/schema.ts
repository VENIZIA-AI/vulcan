import { z } from 'zod';
import { EventRetention } from '../../../events/retention.ts';
import { EventSettings } from '../../../events/settings.ts';

export const EVENTS_SECTION = {
  /**
   * The agent event log: one JSON line per thing an agent did (a session started, a message sent, an
   * owner is needed), summaries only, in `.agents/local/events/<day>.jsonl`. `log: true` makes
   * `vulcan project sync` install the Claude Code hooks that write it; `vulcan event add` writes it for any
   * other agent whatever this says. `dir` is an absolute folder that takes the log instead of the
   * project's own, so one coordinator can read the events of sessions in different repositories.
   * Off by default; written to the manifest only when `log` is true or `dir` is set.
   */
  events: z
    .strictObject({
      /** `true` makes `vulcan project sync` install the hooks that write the event log; default `false`. */
      log: z.boolean().default(false),
      /** Absolute folder that takes the event log instead of the project's own; absent means the project's `.agents/local/events`. */
      dir: z
        .string()
        .min(1)
        .superRefine((value, context) => {
          const error = EventSettings.dirError({ dir: value });

          if (error !== undefined) {
            context.addIssue({ code: 'custom', message: `dir must be ${error}` });
          }
        })
        .optional(),
      /**
       * How much of the log is kept, as whole day files removed oldest first (today's never): `maxSize` for the
       * folder (`50MB`, `200MB`, `1GB`), `maxFiles` for the day files, `maxAgeDays` for their age. The defaults,
       * when `log` is on, are 50MB, 30 files and 30 days.
       */
      maxSize: z
        .string()
        .refine((value) => EventRetention.parseSize({ text: value }) !== undefined, {
          message: 'a size such as 50MB, 200MB or 1GB',
        })
        .optional(),
      /** Most day files kept in the log; at least 1, default 30 when `log` is on. */
      maxFiles: z.number().int().min(1).optional(),
      /** Oldest age, in days, a day file may reach; at least 1, default 30 when `log` is on. */
      maxAgeDays: z.number().int().min(1).optional(),
    })
    .default({ log: false }),
};

import { z } from 'zod';

/** An exported name (`Name`, `Name.member`) or a module specifier (`@scope/package/subpath`): what an app's imports are matched on. */
const SYMBOL_PATTERN =
  /^(?:@[a-z0-9~-][a-z0-9._~-]*\/[a-z0-9._~-]+(?:\/[\w.-]+)*|[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)$/;

/** Lower-case words joined by `-`: a migration id, and a codemod name (which reaches a command line, so never starts with `-`). */
export const MIGRATION_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const TEXT = z.string().min(1);

/** One direction of a migration: a before/after pair, or ordered steps - never both, never neither. */
export const MigrationDirectionSchema = z.union([
  z.strictObject({ before: TEXT, after: TEXT }),
  z.strictObject({ steps: z.array(TEXT).min(1) }),
]);

/** One thing an app must change across the release the entry ships in. */
export const MigrationItemSchema = z.strictObject({
  /** Unique across the project's changelog folder. */
  id: z.string().regex(MIGRATION_NAME_PATTERN),
  symbols: z.array(z.string().regex(SYMBOL_PATTERN)).min(1),
  upgrade: MigrationDirectionSchema,
  downgrade: MigrationDirectionSchema,
  /** Stored data, tokens or formats that do not cross the boundary. */
  data: TEXT.optional(),
  /** The name of an automated rewrite `devz codemod` lists. */
  codemod: z.string().regex(MIGRATION_NAME_PATTERN).optional(),
});

export const MigrationSchema = z.array(MigrationItemSchema).min(1);

export type TMigrationDirection = z.infer<typeof MigrationDirectionSchema>;
export type TMigrationItem = z.infer<typeof MigrationItemSchema>;

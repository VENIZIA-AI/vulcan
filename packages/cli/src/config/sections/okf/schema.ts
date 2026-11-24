import { z } from 'zod';
import { REMOVED_OKF_KEY } from '../../common/schema.ts';

/** A renderer by id: a built-in, or a project module (`module`); a bare string is the id alone. */
const OKF_RENDERER = z.union([
  z.string().transform((id) => ({ id, options: {} })),
  z.strictObject({
    /** Name of the renderer: a built-in, or the identifier a project module registers. */
    id: z.string(),
    /** Path of the project module that exports the renderer; absent means a built-in. */
    module: z.string().optional(),
    /** Options passed to the renderer; default `{}`. */
    options: z.record(z.string(), z.unknown()).default({}),
  }),
]);

export const OKF_SECTION = {
  /** Settings of okf, the knowledge bundle tool: renderers, regions, coverage axes and the brand. */
  okf: z
    .strictObject({
      /** Renderers the project uses, each a built-in id or an object with a module; default `[]`. */
      renderers: z.array(OKF_RENDERER).default([]),
      /** Generated blocks in markdown files, each binding a region `id` and `file` to a `renderer`; default `[]`. */
      regions: z
        .array(z.strictObject({ id: z.string(), file: z.string(), renderer: z.string() }))
        .default([]),
      /** `exclude`: globs from the root dropped from this axis; `denylist`: directory names dropped from this axis only. */
      coverage: z
        .array(
          z.strictObject({
            /** Unique name of the coverage axis. */
            name: z.string(),
            /** Directory or pattern the axis scans. */
            path: z.string(),
            /** Globs from the root dropped from this axis; default `[]`. */
            exclude: z.array(z.string()).default([]),
            /** Directory names dropped from this axis only; default `[]`. */
            denylist: z.array(z.string()).default([]),
          }),
        )
        .default([]),
      /** Directory names no axis counts; an axis's own `denylist` scopes the same idea to one axis. */
      denylist: z.array(z.string()).default([]),
      /** Agent-read files outside the bundle that get a generated contents list when they pass 100 lines. */
      contents: z
        .strictObject({ files: z.array(z.string()).default(['AGENTS.md', '.agents/rules.md']) })
        .default({ files: ['AGENTS.md', '.agents/rules.md'] }),
      /** How the project's name is written in prose, for the brand rule of `okf check`; absent means the root package name without scope, upper-cased. */
      brand: z.string().optional(),
      /** Removed with `vulcan x okf viz`: the key is refused with what to do. */
      viz: REMOVED_OKF_KEY({
        fix: 'delete this key; `vulcan x okf viz` and `make okf-viz` are gone with no replacement, and the brand it carried is now `okf.brand`',
      }),
      /** Removed with the explorer, the only thing that read it. */
      sections: REMOVED_OKF_KEY({ fix: 'delete this key; only the removed explorer read it' }),
    })
    .default({
      renderers: [],
      regions: [],
      coverage: [],
      denylist: [],
      contents: { files: ['AGENTS.md', '.agents/rules.md'] },
    }),
};

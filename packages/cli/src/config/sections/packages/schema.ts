import { z } from 'zod';
import { LayoutFolder } from '../../../common/layout-folder.ts';
import { LibraryKinds, PackageKinds } from '../../common/index.ts';
import { LAYOUT_FOLDER } from '../../common/schema.ts';
import { PackagesSectionConstants } from './constant.ts';

/** One folder, or a list of them: a side whose apps are grouped keeps each group's folder. */
const LAYOUT_VALUE = z.union([LAYOUT_FOLDER, z.array(LAYOUT_FOLDER).min(1)]);

const NPM_PACKAGE_NAME = z.string().superRefine((value, context) => {
  if (
    value.length > PackagesSectionConstants.NPM_NAME_MAX_LENGTH ||
    !PackagesSectionConstants.NPM_NAME_PATTERN.test(value)
  ) {
    context.addIssue({
      code: 'custom',
      message: `package name '${value}' is not an npm package name: npm names are lower case (a to z, digits, . _ ~ -) with an optional @scope/, at most ${PackagesSectionConstants.NPM_NAME_MAX_LENGTH} characters, and atlas refuses the manifest otherwise`,
    });
  }
});

const PROJECT_PACKAGE = z.strictObject({
  /** Unique key of the package, not necessarily its folder name; lower case letters, digits, `.` and `-`, starting with a letter or digit. */
  dir: z.string().regex(/^[a-z0-9][a-z0-9.-]*$/),
  /** The npm package name: lower case, optional `@scope/`, at most 214 characters. */
  name: NPM_PACKAGE_NAME,
  /** Where the package lives, from the root; default `packages/<dir>`. */
  path: z.string().optional(),
  /** Extra names accepted as the `<dir>` of a release tag; default `[]`. */
  aliases: z.array(z.string()).default([]),
  /** `true` marks a package that is gone but whose releases stay readable; its path may be reused. Default `false`. */
  retired: z.boolean().default(false),
  /** A library a preset made lives anywhere a workspace glob covers; absent means an app or a plain package. */
  kind: z.enum([PackageKinds.APP, PackageKinds.LIB]).optional(),
  /** Which preset kind made a library; absent means the `lib` kind. */
  presetKind: z.enum([LibraryKinds.LIB, LibraryKinds.SHARED]).optional(),
});

/** A path as a key: no leading `./`, no trailing slash. */
export const pathKeyOf = (opts: { path: string }): string =>
  opts.path.replace(/^\.\//, '').replace(/\/+$/, '');

/**
 * `dir` is a unique KEY (it need not be the directory name - set `path` for that), so two packages
 * whose directories are both called `core` are `backends-core` and `kits-core`. A repeated key, name or
 * live path would make every table keyed by it collide silently.
 */
const checkPackagesUnique = (
  packages: z.infer<typeof PROJECT_PACKAGE>[],
  context: z.RefinementCtx,
): void => {
  const seen = { dir: new Set<string>(), name: new Set<string>(), path: new Set<string>() };

  for (const [index, entry] of packages.entries()) {
    const path = pathKeyOf({ path: entry.path ?? `packages/${entry.dir}` });
    const repeated = [
      seen.dir.has(entry.dir)
        ? `packages: dir '${entry.dir}' is used twice - dir is a unique key, not the directory name; give each package its own dir and set path`
        : undefined,
      seen.name.has(entry.name) ? `packages: name '${entry.name}' is used twice` : undefined,
      !entry.retired && seen.path.has(path) ? `packages: path '${path}' is used twice` : undefined,
    ];

    for (const message of repeated) {
      if (message !== undefined) {
        context.addIssue({ code: 'custom', message, path: [index] });
      }
    }

    seen.dir.add(entry.dir);
    seen.name.add(entry.name);

    if (!entry.retired) {
      seen.path.add(path);
    }
  }
};

export const PACKAGES_SECTION = {
  /** The folders `vulcan project init` and `add` put apps in, as the user named them. */
  layout: z
    .strictObject({
      /** Folder, or list of folders, for backend apps. */
      backend: LAYOUT_VALUE.optional(),
      /** Folder, or list of folders, for frontend apps. */
      frontend: LAYOUT_VALUE.optional(),
      /** Folder, or list of folders, for code shared between apps. */
      shared: LAYOUT_VALUE.optional(),
      /** Folders the layout does not manage (docs, third-party code, tests): packages there are allowed, never targeted by `add`, never guarded. */
      other: LAYOUT_VALUE.optional(),
    })
    .superRefine((layout, context) => {
      for (const problem of LayoutFolder.layoutOverlapProblems({ layout })) {
        context.addIssue({ code: 'custom', message: problem });
      }
    })
    .optional(),
  /** The presets this project's apps came from (`init` and `add` record them), as `--preset` takes them back. */
  presets: z
    .array(
      z.strictObject({
        /** What was given to `--preset`. */
        spec: z.string().min(1),
        /** Side of the preset's app kind: `backend` or `frontend`. */
        side: z.enum(['backend', 'frontend']),
        /** The app kind's one-sentence summary. */
        summary: z.string(),
        /** The summary of the preset's lib kind, when it ships one. */
        lib: z.string().optional(),
        /** The summary of the preset's shared kind, when it ships one. */
        shared: z.string().optional(),
      }),
    )
    .optional(),
  /** The project's packages in release order; okf, atlas, make and release read this one list. */
  packages: z.array(PROJECT_PACKAGE).superRefine(checkPackagesUnique).default([]),
};

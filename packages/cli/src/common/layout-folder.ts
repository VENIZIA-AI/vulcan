/**
 * The folders a project keeps its apps and shared packages in: the `layout` of the config and of the
 * manifest. One validator for the schema, `add`, `doctor` and `guard-package`, so none of them trusts
 * another. It imports nothing: `guard-package` is a hook that must run when everything else is broken.
 */

/** A folder, or a list of folders, as the layout holds it; a string stays valid. */
export type TLayoutValue = string | string[];

export interface ILayout {
  backend?: TLayoutValue;
  frontend?: TLayoutValue;
  shared?: TLayoutValue;
  /** Folders the layout deliberately does not manage: packages there are not app targets and are not guarded. */
  other?: TLayoutValue;
}

export class LayoutFolderLimits {
  /** `auroras/apps` is two segments. */
  static readonly MAX_SEGMENTS = 4;
  /** One segment: the pattern a layout folder had before it could have several. */
  static readonly SEGMENT_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
  static readonly FORBIDDEN_SEGMENTS = new Set(['node_modules']);
}

/** The keys of a layout: the three a project builds in, and the folders it leaves alone. */
export class LayoutKeys {
  static readonly BACKEND = 'backend';
  static readonly FRONTEND = 'frontend';
  static readonly SHARED = 'shared';
  static readonly OTHER = 'other';
  /** The keys `add` can target and `guard-package` guards. */
  static readonly MANAGED = [this.BACKEND, this.FRONTEND, this.SHARED] as const;
  static readonly ALL = [...this.MANAGED, this.OTHER] as const;
  static readonly SCHEME_SET = new Set<string>(this.ALL);
  static isValid(value: string): boolean {
    return this.SCHEME_SET.has(value);
  }
}

/** Why a layout folder is not one, or undefined when it is: 1 to 4 segments, each a plain lower-case name. */
export const layoutFolderProblem = (opts: { folder: unknown }): string | undefined => {
  const { folder } = opts;

  if (typeof folder !== 'string' || folder === '') {
    return 'a folder is a non-empty string';
  }

  if (folder.includes('\\')) {
    return `'${folder}' has a backslash: a folder is written with '/'`;
  }

  if (folder.startsWith('/') || folder.endsWith('/')) {
    return `'${folder}' starts or ends with '/': a folder is a path from the project root`;
  }

  const segments = folder.split('/');

  if (segments.length > LayoutFolderLimits.MAX_SEGMENTS) {
    return `'${folder}' has more than ${LayoutFolderLimits.MAX_SEGMENTS} segments`;
  }

  for (const segment of segments) {
    if (segment === '') {
      return `'${folder}' has an empty segment`;
    }

    if (segment === '..' || segment === '.') {
      return `'${folder}' climbs or repeats a folder ('${segment}')`;
    }

    if (LayoutFolderLimits.FORBIDDEN_SEGMENTS.has(segment)) {
      return `'${folder}' goes through '${segment}'`;
    }

    if (!LayoutFolderLimits.SEGMENT_PATTERN.test(segment)) {
      return `'${folder}' has the segment '${segment}': lowercase letters, digits and '-', starting with a letter or digit`;
    }
  }

  return undefined;
};

/** The folders a layout value names, in order: a string is one, a list is its strings. Nothing is validated. */
export const layoutFoldersOf = (opts: { value: unknown }): string[] => {
  const { value } = opts;

  if (typeof value === 'string') {
    return [value];
  }

  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
};

/** Whether `inner` is `outer` or sits below it. */
const isWithin = (opts: { inner: string; outer: string }): boolean =>
  opts.inner === opts.outer || opts.inner.startsWith(`${opts.outer}/`);

const entriesOf = (opts: { layout: ILayout }): { key: string; folder: string }[] =>
  LayoutKeys.ALL.flatMap((key) =>
    layoutFoldersOf({ value: opts.layout[key] }).map((folder) => ({ key, folder })),
  );

/** A folder listed twice or under two keys, and a folder inside another: a package path must belong to exactly one folder. */
export const layoutOverlapProblems = (opts: { layout: ILayout }): string[] => {
  const entries = entriesOf({ layout: opts.layout }).filter(
    (entry) => layoutFolderProblem({ folder: entry.folder }) === undefined,
  );
  const problems: string[] = [];

  for (const [index, entry] of entries.entries()) {
    for (const other of entries.slice(index + 1)) {
      if (entry.folder === other.folder) {
        problems.push(
          `layout.${other.key} names '${other.folder}' again (also layout.${entry.key}): a folder belongs to one kind of code`,
        );
      } else if (
        isWithin({ inner: entry.folder, outer: other.folder }) ||
        isWithin({ inner: other.folder, outer: entry.folder })
      ) {
        problems.push(
          `layout.${entry.key} '${entry.folder}' and layout.${other.key} '${other.folder}' are nested: a package path must belong to exactly one folder`,
        );
      }
    }
  }

  return problems;
};

/** Every problem of a layout, one line each: the folders that are not one, then the overlaps. */
export const layoutProblems = (opts: { layout: ILayout }): string[] => [
  ...entriesOf({ layout: opts.layout }).flatMap((entry) => {
    const problem = layoutFolderProblem({ folder: entry.folder });

    return problem === undefined ? [] : [`layout.${entry.key}: ${problem}`];
  }),
  ...layoutOverlapProblems({ layout: opts.layout }),
];

/** The layout value with `folder` in it: unchanged when it is there already, a string that grows into a list otherwise. */
export const withLayoutFolder = (opts: {
  value: TLayoutValue | undefined;
  folder: string;
}): TLayoutValue => {
  const folders = layoutFoldersOf({ value: opts.value });

  if (folders.includes(opts.folder)) {
    return opts.value ?? opts.folder;
  }

  return folders.length === 0 ? opts.folder : [...folders, opts.folder];
};

/** The layout key whose folder is exactly `folder`, or undefined. Only valid folders count. */
export const layoutKeyOfFolder = (opts: { layout: ILayout; folder: string }): string | undefined =>
  LayoutKeys.ALL.find((key) =>
    layoutFoldersOf({ value: opts.layout[key] }).some(
      (folder) => folder === opts.folder && layoutFolderProblem({ folder }) === undefined,
    ),
  );

/** The valid folders of a layout value; a manifest is read through this, never trusted. */
export const validLayoutFolders = (opts: { value: unknown }): string[] =>
  layoutFoldersOf({ value: opts.value }).filter(
    (folder) => layoutFolderProblem({ folder }) === undefined,
  );

/** The folders as a sentence part: `'a'`, or `'a', 'b'`. */
export const describeFolders = (opts: { folders: string[] }): string =>
  opts.folders.map((folder) => `'${folder}'`).join(', ');

/** What an error says when a flag must pick among several listed folders. */
export const listedFoldersNote = (opts: { folders: string[] }): string =>
  `the layout lists ${describeFolders({ folders: opts.folders })}`;

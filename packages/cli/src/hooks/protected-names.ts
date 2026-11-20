import { HookConstants } from './common/index.ts';

/** The files the guards read their policy from, as names a pattern can be matched against. */
export class ProtectedNames {
  /** The paths of `HookConstants.PROTECTED_FILES` as names, bar the installed package (its removal is left to `bun install`); a `*` of the list stands for the usual extensions. */
  static readonly FILES = HookConstants.PROTECTED_FILES.filter(
    (pattern) => !pattern.startsWith('node_modules'),
  ).flatMap((pattern) =>
    pattern.endsWith('.*')
      ? ['mts', 'ts', 'js', 'mjs', 'cjs', 'json'].map(
          (extension) => `${pattern.slice(0, -1)}${extension}`,
        )
      : [pattern],
  );

  /** Every protected name and every folder above one, lower case: what a pattern such as `.claude/*` may reach. */
  static readonly REACH = [
    ...new Set(
      ProtectedNames.FILES.flatMap((name) => {
        const parts = name.toLowerCase().split('/');

        return parts.map((_, index) => parts.slice(0, index + 1).join('/'));
      }),
    ),
  ];

  /** The last name of each of those, lower case: what `find -name` is matched against. */
  static readonly BASENAMES = [
    ...new Set(ProtectedNames.REACH.map((name) => name.slice(name.lastIndexOf('/') + 1))),
  ];

  /** Whether a `find -name` pattern can match the name of a protected file or of a folder that holds one. */
  static isNameReachable(opts: { pattern: string }): boolean {
    const glob = new Bun.Glob(opts.pattern.toLowerCase());

    return ProtectedNames.BASENAMES.some((name) => glob.match(name));
  }
}

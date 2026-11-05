import type { IAtlasProject } from '@/common/project-config';

/** The packages a `--package` value can stand for: a directory id, an npm name or the path from the project root. */
export class ApiPackages {
  /** A path as the manifest writes it: no leading `./`, no trailing slash. */
  private static pathOf(opts: { value: string }): string {
    return opts.value.replace(/^\.\//, '').replace(/\/+$/, '');
  }

  /**
   * The npm names the `--package` values stand for (undefined when there is none), and the values that match no package of
   * the project. A value matches a package by its `dir`, its npm name or its `path`.
   */
  static resolve(opts: { args: string[]; project: IAtlasProject }): {
    names?: string[];
    unmatched: string[];
  } {
    const wanted = opts.args.flatMap((arg, at) =>
      arg === '--package' ? [opts.args[at + 1] ?? ''] : [],
    );

    if (wanted.length === 0) {
      return { unmatched: [] };
    }

    const matches = (value: string) =>
      opts.project.packages.filter(
        (entry) =>
          entry.dir === value ||
          entry.name === value ||
          entry.path === ApiPackages.pathOf({ value }),
      );

    return {
      names: [...new Set(wanted.flatMap((value) => matches(value).map((entry) => entry.name)))],
      unmatched: wanted.filter((value) => matches(value).length === 0),
    };
  }
}

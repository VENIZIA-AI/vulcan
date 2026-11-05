import type { IAtlasProject } from '@/common/project-config';

const FLAG = '--package';

/** The packages a `--package` value can stand for: a directory id, an npm name or the path from the project root. */
export class ApiPackages {
  /** A path as the manifest writes it: no leading `./`, no trailing slash. */
  private static pathOf(opts: { value: string }): string {
    return opts.value.replace(/^\.\//, '').replace(/\/+$/, '');
  }

  /** The values of `--package <value>` and `--package=<value>`, in order; a flag with no value gives an empty one. */
  private static valuesOf(opts: { args: string[] }): string[] {
    return opts.args.flatMap((arg, at) => {
      if (arg === FLAG) {
        const next = opts.args[at + 1];

        return [next === undefined || next.startsWith('--') ? '' : next];
      }

      return arg.startsWith(`${FLAG}=`) ? [arg.slice(FLAG.length + 1)] : [];
    });
  }

  /**
   * The npm names the `--package` values stand for (undefined when there is none), and the values that match no live
   * package of the project, each once. A value matches by its `dir`, its npm name or its `path`; a retired package is read by
   * nothing here, so it matches nothing. A flag with no value is reported as such.
   */
  static resolve(opts: { args: string[]; project: IAtlasProject }): {
    names?: string[];
    unmatched: string[];
  } {
    const wanted = ApiPackages.valuesOf({ args: opts.args });

    if (wanted.length === 0) {
      return { unmatched: [] };
    }

    const live = opts.project.packages.filter((entry) => !entry.retired);
    const matches = (value: string) =>
      live.filter(
        (entry) =>
          entry.dir === value ||
          entry.name === value ||
          entry.path === ApiPackages.pathOf({ value }),
      );

    return {
      names: [...new Set(wanted.flatMap((value) => matches(value).map((entry) => entry.name)))],
      unmatched: [...new Set(wanted.filter((value) => matches(value).length === 0))],
    };
  }
}

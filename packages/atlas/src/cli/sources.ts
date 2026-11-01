import { basename } from 'node:path';
import type { IAtlasSource } from '@/sources/common';

const DEFAULT_REF = 'develop';
const SOURCE_FLAG = '--source';

export class SourceArguments {
  /** `owner/repo@ref`, `owner/repo` (on develop), or a git URL with `@ref` - the name is the repository's. */
  static parse(opts: { value: string }): IAtlasSource {
    const at = opts.value.lastIndexOf('@');
    const hasRef = at > opts.value.lastIndexOf('/');
    const repo = hasRef ? opts.value.slice(0, at) : opts.value;
    const ref = hasRef ? opts.value.slice(at + 1) : DEFAULT_REF;

    return { name: basename(repo).replace(/\.git$/, ''), repo, ref };
  }

  /** Every `--source <value>` and `--source=<value>`, in order. */
  static read(opts: { argv: string[] }): IAtlasSource[] {
    return opts.argv.flatMap((argument, index) => {
      if (argument.startsWith(`${SOURCE_FLAG}=`)) {
        return [SourceArguments.parse({ value: argument.slice(SOURCE_FLAG.length + 1) })];
      }

      const value = opts.argv[index + 1];

      return argument === SOURCE_FLAG && value !== undefined && !value.startsWith('--')
        ? [SourceArguments.parse({ value })]
        : [];
    });
  }
}

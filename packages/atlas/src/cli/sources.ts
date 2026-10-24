import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import type { IAtlasSource } from '@/sources/common';

const DEFAULT_REF = 'develop';
const SOURCE_FLAG = '--source';

/** `owner/repo@ref`, `owner/repo` (on develop), or a git URL with `@ref` - the name is the repository's. */
export const parseSourceArgument = (opts: { value: string }): IAtlasSource => {
  const at = opts.value.lastIndexOf('@');
  const hasRef = at > opts.value.lastIndexOf('/');
  const repo = hasRef ? opts.value.slice(0, at) : opts.value;
  const ref = hasRef ? opts.value.slice(at + 1) : DEFAULT_REF;

  return { name: basename(repo).replace(/\.git$/, ''), repo, ref };
};

/** Every `--source <value>` and `--source=<value>`, in order. */
export const readSourceArguments = (opts: { argv: string[] }): IAtlasSource[] =>
  opts.argv.flatMap((argument, index) => {
    if (argument.startsWith(`${SOURCE_FLAG}=`)) {
      return [parseSourceArgument({ value: argument.slice(SOURCE_FLAG.length + 1) })];
    }

    const value = opts.argv[index + 1];

    return argument === SOURCE_FLAG && value !== undefined && !value.startsWith('--')
      ? [parseSourceArgument({ value })]
      : [];
  });

/** `$XDG_CONFIG_HOME/vulcan/atlas.json` - \`{ "sources": [{ "name", "repo", "ref" }] }\`, for use outside any project. */
export const readUserSources = (opts: { configHome?: string } = {}): IAtlasSource[] => {
  const home = opts.configHome ?? process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
  const file = join(home, 'vulcan', 'atlas.json');

  if (!existsSync(file)) {
    return [];
  }

  const config: { sources?: { name?: unknown; repo?: unknown; ref?: unknown }[] } = JSON.parse(
    readFileSync(file, 'utf8'),
  );

  return (config.sources ?? []).flatMap((source) =>
    typeof source.name === 'string' && typeof source.repo === 'string'
      ? [
          {
            name: source.name,
            repo: source.repo,
            ref: typeof source.ref === 'string' ? source.ref : DEFAULT_REF,
          },
        ]
      : [],
  );
};

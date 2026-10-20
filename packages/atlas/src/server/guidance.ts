import type { IResolvedSource, IUnavailableSource } from '@/sources/common';

/** "acme", "acme and forge", "acme, forge and anvil". */
const joinNames = (opts: { names: string[] }): string =>
  opts.names.length <= 1
    ? opts.names.join('')
    : `${opts.names.slice(0, -1).join(', ')} and ${opts.names[opts.names.length - 1]}`;

/** The projects atlas holds, in the order the config lists them. */
export const projectsOf = (opts: { sources: IResolvedSource[] }): string =>
  joinNames({ names: opts.sources.map(source => source.name) });

/** `@venizia/*`, `@acme/*`: the npm scopes of the packages these projects publish; a bare name stands for itself. */
const packageScopesOf = (opts: { sources: IResolvedSource[] }): string => {
  const scopes = new Set<string>();

  for (const source of opts.sources) {
    for (const entry of source.project.packages) {
      const scope = entry.name.startsWith('@') ? entry.name.split('/')[0] : undefined;

      scopes.add(scope === undefined ? `\`${entry.name}\`` : `\`${scope}/*\``);
    }
  }

  return [...scopes].sort().join(', ');
};

/** How each source was reached and which could not be served: a client sees it on initialize. */
const statusOf = (opts: { sources: IResolvedSource[]; unavailable: IUnavailableSource[] }) => {
  const lines = opts.sources.map(source => {
    if (source.mode === 'repository') {
      return `- ${source.name}: this repository, live`;
    }

    const at = `${source.origin ?? source.name} at ${(source.sha ?? '').slice(0, 8)}`;

    const note =
      source.history === false
        ? ' - no git on this machine: version and changes have no release history'
        : '';

    return source.mode === 'offline-cache'
      ? `- ${source.name}: ${at} - OFFLINE: the remote was unreachable, this is the newest cache, not the ref's current commit${note}`
      : `- ${source.name}: ${at}${note}`;
  });

  const missing = opts.unavailable.map(
    ({ source, reason }) =>
      `- ${source.name}: UNAVAILABLE (${source.repo}@${source.ref}) - ${reason}; nothing from it is served`,
  );

  return [...lines, ...missing];
};

/**
 * What the agent reads when atlas connects: which corpora it holds, when to reach for each tool,
 * and the rule that framework facts come from here, not from memory. The status lines say how
 * each source was reached.
 */
export const instructionsOf = (opts: {
  sources: IResolvedSource[];
  unavailable: IUnavailableSource[];
}): string => {
  const projects = projectsOf({ sources: opts.sources });
  const corpora = joinNames({
    names: opts.sources.map(source =>
      source.mode === 'repository' ? `${source.name} (this repository)` : source.name,
    ),
  });
  const scopes = packageScopesOf({ sources: opts.sources });

  return [
    `Atlas holds the real code and docs of ${corpora}.`,
    `- Before you write or change code that imports ${scopes === '' ? 'their packages' : `their packages (${scopes})`}, call \`symbol\` for each export you use: its real signature, import path and source line.`,
    '- When the user asks how something works or which convention applies, call `search` first, then `get` for the hits that matter.',
    '- When a version, a release or an upgrade comes up, call `version` or `changes`.',
    `Do not answer facts about ${projects} from memory when atlas can answer them.`,
    '',
    `Atlas serves ${opts.sources.length} source(s); every hit names its source.`,
    ...statusOf(opts),
  ].join('\n');
};

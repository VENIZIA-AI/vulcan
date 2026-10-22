import type { IResolvedSource, IUnavailableSource } from '@/sources/common';

const TRIGGER_MAX = 110;

export interface ISkillLine {
  name: string;
  trigger: string;
}

/** A trigger cut at its last comma or space within the limit, so a line never ends mid-word. */
const shortened = (opts: { text: string }): string => {
  if (opts.text.length <= TRIGGER_MAX) {
    return opts.text;
  }

  const head = opts.text.slice(0, TRIGGER_MAX + 1);
  const comma = head.lastIndexOf(',');
  const space = head.lastIndexOf(' ');
  const at = comma > TRIGGER_MAX / 2 ? comma : space;

  return head.slice(0, at === -1 ? TRIGGER_MAX : at).replace(/[,;:\s]+$/, '');
};

/** One line per skill, after the how-to-build paragraph and before the status lines, which a client may cut first. */
const skillsParagraph = (opts: { skills: ISkillLine[] }): string[] =>
  opts.skills.length === 0
    ? []
    : [
        [
          'Skills: a request matches one, load it before you answer. A workflow question counts.',
          ...opts.skills.map(skill => `- \`${skill.name}\`: ${shortened({ text: skill.trigger })}`),
        ].join('\n'),
        '',
      ];

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
    const pin =
      source.pin === undefined
        ? ''
        : source.pin.pinned
          ? ` - docs pinned to ${source.pin.ref}, the ${source.pin.reason}; release table from the configured ref`
          : ` - docs follow ${source.pin.ref}, not the installed version (${source.pin.reason})`;

    const note =
      source.history === false
        ? ' - no git on this machine: version and changes have no release history'
        : '';

    return source.mode === 'offline-cache'
      ? `- ${source.name}: ${at} - OFFLINE: the remote was unreachable, this is the newest cache, not the ref's current commit${note}`
      : `- ${source.name}: ${at}${pin}${note}`;
  });

  const missing = opts.unavailable.map(
    ({ source, reason }) =>
      `- ${source.name}: UNAVAILABLE (${source.repo}@${source.ref}) - ${reason}; nothing from it is served`,
  );

  return [...lines, ...missing];
};

const CORPORA_MAX = 4;
const SCOPES_MAX = 3;

/** The corpora as the lead names them: at most four, the rest counted, so the lead keeps to 512 characters. */
const corporaPhrase = (opts: { sources: IResolvedSource[] }): string => {
  const names = opts.sources.map(source =>
    source.mode === 'repository' ? `${source.name} (this repository)` : source.name,
  );

  if (names.length <= CORPORA_MAX) {
    return joinNames({ names });
  }

  return `${names.slice(0, CORPORA_MAX).join(', ')} and ${names.length - CORPORA_MAX} more`;
};

const scopesPhrase = (opts: { sources: IResolvedSource[] }): string => {
  const scopes = packageScopesOf(opts)
    .split(', ')
    .filter(scope => scope !== '');

  if (scopes.length === 0) {
    return 'their packages';
  }

  return `their packages (${scopes.slice(0, SCOPES_MAX).join(', ')}${scopes.length > SCOPES_MAX ? ', ...' : ''})`;
};

/**
 * What the agent reads when atlas connects. The lead paragraph alone carries the corpora, the rule
 * and the triggers in at most 512 characters, because a client may keep only that much; the second
 * paragraph says when a how-to-build question must search first; the status lines after it say how
 * each source was reached.
 */
export const instructionsOf = (opts: {
  sources: IResolvedSource[];
  unavailable: IUnavailableSource[];
  skills?: ISkillLine[];
}): string => {
  const projects = projectsOf({ sources: opts.sources });

  return [
    `Atlas holds the real code and docs of ${corporaPhrase(opts)}. Do not answer facts about ${projects} from memory when atlas can answer them: call \`symbol\` for each export before you write code that imports ${scopesPhrase(opts)}, \`search\` then \`get\` when the user asks how something works or which convention applies, \`version\` or \`changes\` for a release or an upgrade, \`presets\` before you create an app or package.`,
    '',
    `Before you answer how to build something in ${projects} (a feature, a controller, a service, a repository, a datasource) or how a convention is organised, call \`search\` and read the hits with \`get\`; do not answer from the files you happen to open. A plan never says "check atlas" for a step you have not done: call it first.`,
    '',
    ...skillsParagraph({ skills: opts.skills ?? [] }),
    `Atlas serves ${opts.sources.length} source(s); every hit names its source.`,
    ...statusOf(opts),
  ].join('\n');
};

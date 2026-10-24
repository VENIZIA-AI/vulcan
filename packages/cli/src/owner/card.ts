import { OwnerConstants, OwnerEnforcement, OwnerSections } from './constants.ts';
import type { IOwnerView } from './view.ts';

/** Free text as one quotable line: whitespace collapsed, quotes softened, cut to the card's limit. */
const plain = (opts: { text: string }): string =>
  opts.text
    .replace(/\s+/g, ' ')
    .replace(/"/g, "'")
    .trim()
    .slice(0, OwnerConstants.CARD_ABOUT_MAX_CHARACTERS);

const SECTION_TEXT = (opts: { section: string; view: IOwnerView }): string => {
  const { labels, headlineMaxSentences } = opts.view;
  const [number, task, status] = labels.minimapColumns;
  const statuses = Object.values(labels.status).join(', ');

  switch (opts.section) {
    case OwnerSections.HEADLINE: {
      return `a headline: the answer first, at most ${headlineMaxSentences} sentence${headlineMaxSentences === 1 ? '' : 's'}, no preamble`;
    }
    case OwnerSections.MINIMAP: {
      return `a table \`| ${number} | ${task} | ${status} |\` whose status is one of: ${statuses}`;
    }
    case OwnerSections.BLOCKED: {
      return `one line \`${labels.labels.blocked}\` naming the blocker, or \`${labels.labels.noBlocker}\``;
    }
    case OwnerSections.DETAIL: {
      return 'detail: tables over prose, every technical point with its plain meaning';
    }
    case OwnerSections.DECISIONS: {
      return `\`${labels.labels.decisions}\`: a numbered list, each ending \`${labels.labels.recommend}\`, or exactly \`${labels.labels.noDecision}\``;
    }
    default: {
      return opts.section;
    }
  }
};

/** The shape every answer to the owner follows, from the resolved view; empty when enforcement is off. */
export const renderOwnerShapeCard = (opts: { view: IOwnerView }): string[] => {
  if (opts.view.enforce === OwnerEnforcement.OFF) {
    return [];
  }

  const { view } = opts;

  return [
    '## How to answer the owner',
    '',
    `Every reply, in this order: ${view.shape.map((section) => SECTION_TEXT({ section, view })).join('; ')}.`,
    ...(view.absolutePaths ? ['Name a file the owner should open by its full absolute path.'] : []),
    `Language: ${view.language}. Identifiers stay in backticks. Say what is unverified and what you got wrong, plainly.`,
  ];
};

/** What the person told VULCAN about working with them; empty when there is no profile. */
export const renderProfileCard = (opts: { view: IOwnerView }): string[] => {
  const { view } = opts;

  if (view.address === undefined) {
    return [];
  }

  const about = view.about === undefined ? '' : ` In their words: "${plain({ text: view.about })}"`;

  return [
    '## Working with this person',
    '',
    [
      `Reply in ${view.language}.`,
      view.address.you === undefined ? '' : `Address them as "${view.address.you}".`,
      view.address.self === undefined ? '' : `Refer to yourself as "${view.address.self}".`,
      `Formality: ${view.address.formality}. Tone: ${view.tone}. Reports: ${view.reportDetail === 'headline' ? 'headline only' : 'headline plus tables'}.`,
      view.habits?.askBeforeReversible === true
        ? 'Ask before a reversible choice.'
        : 'For a reversible choice state a default and continue.',
      view.habits?.proposeCommits === true ? 'Propose commits.' : '',
      view.codeTaste === undefined
        ? ''
        : `Their code taste, in their words: "${plain({ text: view.codeTaste })}".`,
    ]
      .filter((part) => part !== '')
      .join(' ') + about,
  ];
};

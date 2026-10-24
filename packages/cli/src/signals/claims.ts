import { ClaimClasses, ClaimWords } from './constants.ts';
import type { ISignalState } from './state.ts';

const LETTER_OR_DIGIT = String.raw`\p{L}\p{N}`;

const escaped = (opts: { text: string }): string =>
  opts.text.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

/** The sentences a reply asserts: code, quotes and questions are not assertions, and each sentence stands alone. */
const sentencesOf = (opts: { text: string }): string[] =>
  opts.text
    .normalize('NFC')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('>'))
    .join('\n')
    .split(/(?<=[.!?…。！？])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== '' && !sentence.endsWith('?'));

const hasWord = (opts: { sentence: string; word: string }): boolean =>
  new RegExp(
    `(?<![${LETTER_OR_DIGIT}])${escaped({ text: opts.word.normalize('NFC') })}(?![${LETTER_OR_DIGIT}])`,
    'iu',
  ).test(opts.sentence);

const isDenied = (opts: { sentence: string }): boolean =>
  ClaimWords.NEGATIONS.some((word) =>
    word === "n't"
      ? opts.sentence.toLowerCase().includes(word)
      : hasWord({ sentence: opts.sentence, word }),
  );

/** Whether a sentence of the reply asserts one of the phrases, and does not deny it. */
const asserts = (opts: { text: string; words: string[] }): boolean =>
  sentencesOf({ text: opts.text }).some(
    (sentence) => !isDenied({ sentence }) && opts.words.some((word) => hasWord({ sentence, word })),
  );

/**
 * What the reply claims against what the turn's calls show. A claim that something is published, released
 * or live needs a public-state probe in the turn; a claim that the checks pass is contradicted while a gate
 * of the turn still failed on its latest run. Phrases match whole words in a sentence that does not deny,
 * ask or quote; English plus any the project adds. Logged, never blocked: a match is a hint, not proof.
 */
export const checkClaims = (opts: {
  text: string;
  state: ISignalState;
  publicWords?: string[];
  doneWords?: string[];
}): string[] => {
  const classes: string[] = [];
  const { state } = opts;

  if (
    asserts({ text: opts.text, words: [...ClaimWords.PUBLIC, ...(opts.publicWords ?? [])] }) &&
    state.probeAt < state.turnAt
  ) {
    classes.push(ClaimClasses.PUBLIC_CLAIM_NO_PROBE);
  }

  if (
    asserts({ text: opts.text, words: [...ClaimWords.DONE, ...(opts.doneWords ?? [])] }) &&
    state.failedGates.length > 0
  ) {
    classes.push(ClaimClasses.CONTRADICTED_COMPLETION);
  }

  return classes;
};

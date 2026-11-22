/** The most words a sentence has before the page warns: a long sentence holds more than one idea. */
const MAX_WORDS = 30;
/** Fields that are not prose: code, links, colours and the owner's own labels. */
const NOT_PROSE = new Set([
  'lines',
  'href',
  'chrome',
  'source',
  'accent',
  'accentDark',
  'accentText',
]);

const proseOf = (opts: { value: unknown; found: string[] }): void => {
  const { value, found } = opts;

  if (typeof value === 'string') {
    found.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) {
      proseOf({ value: item, found });
    }
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      if (!NOT_PROSE.has(key)) {
        proseOf({ value: item, found });
      }
    }
  }
};

export class PlainWriting {
  /** A warning for each sentence of more than 30 words; the check cannot judge the rest of the writing style. */
  static warnings(opts: { spec: unknown }): string[] {
    const found: string[] = [];

    proseOf({ value: opts.spec, found });

    return found
      .flatMap((line) => line.split(/(?<=[.!?;:])\s+/))
      .filter((sentence) => sentence.trim().split(/\s+/).length > MAX_WORDS)
      .map(
        (sentence) =>
          `a sentence of more than ${MAX_WORDS} words, split it: "${sentence.slice(0, 50)}..."`,
      );
  }
}

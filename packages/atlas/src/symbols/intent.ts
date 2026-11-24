import type { ISymbolRecord } from './common';

/** What the TSDoc of an export says about when to use it. */
export interface ISymbolTags {
  /** The situation in the user's words (`@useWhen`). */
  useWhen?: string;
  /** What an app writes by hand instead (`@insteadOf`), free text. */
  insteadOf?: string;
  /** The first `@example` block. */
  example?: string;
}

export interface IIntentHit {
  record: ISymbolRecord;
  tags: ISymbolTags;
  score: number;
}

const TAG = /^@([A-Za-z]+)\b[ \t]*(.*)$/;
/** A tag the prose of a field never runs into: the next `@tag` at the start of a line ends it. */
const FIELD_WEIGHTS = { useWhen: 4, insteadOf: 3, name: 2, doc: 1 } as const;
const BM25_K1 = 1.2;
const BM25_B = 0.75;
const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'to',
  'of',
  'for',
  'and',
  'or',
  'in',
  'on',
  'is',
  'it',
  'i',
  'my',
  'me',
  'we',
  'do',
  'how',
  'with',
  'that',
  'this',
  'be',
  'can',
  'need',
  'want',
  'when',
  'you',
  'your',
  'use',
]);

/**
 * Finds the exports that answer a need in the user's words. The index is the exports' own TSDoc: `@useWhen` and
 * `@insteadOf` (and the first `@example`) are read from the `doc` the symbol table already holds, so no index
 * format moves and a symbol without the tags is still found by its name and prose, ranked lower. Ranking is BM25
 * over the fields, weighted `useWhen` 4, `insteadOf` 3, name 2, prose 1; no embeddings, no network.
 */
export class SymbolIntent {
  /** The three tags of a TSDoc text; a tag runs to the next `@tag` line. */
  static tagsOf(opts: { doc?: string }): ISymbolTags {
    const found: Record<string, string[]> = {};
    let current: string | undefined;

    for (const line of (opts.doc ?? '').split('\n')) {
      const tag = TAG.exec(line.trim());

      if (tag !== null) {
        current = tag[1];
        found[current] = [...(found[current] ?? []), tag[2] ?? ''];
        continue;
      }

      if (current !== undefined) {
        const last = (found[current] ?? []).length - 1;

        found[current][last] = `${found[current][last]}\n${line}`;
      }
    }

    const clean = (parts: string[] | undefined): string | undefined => {
      const text = (parts ?? [])
        .map((part) => part.trim())
        .filter((part) => part !== '')
        .join(' ')
        .replace(/\s*\n\s*/g, ' ')
        .trim();

      return text === '' ? undefined : text;
    };
    const example = (found.example?.[0] ?? '').replace(/^\n+/, '').trimEnd();

    return {
      ...(clean(found.useWhen) === undefined ? {} : { useWhen: clean(found.useWhen) }),
      ...(clean(found.insteadOf) === undefined ? {} : { insteadOf: clean(found.insteadOf) }),
      ...(example.trim() === '' ? {} : { example }),
    };
  }

  /** The prose of a TSDoc without any tag section. */
  static proseOf(opts: { doc?: string }): string {
    const lines: string[] = [];

    for (const line of (opts.doc ?? '').split('\n')) {
      if (TAG.test(line.trim())) {
        break;
      }

      lines.push(line);
    }

    return lines.join(' ').trim();
  }

  /** Lower-cased words, a camelCase name split, a plural or an `-ing`/`-ed` ending cut. */
  static tokensOf(opts: { text: string }): string[] {
    return opts.text
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word !== '' && !STOP_WORDS.has(word))
      .map((word) =>
        word.length > 4 && /(ing|ed)$/.test(word)
          ? word.replace(/(ing|ed)$/, '')
          : word.length > 3 && word.endsWith('s') && !word.endsWith('ss')
            ? word.slice(0, -1)
            : word,
      );
  }

  /** The `limit` best exports for `query`, best first; an export that shares no word with it is never a hit. */
  static rank(opts: { records: ISymbolRecord[]; query: string; limit: number }): IIntentHit[] {
    const wanted = [...new Set(SymbolIntent.tokensOf({ text: opts.query }))];

    if (wanted.length === 0) {
      return [];
    }

    const documents = opts.records.map((record) => {
      const tags = SymbolIntent.tagsOf({ doc: record.doc });
      const fields = {
        useWhen: SymbolIntent.tokensOf({ text: tags.useWhen ?? '' }),
        insteadOf: SymbolIntent.tokensOf({ text: tags.insteadOf ?? '' }),
        name: SymbolIntent.tokensOf({ text: record.name }),
        doc: SymbolIntent.tokensOf({ text: SymbolIntent.proseOf({ doc: record.doc }) }),
      };
      const length = Object.entries(fields).reduce(
        (sum, [field, tokens]) =>
          sum + tokens.length * FIELD_WEIGHTS[field as keyof typeof FIELD_WEIGHTS],
        0,
      );

      return { record, tags, fields, length };
    });
    const average = documents.reduce((sum, entry) => sum + entry.length, 0) / documents.length || 1;
    const frequency = new Map<string, number>();

    for (const word of wanted) {
      frequency.set(
        word,
        documents.filter((entry) =>
          Object.values(entry.fields).some((tokens) => tokens.includes(word)),
        ).length,
      );
    }

    return documents
      .map((entry) => {
        let score = 0;

        for (const word of wanted) {
          const weighted = Object.entries(entry.fields).reduce(
            (sum, [field, tokens]) =>
              sum +
              tokens.filter((token) => token === word).length *
                FIELD_WEIGHTS[field as keyof typeof FIELD_WEIGHTS],
            0,
          );

          if (weighted === 0) {
            continue;
          }

          const containing = frequency.get(word) ?? 0;
          const idf = Math.log(1 + (documents.length - containing + 0.5) / (containing + 0.5));

          score +=
            (idf * weighted * (BM25_K1 + 1)) /
            (weighted + BM25_K1 * (1 - BM25_B + (BM25_B * entry.length) / average));
        }

        return { record: entry.record, tags: entry.tags, score };
      })
      .filter((hit) => hit.score > 0)
      .sort(
        (left, right) =>
          right.score - left.score || left.record.name.localeCompare(right.record.name),
      )
      .slice(0, opts.limit);
  }
}

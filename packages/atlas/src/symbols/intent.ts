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
  /** The name the import line brings in: the class of a `Class.member` hit, else the record's own name. */
  importName: string;
  tags: ISymbolTags;
  score: number;
}

type TIntentField = 'useWhen' | 'insteadOf' | 'name' | 'doc';

/** One record as the ranking reads it, tokenized once per loaded record. */
interface IIntentDocument {
  record: ISymbolRecord;
  importName: string;
  tags: ISymbolTags;
  fields: Record<TIntentField, string[]>;
  length: number;
}

const TAG = /^@([A-Za-z]+)\b[ \t]*(.*)$/;
/** A Markdown code fence: an `@decorator(...)` line inside one is code, never a tag. */
const FENCE = /^(```|~~~)/;
const FIELD_WEIGHTS: Record<TIntentField, number> = { useWhen: 4, insteadOf: 3, name: 2, doc: 1 };
const FIELDS: TIntentField[] = ['useWhen', 'insteadOf', 'name', 'doc'];
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

/** Each line of a TSDoc with the tag it opens; a line inside a code fence never opens one. */
const linesOf = (opts: {
  doc?: string;
}): { line: string; tag?: { name: string; rest: string } }[] => {
  let isInFence = false;

  return (opts.doc ?? '').split('\n').map((line) => {
    const trimmed = line.trim();
    const tag = isInFence ? null : TAG.exec(trimmed);

    if (FENCE.test(trimmed)) {
      isInFence = !isInFence;
    }

    return tag === null ? { line } : { line, tag: { name: tag[1], rest: tag[2] ?? '' } };
  });
};

/**
 * The import specifier a merged hit names, best first: the package that declares the export before an umbrella
 * that re-exports it, a subpath before the root (`/common` exports less than `.`), the shorter subpath, then the
 * specifier in code-point order so every run picks the same.
 */
const compareImports = (left: ISymbolRecord, right: ISymbolRecord): number => {
  const rankOf = (record: ISymbolRecord): number[] => [
    record.reExported === true ? 1 : 0,
    record.subpath === '.' ? 1 : 0,
    record.subpath.length,
  ];
  const leftRank = rankOf(left);
  const rightRank = rankOf(right);
  const at = leftRank.findIndex((value, index) => value !== rightRank[index]);

  if (at !== -1) {
    return leftRank[at] - rightRank[at];
  }

  if (left.specifier === right.specifier) {
    return 0;
  }

  return left.specifier < right.specifier ? -1 : 1;
};

/**
 * Finds the exports that answer a need in the user's words. The index is the exports' own TSDoc: `@useWhen` and
 * `@insteadOf` (and the first `@example`) are read from the `doc` the symbol table already holds, so a symbol
 * without the tags is still found by its name and prose, ranked lower. A class's public static members are ranked
 * as their own `Class.member` entries. Ranking is BM25 over the fields, weighted `useWhen` 4, `insteadOf` 3, name 2,
 * prose 1; no embeddings, no network.
 */
export class SymbolIntent {
  /** Tokenized per record object: a store hands out the same records until it loads its table again. */
  private static readonly documents = new WeakMap<ISymbolRecord, IIntentDocument[]>();

  /** The three tags of a TSDoc text; a tag runs to the next `@tag` line outside a code fence. */
  static tagsOf(opts: { doc?: string }): ISymbolTags {
    const found: Record<string, string[]> = {};
    let current: string[] | undefined;

    for (const { line, tag } of linesOf(opts)) {
      if (tag !== undefined) {
        const parts = found[tag.name] ?? [];

        parts.push(tag.rest);
        found[tag.name] = parts;
        current = parts;
        continue;
      }

      if (current !== undefined) {
        current[current.length - 1] = `${current[current.length - 1]}\n${line}`;
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
    const useWhen = clean(found.useWhen);
    const insteadOf = clean(found.insteadOf);
    const example = (found.example?.[0] ?? '').replace(/^\n+/, '').trimEnd();

    return {
      ...(useWhen === undefined ? {} : { useWhen }),
      ...(insteadOf === undefined ? {} : { insteadOf }),
      ...(example.trim() === '' ? {} : { example }),
    };
  }

  /** The prose of a TSDoc without any tag section; a code fence before the first tag is prose. */
  static proseOf(opts: { doc?: string }): string {
    const lines = linesOf(opts);
    const end = lines.findIndex((entry) => entry.tag !== undefined);

    return (end === -1 ? lines : lines.slice(0, end))
      .map((entry) => entry.line)
      .join(' ')
      .trim();
  }

  /** Lower-cased words, a camelCase or `TPascal` name split, a plural or an `-ing`/`-ed` ending cut. */
  static tokensOf(opts: { text: string }): string[] {
    return opts.text
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
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

    const documents = SymbolIntent.mergedOf({
      documents: opts.records.flatMap((record) => SymbolIntent.documentsOf({ record })),
    });
    const average = documents.reduce((sum, entry) => sum + entry.length, 0) / documents.length || 1;
    const frequency = new Map<string, number>();

    for (const word of wanted) {
      frequency.set(
        word,
        documents.filter((entry) => FIELDS.some((field) => entry.fields[field].includes(word)))
          .length,
      );
    }

    return documents
      .map((entry) => {
        let score = 0;

        for (const word of wanted) {
          const weighted = FIELDS.reduce(
            (sum, field) =>
              sum +
              entry.fields[field].filter((token) => token === word).length * FIELD_WEIGHTS[field],
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

        return { record: entry.record, importName: entry.importName, tags: entry.tags, score };
      })
      .filter((hit) => hit.score > 0)
      .sort(
        (left, right) =>
          right.score - left.score || left.record.name.localeCompare(right.record.name),
      )
      .slice(0, opts.limit);
  }

  /** A record and, for a class, one entry per public static member, read once per record object. */
  private static documentsOf(opts: { record: ISymbolRecord }): IIntentDocument[] {
    const cached = SymbolIntent.documents.get(opts.record);

    if (cached !== undefined) {
      return cached;
    }

    const { members, ...owner } = opts.record;
    const entries = [
      { record: opts.record, importName: opts.record.name },
      ...(members ?? []).map((member) => ({
        record: {
          ...owner,
          name: `${owner.name}.${member.name}`,
          signature: member.signature,
          line: member.line,
          doc: member.doc,
          declaration: undefined,
          uses: undefined,
        },
        importName: owner.name,
      })),
    ];
    const documents = entries.map(({ record, importName }) => {
      const tags = SymbolIntent.tagsOf({ doc: record.doc });
      const fields: Record<TIntentField, string[]> = {
        useWhen: SymbolIntent.tokensOf({ text: tags.useWhen ?? '' }),
        insteadOf: SymbolIntent.tokensOf({ text: tags.insteadOf ?? '' }),
        name: SymbolIntent.tokensOf({ text: record.name }),
        doc: SymbolIntent.tokensOf({ text: SymbolIntent.proseOf({ doc: record.doc }) }),
      };
      const length = FIELDS.reduce(
        (sum, field) => sum + fields[field].length * FIELD_WEIGHTS[field],
        0,
      );

      return { record, importName, tags, fields, length };
    });

    SymbolIntent.documents.set(opts.record, documents);

    return documents;
  }

  /**
   * One entry per declaration: an export reached through several entry points (an umbrella package, a root and a
   * subpath) is the same declaration - same source, name and shape, or same `file:line` without a shape. The import
   * is the best specifier (`compareImports`); the words are those of a copy that has a doc.
   */
  private static mergedOf(opts: { documents: IIntentDocument[] }): IIntentDocument[] {
    const groups = new Map<string, IIntentDocument[]>();

    for (const document of opts.documents) {
      const { record } = document;
      const key = [
        record.source ?? '',
        record.name,
        record.shape ?? `${record.file}:${record.line}`,
      ].join('\u0000');
      const group = groups.get(key) ?? [];

      group.push(document);
      groups.set(key, group);
    }

    return [...groups.values()].map((group) => {
      const ordered = [...group].sort((left, right) => compareImports(left.record, right.record));
      const best = ordered[0];
      const worded = ordered.find((entry) => (entry.record.doc ?? '') !== '') ?? best;

      return worded === best ? best : { ...worded, record: best.record };
    });
  }
}

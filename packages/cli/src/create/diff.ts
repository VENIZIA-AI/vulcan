import type { TConstValue } from '../common/index.ts';
import { DiffEditKinds } from './common/index.ts';

/** The size past which a line diff is not made: the table it needs grows with the product of the two lengths. */
const MAX_TABLE_CELLS = 4_000_000;
const DEFAULT_CONTEXT_LINES = 3;

export interface ILineDiff {
  /** Lines only the preset has. */
  added: number;
  /** Lines only the current file has. */
  removed: number;
  /** The unified-diff hunks, or undefined when the files were too large to diff. */
  hunks: string[] | undefined;
}

interface IEdit {
  kind: TConstValue<typeof DiffEditKinds>;
  line: string;
}

const linesOf = (opts: { text: string }): string[] => {
  const lines = opts.text.split(/\r?\n/);

  return lines.at(-1) === '' ? lines.slice(0, -1) : lines;
};

/** The edit script from `current` to `preset`, by the longest common subsequence of their lines. */
const editsOf = (opts: { current: string[]; preset: string[] }): IEdit[] => {
  const { current, preset } = opts;
  const width = preset.length + 1;
  const table = new Uint32Array((current.length + 1) * width);

  for (let row = current.length - 1; row >= 0; row -= 1) {
    for (let column = preset.length - 1; column >= 0; column -= 1) {
      table[row * width + column] =
        current[row] === preset[column]
          ? (table[(row + 1) * width + column + 1] ?? 0) + 1
          : Math.max(table[(row + 1) * width + column] ?? 0, table[row * width + column + 1] ?? 0);
    }
  }

  const edits: IEdit[] = [];
  let row = 0;
  let column = 0;

  while (row < current.length && column < preset.length) {
    if (current[row] === preset[column]) {
      edits.push({ kind: DiffEditKinds.KEEP, line: current[row] ?? '' });
      row += 1;
      column += 1;
    } else if ((table[(row + 1) * width + column] ?? 0) >= (table[row * width + column + 1] ?? 0)) {
      edits.push({ kind: DiffEditKinds.REMOVE, line: current[row] ?? '' });
      row += 1;
    } else {
      edits.push({ kind: DiffEditKinds.ADD, line: preset[column] ?? '' });
      column += 1;
    }
  }

  for (; row < current.length; row += 1) {
    edits.push({ kind: DiffEditKinds.REMOVE, line: current[row] ?? '' });
  }

  for (; column < preset.length; column += 1) {
    edits.push({ kind: DiffEditKinds.ADD, line: preset[column] ?? '' });
  }

  return edits;
};

/** Unified-diff hunks of an edit script, `context` lines of the unchanged text around every change. */
const hunksOf = (opts: { edits: IEdit[]; context: number }): string[] => {
  const { edits, context } = opts;
  const changed = edits.flatMap((edit, index) => (edit.kind === DiffEditKinds.KEEP ? [] : [index]));
  const hunks: string[] = [];
  let start = 0;

  while (start < changed.length) {
    let end = start;

    while (
      end + 1 < changed.length &&
      (changed[end + 1] ?? 0) - (changed[end] ?? 0) <= context * 2 + 1
    ) {
      end += 1;
    }

    const first = Math.max(0, (changed[start] ?? 0) - context);
    const last = Math.min(edits.length - 1, (changed[end] ?? 0) + context);
    const body = edits.slice(first, last + 1);
    // Lines before the hunk in each file: the kept and the removed for the current one, the kept and the added for the preset.
    const before = edits.slice(0, first);
    const currentBefore = before.filter((edit) => edit.kind !== DiffEditKinds.ADD).length;
    const presetBefore = before.filter((edit) => edit.kind !== DiffEditKinds.REMOVE).length;
    const currentCount = body.filter((edit) => edit.kind !== DiffEditKinds.ADD).length;
    const presetCount = body.filter((edit) => edit.kind !== DiffEditKinds.REMOVE).length;
    // An empty side starts at the line before it, as GNU diff writes it (`-0,0`).
    const currentStart = currentCount === 0 ? currentBefore : currentBefore + 1;
    const presetStart = presetCount === 0 ? presetBefore : presetBefore + 1;

    hunks.push(
      [
        `@@ -${currentStart},${currentCount} +${presetStart},${presetCount} @@`,
        ...body.map(
          (edit) =>
            `${edit.kind === DiffEditKinds.KEEP ? ' ' : edit.kind === DiffEditKinds.ADD ? '+' : '-'}${edit.line}`,
        ),
      ].join('\n'),
    );
    start = end + 1;
  }

  return hunks;
};

/**
 * What differs between the file an app has and the file its preset makes: the counts and the unified
 * diff (`-` is the app's line, `+` the preset's). Two texts that hold the same lines but differ in line
 * endings or in the final newline have no hunks and 0 and 0.
 */
export const diffLines = (opts: {
  current: string;
  preset: string;
  context?: number;
}): ILineDiff => {
  const current = linesOf({ text: opts.current });
  const preset = linesOf({ text: opts.preset });

  if ((current.length + 1) * (preset.length + 1) > MAX_TABLE_CELLS) {
    return { added: 0, removed: 0, hunks: undefined };
  }

  const edits = editsOf({ current, preset });

  return {
    added: edits.filter((edit) => edit.kind === DiffEditKinds.ADD).length,
    removed: edits.filter((edit) => edit.kind === DiffEditKinds.REMOVE).length,
    hunks: hunksOf({ edits, context: opts.context ?? DEFAULT_CONTEXT_LINES }),
  };
};

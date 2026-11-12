import { readFileSync } from 'node:fs';
import { OkfProject } from '../project/index.ts';
import { SourceScanner } from '../source/index.ts';

const CODE_LANGUAGES = new Set([
  'ts',
  'tsx',
  'typescript',
  'js',
  'jsx',
  'javascript',
  'mts',
  'cts',
  'mjs',
]);
const FENCE = /^\s*(`{3,}|~{3,})(\S*)\s*$/;
const FENCE_OPEN = /^\s*(`{3,}|~{3,})(\S*)/;
const STRING_LITERAL = /'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g;
const LINE_COMMENT = /\/\/.*$/;
const IMPORT_OR_EXPORT = /^\s*(?:import|export)\b/;

/** `value as User`, `as unknown as`, `as any`, `as never`: every `as` that is not `as const`. */
const CAST = /\bas\s+(?!const\b)(?:unknown|any|never|[A-Za-z_$][\w$.]*|[{([])/;
/** `: any`, `<any>`, `, any>`, `| any`, `any[]`. */
const ANY_TYPE = /(?::\s*|<\s*|,\s*|\|\s*|&\s*|\bkeyof\s+)any\b(?!\s*:)|\bany\[\]/;
const CONDITIONAL_SPREAD = /\.\.\.\(.*(?:\?.*:\s*(?:\{\}|\[\])|&&\s*[{[])/;
/** `type Mode = 'on' | 'off'`: strings are masked to `''` before this runs. */
const LITERAL_UNION = /\btype\s+\w+(?:<[^>]*>)?\s*=\s*(?:\|\s*)?''\s*\|/;

const TABLE_CELL_MAX = 120;

interface IFence {
  character: string;
  length: number;
  language: string;
}

/** The line with every string replaced by `''` and its `//` comment dropped: what is left is syntax. */
const syntaxOf = (opts: { line: string }): string =>
  opts.line.replace(STRING_LITERAL, "''").replace(LINE_COMMENT, '');

const cellsOf = (opts: { line: string }): string[] =>
  opts.line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim());

/**
 * The code rules for what the wiki shows (V-C-10 and the style of the code this repository writes): a code
 * example is a model for whoever copies it, so a fenced ts, tsx or js block holds no explicit cast, no `any`,
 * no conditional spread and no string-literal union. A table is read for its shape: a cell over 120
 * characters, or a continuation row with an empty first cell, is a warning, never a failure.
 * The changelogs are not read: an entry shows an old API next to the new one.
 */
export class DocsCodeCheck {
  /** `docs-code: <file>:<line>: <what>` for every code example that breaks a rule. */
  static collectProblems(): string[] {
    return DocsCodeCheck.pagesOf().flatMap((page) => DocsCodeCheck.codeProblemsOf({ page }));
  }

  /** `docs-table: <file>:<line>: <what>` for every table row that is crowded. */
  static collectWarnings(): string[] {
    return DocsCodeCheck.pagesOf().flatMap((page) => DocsCodeCheck.tableWarningsOf({ page }));
  }

  private static pagesOf(): { file: string; lines: string[] }[] {
    const { wiki, changelogs } = OkfProject.read();

    if (wiki === undefined) {
      return [];
    }

    return SourceScanner.walkFiles({ dir: wiki })
      .filter((file) => file.endsWith('.md'))
      .filter((file) => changelogs === undefined || !file.startsWith(`${changelogs}/`))
      .map((file) => ({
        file: SourceScanner.repoRelative({ path: file }),
        lines: readFileSync(file, 'utf8').split('\n'),
      }));
  }

  /** Each line with the fence it is in, `undefined` outside any; the fence lines themselves are left out. */
  private static linesWithFence(opts: {
    lines: string[];
  }): { text: string; number: number; fence?: IFence }[] {
    const found: { text: string; number: number; fence?: IFence }[] = [];
    let fence: IFence | undefined;

    opts.lines.forEach((text, index) => {
      if (fence === undefined) {
        const open = FENCE_OPEN.exec(text);

        if (open !== null) {
          fence = {
            character: open[1][0],
            length: open[1].length,
            language: open[2].toLowerCase(),
          };

          return;
        }

        found.push({ text, number: index + 1 });

        return;
      }

      const close = FENCE.exec(text);

      if (
        close !== null &&
        close[2] === '' &&
        close[1][0] === fence.character &&
        close[1].length >= fence.length
      ) {
        fence = undefined;

        return;
      }

      found.push({ text, number: index + 1, fence });
    });

    return found;
  }

  private static codeProblemsOf(opts: { page: { file: string; lines: string[] } }): string[] {
    const problems: string[] = [];
    let inImportBraces = false;

    for (const { text, number, fence } of DocsCodeCheck.linesWithFence({
      lines: opts.page.lines,
    })) {
      if (fence === undefined || !CODE_LANGUAGES.has(fence.language)) {
        continue;
      }

      const syntax = syntaxOf({ line: text });
      const isImportLine = IMPORT_OR_EXPORT.test(syntax);
      const where = `docs-code: ${opts.page.file}:${number}: `;

      if (isImportLine || inImportBraces) {
        // `import { A as B }` and `export { A as B }` rename, they do not cast; a list can span lines.
        inImportBraces = isImportLine
          ? syntax.includes('{') && !syntax.includes('}')
          : !syntax.includes('}');

        continue;
      }

      const cast = CAST.exec(syntax);

      if (cast !== null) {
        problems.push(
          `${where}an explicit cast (${cast[0].trim()}) - parse or narrow the value instead (V-C-10)`,
        );
      }

      if (ANY_TYPE.test(syntax)) {
        problems.push(`${where}\`any\` as a type - type it, or take unknown and narrow it`);
      }

      if (CONDITIONAL_SPREAD.test(syntax)) {
        problems.push(
          `${where}a conditional spread - build the object, then assign the optional key`,
        );
      }

      if (LITERAL_UNION.test(syntax)) {
        problems.push(`${where}a string-literal union - a const class and its value type (V-C-08)`);
      }
    }

    return problems;
  }

  private static tableWarningsOf(opts: { page: { file: string; lines: string[] } }): string[] {
    const warnings: string[] = [];
    let rows = 0;

    for (const { text, number, fence } of DocsCodeCheck.linesWithFence({
      lines: opts.page.lines,
    })) {
      if (fence !== undefined || !text.trimStart().startsWith('|')) {
        rows = 0;

        continue;
      }

      rows += 1;

      const cells = cellsOf({ line: text });
      const isSeparator = cells.every((cell) => /^:?-{3,}:?$/.test(cell));
      const where = `docs-table: ${opts.page.file}:${number}: `;

      if (isSeparator) {
        continue;
      }

      const long = cells.find((cell) => cell.length > TABLE_CELL_MAX);

      if (long !== undefined) {
        warnings.push(
          `${where}a cell of ${long.length} characters (over ${TABLE_CELL_MAX}) - a heading and a short table, or a list`,
        );
      }

      if (
        rows > 2 &&
        cells.length > 1 &&
        cells[0] === '' &&
        cells.slice(1).some((cell) => cell !== '')
      ) {
        warnings.push(`${where}a continuation row with an empty first cell - one row for one item`);
      }
    }

    return warnings;
  }
}

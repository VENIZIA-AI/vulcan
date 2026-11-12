import { readFileSync } from 'node:fs';
import { OkfProject } from '../project/index.ts';
import { CodeMask } from './code-mask.ts';
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
/** The note a generator writes on a page it owns, such as `atlas api gen`: its content is the project's own source, not an example. */
const GENERATED_NOTE = /^>\s*Generated\b.*\bdo not edit\.?\s*$/m;
/** What okf generated, and what a page marks `docs-code: off` (a signature quoted from the source) until `docs-code: on`. */
const REGION_START = /<!--\s*(?:okf:generated:\S+\s+start|docs-code:\s*off)\s*-->/;
const REGION_END = /<!--\s*(?:okf:generated:\S+\s+end|docs-code:\s*on)\s*-->/;
const IMPORT_OR_EXPORT = /^\s*(?:import|export)\b/;

/** `value as User`, `as unknown as`, `as any`, `as never`: every `as` that is not `as const`. */
const CAST = /\bas\s+(?!const\b)(?:unknown|any|never|[A-Za-z_$][\w$.]*|[{([])/;
/** `: any`, `<any>`, `, any>`, `| any`, `any[]`, and the same for `AnyType`, the Venizia alias of `any`. */
const ANY_TYPE =
  /(?::\s*|<\s*|,\s*|\|\s*|&\s*|\bkeyof\s+)(?:any|AnyType)\b(?!\s*:)|\b(?:any|AnyType)\[\]/;
const CONDITIONAL_SPREAD = /\.\.\.\(.*(?:\?.*:\s*(?:\{\}|\[\])|&&\s*[{[])/;
/** `type Mode = 'on' | 'off'`: strings are masked to `''` before this runs. */
const LITERAL_UNION = /\btype\s+\w+(?:<[^>]*>)?\s*=\s*(?:\|\s*)?''\s*\|/;

const TABLE_CELL_MAX = 120;
const OFF_MARKER = /<!--\s*docs-code:\s*off\s*-->/;
const ON_MARKER = /<!--\s*docs-code:\s*on\s*-->/;
/** What a quoted signature never holds: a statement, a call assigned or awaited, a function or arrow body. */
const OFF_STATEMENT =
  /^\s*(?:const|let|var|return|await|if|for|while|throw)\b|=\s*(?:await\s+|new\s+)?[\w$.]+\(/;
const OFF_BODY = /=>\s*\{|\)\s*(?::\s*[\w$.<>[\] |]+)?\s*\{/;

interface IFence {
  character: string;
  length: number;
  language: string;
}

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

  /** `docs-table: <file>:<line>: <what>` for every crowded table row, and `docs-code: <file>:<line>: <what>` for an off region that holds more than a signature. */
  static collectWarnings(): string[] {
    return DocsCodeCheck.pagesOf().flatMap((page) => [
      ...DocsCodeCheck.tableWarningsOf({ page }),
      ...DocsCodeCheck.offWarningsOf({ page }),
    ]);
  }

  /** Every page that holds a `docs-code: off` region, with the line of each: a reviewer sees every use. */
  static offRegions(): { file: string; lines: number[] }[] {
    return DocsCodeCheck.pagesOf().flatMap((page) => {
      const lines = DocsCodeCheck.offRegionsIn({ lines: page.rawLines }).map(
        (region) => region.start,
      );

      return lines.length === 0 ? [] : [{ file: page.file, lines }];
    });
  }

  private static pagesOf(): { file: string; lines: string[]; rawLines: string[] }[] {
    const { wiki, changelogs } = OkfProject.read();

    if (wiki === undefined) {
      return [];
    }

    return SourceScanner.walkFiles({ dir: wiki })
      .filter((file) => file.endsWith('.md'))
      .filter((file) => changelogs === undefined || !file.startsWith(`${changelogs}/`))
      .map((file) => ({ file, text: readFileSync(file, 'utf8') }))
      .filter(({ text }) => !GENERATED_NOTE.test(text))
      .map(({ file, text }) => ({
        file: SourceScanner.repoRelative({ path: file }),
        lines: DocsCodeCheck.withoutGeneratedRegions({ lines: text.split('\n') }),
        rawLines: text.split('\n'),
      }));
  }

  /** Each `docs-code: off` region: the line of its marker and the code lines inside it with their numbers. */
  private static offRegionsIn(opts: {
    lines: string[];
  }): { start: number; body: { text: string; number: number }[] }[] {
    const regions: { start: number; body: { text: string; number: number }[] }[] = [];
    let open: { start: number; body: { text: string; number: number }[] } | undefined;

    opts.lines.forEach((text, index) => {
      if (OFF_MARKER.test(text)) {
        open = { start: index + 1, body: [] };

        return;
      }

      if (ON_MARKER.test(text) && open !== undefined) {
        regions.push(open);
        open = undefined;

        return;
      }

      if (open !== undefined && !FENCE_OPEN.test(text)) {
        open.body.push({ text, number: index + 1 });
      }
    });

    return regions;
  }

  private static offWarningsOf(opts: { page: { file: string; rawLines: string[] } }): string[] {
    return DocsCodeCheck.offRegionsIn({ lines: opts.page.rawLines }).flatMap((region) => {
      const masked = CodeMask.of({ text: region.body.map((line) => line.text).join('\n') }).split(
        '\n',
      );
      const found: string[] = [];

      masked.forEach((line, at) => {
        const what = OFF_BODY.test(line)
          ? 'a function body'
          : OFF_STATEMENT.test(line)
            ? 'a statement'
            : undefined;

        if (what !== undefined) {
          found.push(
            `docs-code: ${opts.page.file}:${region.body[at].number}: a docs-code off region holds ${what} - off is for a quoted source signature, never an example`,
          );
        }
      });

      return found;
    });
  }

  /** The lines with what sits between okf generated markers, or `docs-code: off` and `on`, blanked, so line numbers hold. */
  private static withoutGeneratedRegions(opts: { lines: string[] }): string[] {
    let inRegion = false;

    return opts.lines.map((line) => {
      if (REGION_START.test(line)) {
        inRegion = true;

        return '';
      }

      if (REGION_END.test(line)) {
        inRegion = false;

        return '';
      }

      return inRegion ? '' : line;
    });
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

  /** Every line masked (strings, template literals and comments out); a fence is read whole, so a comment or a template can span lines. */
  private static maskedFences(opts: { lines: { text: string; fence?: IFence }[] }): string[] {
    const masked = opts.lines.map((line) => line.text);
    let start = 0;

    while (start < opts.lines.length) {
      const { fence } = opts.lines[start];
      let end = start + 1;

      while (end < opts.lines.length && opts.lines[end].fence === fence) {
        end += 1;
      }

      if (fence !== undefined) {
        const text = opts.lines
          .slice(start, end)
          .map((line) => line.text)
          .join('\n');

        CodeMask.of({ text })
          .split('\n')
          .forEach((line, offset) => {
            masked[start + offset] = line;
          });
      }

      start = end;
    }

    return masked;
  }

  private static codeProblemsOf(opts: { page: { file: string; lines: string[] } }): string[] {
    const problems: string[] = [];
    let inImportBraces = false;

    const lines = DocsCodeCheck.linesWithFence({ lines: opts.page.lines });
    const masked = DocsCodeCheck.maskedFences({ lines });

    for (const [at, { number, fence }] of lines.entries()) {
      if (fence === undefined || !CODE_LANGUAGES.has(fence.language)) {
        continue;
      }

      const syntax = masked[at];
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
        problems.push(
          `${where}\`any\` or \`AnyType\` as a type - type it, or take unknown and narrow it`,
        );
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

/**
 * The syntax of a code example with its strings, template literals and comments taken out: each string
 * becomes `''`, a template literal `` `` `` (the code of its `${}` stays), a comment disappears, and every
 * newline stays, so a line of the result is the same line of the example. A scanner and not a parser: an
 * example is often a fragment, which a parser may refuse and a scanner reads all the same.
 */
export class CodeMask {
  static of(opts: { text: string }): string {
    const { text } = opts;
    let out = '';
    let index = 0;
    // One entry per open template literal: how many `{` of its `${}` expression are still open.
    const templates: number[] = [];

    const skipQuoted = (quote: string): void => {
      index += 1;

      while (index < text.length && text[index] !== quote && text[index] !== '\n') {
        index += text[index] === '\\' ? 2 : 1;
      }

      index += text[index] === quote ? 1 : 0;
      out += `${quote}${quote}`;
    };

    /** Reads template text until the closing backtick (done) or a `${` (an expression opens). */
    const readTemplate = (): void => {
      while (index < text.length) {
        const character = text[index];

        if (character === '\\') {
          out += text[index + 1] === '\n' ? '\n' : '';
          index += 2;

          continue;
        }

        if (character === '`') {
          index += 1;
          templates.pop();
          out += '``';

          return;
        }

        if (character === '$' && text[index + 1] === '{') {
          index += 2;
          templates[templates.length - 1] = 1;
          out += '(';

          return;
        }

        out += character === '\n' ? '\n' : '';
        index += 1;
      }
    };

    while (index < text.length) {
      const character = text[index];
      const next = text[index + 1];

      if (character === '/' && next === '/') {
        while (index < text.length && text[index] !== '\n') {
          index += 1;
        }

        continue;
      }

      if (character === '/' && next === '*') {
        const end = text.indexOf('*/', index + 2);
        const comment = text.slice(index, end === -1 ? text.length : end + 2);

        out += comment.replace(/[^\n]/g, '');
        index += comment.length;

        continue;
      }

      if (character === "'" || character === '"') {
        skipQuoted(character);

        continue;
      }

      if (character === '`') {
        index += 1;
        templates.push(0);
        readTemplate();

        continue;
      }

      const open = templates[templates.length - 1];

      if (open !== undefined && open > 0) {
        if (character === '{') {
          templates[templates.length - 1] = open + 1;
        }

        if (character === '}') {
          templates[templates.length - 1] = open - 1;

          if (open - 1 === 0) {
            index += 1;
            out += ')';
            readTemplate();

            continue;
          }
        }
      }

      out += character;
      index += 1;
    }

    return out;
  }
}

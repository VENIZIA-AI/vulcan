import { RecordValue } from '@/common/record';
import { TextValue } from '@/common/text';

/** A leading `---` block; a page saved with CRLF line endings carries the same block. */
export const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)?/;

export class CorpusFrontmatter {
  /**
   * Splits YAML frontmatter from the body. No leading `---` block means no frontmatter - the whole
   * text is body. Invalid YAML throws instead of loading as `{}`: a caller decides whether to skip
   * the document, it never indexes silently under a blank title.
   */
  static parse(opts: { text: string; path: string }): {
    data: Record<string, unknown>;
    body: string;
  } {
    const { text, path } = opts;
    const match = text.match(FRONTMATTER_PATTERN);

    if (!match) {
      return { data: {}, body: text };
    }

    let parsed: unknown;

    try {
      parsed = Bun.YAML.parse(match[1]);
    } catch (error) {
      throw new Error(
        `[parseFrontmatter] invalid YAML frontmatter | file: ${path} | ${TextValue.messageOf({ error })}`,
        { cause: error },
      );
    }

    return { data: RecordValue.orEmpty({ value: parsed }), body: text.slice(match[0].length) };
  }
}

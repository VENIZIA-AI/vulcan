import { RecordValue } from '../common/record.ts';

const FRONTMATTER = /^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/;

/** A parsed front matter block: a YAML mapping with string keys. */
export type TYamlMapping = Record<string, unknown>;

/** The result of parsing a front matter block: the mapping, or why it is not one. */
export type TParsedYaml = { ok: true; data: TYamlMapping } | { ok: false; reason: string };

/** Splits the YAML front matter from the body of a bundle file and parses it as a mapping (OKF v0.2 §4). */
export class OkfFrontmatter {
  /** §4: the block between the first two `---` lines. Line endings are normalized, so CRLF files parse too. */
  static split(opts: { text: string }): { yaml: string | undefined; body: string } {
    const text = opts.text.replace(/\r\n/g, '\n');
    const match = FRONTMATTER.exec(text);

    return match ? { yaml: match[1], body: match[2] } : { yaml: undefined, body: text };
  }

  /** A frontmatter block must be a YAML mapping; an empty block is an empty mapping. */
  static parseMapping(opts: { yaml: string }): TParsedYaml {
    let value: unknown;

    try {
      value = Bun.YAML.parse(opts.yaml);
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }

    if (value === null || value === undefined) {
      return { ok: true, data: {} };
    }

    const holder = { value };

    return RecordValue.isRecord(holder)
      ? { ok: true, data: holder.value }
      : { ok: false, reason: 'not a YAML mapping' };
  }
}

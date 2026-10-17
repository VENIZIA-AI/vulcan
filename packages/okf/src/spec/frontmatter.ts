const FRONTMATTER = /^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/;

export type TYamlMapping = Record<string, unknown>;

export type TParsedYaml = { ok: true; data: TYamlMapping } | { ok: false; reason: string };

/** §4: the block between the first two `---` lines. Line endings are normalized, so CRLF files parse too. */
export const splitFrontmatter = (opts: {
  text: string;
}): { yaml: string | undefined; body: string } => {
  const text = opts.text.replace(/\r\n/g, '\n');
  const match = FRONTMATTER.exec(text);

  return match ? { yaml: match[1], body: match[2] } : { yaml: undefined, body: text };
};

const isMapping = (opts: { value: unknown }): opts is { value: TYamlMapping } =>
  typeof opts.value === 'object' && opts.value !== null && !Array.isArray(opts.value);

/** A frontmatter block must be a YAML mapping; an empty block is an empty mapping. */
export const parseYamlMapping = (opts: { yaml: string }): TParsedYaml => {
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

  return isMapping(holder)
    ? { ok: true, data: holder.value }
    : { ok: false, reason: 'not a YAML mapping' };
};

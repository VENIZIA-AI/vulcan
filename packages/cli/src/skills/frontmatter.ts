const FRONTMATTER = /^---\n([\s\S]*?)\n---\n/;

const parseYaml = (opts: { text: string }): { value?: unknown; error?: string } => {
  try {
    return { value: Bun.YAML.parse(opts.text) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
};

/**
 * The frontmatter's fields, or why they cannot be read. Bun's YAML error names no line, so the line
 * is the first one at which the block stops parsing - counted in the file, the opening `---` is 1.
 */
export const frontmatterOf = (opts: {
  text: string;
}): { data: Record<string, unknown>; error?: string } => {
  const block = FRONTMATTER.exec(opts.text)?.[1];

  if (block === undefined) {
    return { data: {} };
  }

  const parsed = parseYaml({ text: block });

  if (parsed.error !== undefined) {
    const blockLines = block.split('\n');
    const failsAt = blockLines.findIndex(
      (_line, index) =>
        parseYaml({ text: blockLines.slice(0, index + 1).join('\n') }).error !== undefined,
    );
    const where = failsAt === -1 ? '' : ` at line ${failsAt + 2}`;

    return { data: {}, error: `the frontmatter is not valid YAML${where} (${parsed.error})` };
  }

  return {
    data:
      typeof parsed.value === 'object' && parsed.value !== null
        ? Object.fromEntries(Object.entries(parsed.value))
        : {},
  };
};

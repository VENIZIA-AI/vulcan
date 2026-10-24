/**
 * lib.ts - shared loader/parser for the OKF knowledge bundle.
 * Used by the generator, the viz builder, and the MCP server.
 *
 * Repo-specific paths and denylists live in ./config.ts.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix, relative } from 'node:path';

import { PRUNE_DIRS, RESERVED_FILES } from './config.ts';
import { readOkfProject } from './project/index.ts';
import { parseYamlMapping, splitFrontmatter } from './spec/frontmatter.ts';

export type Concept = {
  id: string; // bundle-relative, leading slash, no extension - e.g. "/packages/core-server"
  file: string; // absolute path
  type: string;
  title: string;
  description: string;
  resource: string; // frontmatter `resource:` - the source path/URL this concept covers
  tags: string[];
  body: string; // markdown after frontmatter
  raw: string; // untouched file content, frontmatter included
  links: string[]; // ids this concept links to
  reserved: boolean; // index.md / log.md
};

// ---

const walkMarkdown = (opts: { dir: string }): string[] => {
  const { dir } = opts;

  const out: string[] = [];

  for (const name of readdirSync(dir)) {
    if (PRUNE_DIRS.has(name)) {
      continue;
    }

    const full = join(dir, name);

    if (statSync(full).isDirectory()) {
      out.push(...walkMarkdown({ dir: full }));
      continue;
    }

    if (full.endsWith('.md')) {
      out.push(full);
    }
  }

  return out;
};

/**
 * Strip fenced and inline code before scanning for links.
 *
 * A markdown link inside a code fence is an example, not a real edge: leaving it in
 * made `check` report broken links for illustrative snippets and made viz draw edges
 * that do not exist. Fences are replaced (not deleted) so nothing outside them shifts.
 */
export const stripCode = (opts: { text: string }): string => {
  return opts.text
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/~~~[\s\S]*?~~~/g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/`[^`\n]*`/g, (span) => ' '.repeat(span.length));
};

const MARKDOWN_LINK = /\]\(([^)\s]+)\)/g;
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** A link target as a concept id: bundle-absolute or relative to `fromId` (OKF v0.2 §6.1), anchor dropped. */
const resolveLinkTarget = (opts: { target: string; fromId: string }): string | undefined => {
  const path = opts.target.split('#')[0];

  if (URL_SCHEME.test(opts.target) || !path.endsWith('.md')) {
    return undefined;
  }

  const id = path.replace(/\.md$/, '');

  return id.startsWith('/')
    ? posix.normalize(id)
    : posix.normalize(posix.join(posix.dirname(opts.fromId), id));
};

export const extractLinks = (opts: { text: string; id: string }): string[] => {
  const prose = stripCode({ text: opts.text });
  const targets = [...prose.matchAll(MARKDOWN_LINK)]
    .map((match) => resolveLinkTarget({ target: match[1], fromId: opts.id }))
    .filter((target): target is string => target !== undefined);

  return [...new Set(targets)];
};

/** Split OKF frontmatter from the body. Throws on unparseable YAML; `spec/` reports it as an issue instead. */
export const parseFrontmatter = (opts: {
  text: string;
  file: string;
}): {
  data: Record<string, unknown>;
  body: string;
} => {
  const { yaml, body } = splitFrontmatter({ text: opts.text });

  if (yaml === undefined) {
    return { data: {}, body };
  }

  const parsed = parseYamlMapping({ yaml });

  if (!parsed.ok) {
    throw new Error(`invalid YAML frontmatter in ${opts.file} - ${parsed.reason}`);
  }

  return { data: parsed.data, body };
};

const asString = (opts: { value: unknown; fallback: string }): string => {
  return typeof opts.value === 'string' ? opts.value : opts.fallback;
};

const asTags = (opts: { value: unknown }): string[] => {
  const { value } = opts;

  if (Array.isArray(value)) {
    return value.map((tag) => String(tag).trim()).filter(Boolean);
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  return [];
};

export const loadConcepts = (): Concept[] => {
  const { bundle } = readOkfProject();

  return walkMarkdown({ dir: bundle }).map((file) => {
    const raw = readFileSync(file, 'utf8');
    const base = file.split('/').pop() ?? '';
    const reserved = RESERVED_FILES.has(base);

    const { data, body } = parseFrontmatter({ text: raw, file });
    const id = '/' + relative(bundle, file).replace(/\.md$/, '');

    return {
      id,
      file,
      type: asString({ value: data.type, fallback: reserved ? '' : 'Unknown' }),
      title: asString({ value: data.title, fallback: base.replace(/\.md$/, '') }),
      description: asString({ value: data.description, fallback: '' }),
      resource: asString({ value: data.resource, fallback: '' }),
      tags: asTags({ value: data.tags }),
      body: body.trim(),
      raw,
      links: extractLinks({ text: raw, id }),
      reserved,
    };
  });
};

/**
 * `loadConcepts()`, printing `okf: <message>` to stderr and exiting 1 on a bad frontmatter instead
 * of an unhandled exception. `check()` handles the same failure itself (it reports every problem
 * together rather than stopping at the first); every other command that reads the whole bundle
 * calls this instead of `loadConcepts()` directly.
 */
export const loadConceptsOrExit = (): Concept[] => {
  try {
    return loadConcepts();
  } catch (error) {
    console.error(`okf: ${(error as Error).message}`);
    process.exit(1);
  }
};

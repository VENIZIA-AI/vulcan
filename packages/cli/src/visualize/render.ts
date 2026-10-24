import { randomBytes } from 'node:crypto';
import { lstatSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { z } from 'zod';
import { ProjectLayout } from '../common/index.ts';
import { localRootOf } from '../local/index.ts';
import { VisualizeLimits } from './constants.ts';
import { renderPage } from './page.ts';
import { VISUALIZE_SCHEMA } from './schema.ts';
import { checkSpec } from './validate.ts';

export interface IRendered {
  html: string;
  bytes: number;
  /** What was checked and passed, for the report: nothing is silent. */
  checks: string[];
  warnings: string[];
}

export type TRenderResult = { ok: true; page: IRendered } | { ok: false; problems: string[] };

/** The checks the renderer runs on its own; a browser check is the caller's. */
const CHECKS = [
  'spec shape and limits',
  'ids unique, every edge and step points at a box, one box per cell',
  'every text escaped, links https only',
  "no network, no font, no image, a policy that allows only the page's own style and script",
];

/** Spec text to a page: parse, validate, cross-check, render, size gate. Nothing is written here. */
export const renderSpecText = (opts: { text: string }): TRenderResult => {
  let payload: unknown;

  try {
    payload = JSON.parse(opts.text);
  } catch (error) {
    return {
      ok: false,
      problems: [
        `the spec is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }

  const parsed = VISUALIZE_SCHEMA.safeParse(payload);

  if (!parsed.success) {
    return {
      ok: false,
      problems: parsed.error.issues.map(
        (issue) => `${issue.path.join('.') || 'spec'}: ${issue.message}`,
      ),
    };
  }

  const problems = checkSpec({ spec: parsed.data });

  if (problems.length > 0) {
    return { ok: false, problems };
  }

  const html = renderPage({ spec: parsed.data });
  const bytes = Buffer.byteLength(html, 'utf8');

  if (bytes > VisualizeLimits.FAIL_BYTES) {
    return {
      ok: false,
      problems: [
        `the page is ${Math.round(bytes / 1024)} KB; the limit is ${VisualizeLimits.FAIL_BYTES / 1024} KB - a handoff that does not fit is two pages, not one dense page`,
      ],
    };
  }

  return {
    ok: true,
    page: {
      html,
      bytes,
      checks: [
        ...CHECKS,
        `size ${(bytes / 1024).toFixed(1)} KB, within ${VisualizeLimits.FAIL_BYTES / 1024} KB`,
      ],
      warnings:
        bytes > VisualizeLimits.WARN_BYTES
          ? [
              `the page is ${Math.round(bytes / 1024)} KB, past the ${VisualizeLimits.WARN_BYTES / 1024} KB a page should stay under: consider two pages`,
            ]
          : [],
    },
  };
};

/** The spec's JSON Schema, for an agent that wants to check a spec before it runs the renderer. */
export const specSchemaText = (): string =>
  `${JSON.stringify(z.toJSONSchema(VISUALIZE_SCHEMA, { io: 'input' }), null, 2)}\n`;

/** A page name as a file name: lowercase letters, digits and dashes. */
export const pageNameOf = (opts: { name: string }): string | undefined => {
  const base = basename(opts.name).replace(/\.[^.]*$/, '');
  const cleaned = base
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .slice(0, 64)
    .replace(/^-+|-+$/g, '');

  return cleaned === '' ? undefined : cleaned;
};

/**
 * Writes the page to `.agents/local/prototypes/<name>.html` of the project: beside its place and moved in
 * last, so a failed render never replaces the last good page. Only a trusted `.agents/local/` is used.
 */
export const writePage = (opts: {
  root: string;
  name: string;
  html: string;
}): { ok: true; path: string } | { ok: false; error: string } => {
  const local = localRootOf({ root: opts.root });

  if (local === undefined) {
    return {
      ok: false,
      error: `no .agents/local/ in ${opts.root} (or it is a symlink, or resolves outside the project) - run vulcan sync first`,
    };
  }

  const directory = join(local, VisualizeLimits.OUTPUT_DIRECTORY);

  const refusal = (error: string) => ({ ok: false as const, error });
  const place = `${ProjectLayout.LOCAL_DIRECTORY}/${VisualizeLimits.OUTPUT_DIRECTORY}`;

  try {
    const kind = lstatSync(directory, { throwIfNoEntry: false });

    if (kind?.isSymbolicLink()) {
      return refusal(`${place} is a symlink - refusing to write through it`);
    }

    if (kind === undefined) {
      mkdirSync(directory, { recursive: true });
    } else if (!kind.isDirectory()) {
      return refusal(`${place} is not a folder`);
    }

    const path = join(directory, `${opts.name}.html`);
    const partial = `${path}.${randomBytes(6).toString('hex')}.partial`;

    try {
      writeFileSync(partial, opts.html, { flag: 'wx' });
      renameSync(partial, path);
    } finally {
      rmSync(partial, { force: true });
    }

    return { ok: true, path };
  } catch (error) {
    return refusal(
      `could not write the page: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

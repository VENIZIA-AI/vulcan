import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUNDLE, REGENERATE_HINT } from '../config.ts';
import { loadConcepts, stripCode } from '../lib.ts';
import type { Concept } from '../lib.ts';
import type { IBundleFile } from '../spec/index.ts';
import { REGIONS, RENDERERS, extractRegion } from '../generate/index.ts';
import { exampleDirs, packageDirs, repoRelative } from '../source/index.ts';

// --- docs style ---

/**
 * Repo docs rules, enforced on prose (see check step 3). To write a forbidden literal - as the
 * concept defining these rules must - put it in a code span; `stripCode` removes those first.
 */
export const STYLE_RULES: { pattern: RegExp; message: string }[] = [
  { pattern: /[—–]/, message: 'use a hyphen, not an em-dash or en-dash' },
  { pattern: /\bIgnis\b/, message: 'the brand is always written IGNIS' },
];

// --- freshness ---

/** Compare generated content ignoring trailing whitespace, so an editor's final newline is not "stale". */
export const sameContent = (opts: { left: string; right: string }): boolean => {
  const normalize = (value: string) =>
    value
      .split('\n')
      .map(line => line.replace(/\s+$/, ''))
      .join('\n')
      .trim();

  return normalize(opts.left) === normalize(opts.right);
};

export const collectHouseProblems = (opts: { files: IBundleFile[] }): string[] => {
  const problems: string[] = [];

  // A concept that fails to load is already reported by the spec layer; links need the loaded set.
  let concepts: Concept[] = [];

  try {
    concepts = loadConcepts();
  } catch (error) {
    console.error(
      `check: links skipped - ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const ids = new Set(concepts.map(concept => concept.id));

  for (const concept of concepts) {
    for (const target of concept.links) {
      if (!ids.has(target)) {
        problems.push(`${repoRelative({ path: concept.file })}: broken link -> ${target}.md`);
      }
    }
  }

  // Prose only: code is stripped, so the concept that defines a style rule can still quote what it forbids.
  for (const file of opts.files) {
    const prose = stripCode({ text: file.text });

    for (const rule of STYLE_RULES) {
      const match = prose.match(rule.pattern);

      if (match) {
        problems.push(
          `${repoRelative({ path: join(BUNDLE, file.path) })}: ${rule.message} (found "${match[0]}")`,
        );
      }
    }
  }

  const paths = new Set(opts.files.map(file => file.path));

  for (const [items, section] of [
    [packageDirs(), 'packages'],
    [exampleDirs(), 'examples'],
  ] as const) {
    for (const name of items) {
      if (!paths.has(`${section}/${name}.md`)) {
        problems.push(`coverage: ${section}/${name} has no concept (${section}/${name}.md)`);
      }
    }
  }

  for (const region of REGIONS) {
    if (!existsSync(region.file)) {
      problems.push(
        `freshness: region '${region.id}' host file missing (${repoRelative({ path: region.file })})`,
      );
      continue;
    }

    const actual = extractRegion({ text: readFileSync(region.file, 'utf8'), id: region.id });

    if (actual === null || !sameContent({ left: actual, right: region.render() })) {
      problems.push(`freshness: region '${region.id}' is stale - ${REGENERATE_HINT}`);
    }
  }

  for (const renderer of RENDERERS) {
    const { path, content } = renderer.render();
    const current = existsSync(path) ? readFileSync(path, 'utf8') : '';

    if (!sameContent({ left: current, right: content })) {
      problems.push(`freshness: ${repoRelative({ path })} is stale - ${REGENERATE_HINT}`);
    }
  }

  return problems;
};

/** OKF conformance (errors fail, warnings print); `strict` adds the house rules. */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REGENERATE_HINT } from '../config.ts';
import { readOkfProject } from '../project/index.ts';
import { loadConcepts, stripCode } from '../lib.ts';
import type { Concept } from '../lib.ts';
import type { IBundleFile } from '../spec/index.ts';
import { collectCoverageAxes } from '../coverage-report/axes.ts';
import { collectChangelogProblems } from './changelogs.ts';
import { extractRegion } from '../generate/index.ts';
import type { ILoadedRegion, ILoadedRenderer } from '../generate/index.ts';
import { brandSpelling, repoRelative } from '../source/index.ts';

// --- docs style ---

/**
 * Repo docs rules, enforced on prose (see check step 3). To write a forbidden literal - as the
 * concept defining these rules must - put it in a code span; `stripCode` removes those first.
 */
export const styleRules = (opts: { brand: string }): { pattern: RegExp; message: string }[] => {
  const spelling = brandSpelling({ brand: opts.brand });

  return [
    { pattern: /[—–]/, message: 'use a hyphen, not an em-dash or en-dash' },
    ...(spelling === undefined
      ? []
      : [
          {
            pattern: new RegExp(spelling.source),
            message: `the brand is always written ${opts.brand}`,
          },
        ]),
  ];
};

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

export const collectHouseProblems = (opts: {
  files: IBundleFile[];
  renderers: ILoadedRenderer[];
  regions: ILoadedRegion[];
}): string[] => {
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

    for (const rule of styleRules({ brand: readOkfProject().viz.brand })) {
      const match = prose.match(rule.pattern);

      if (match) {
        problems.push(
          `${repoRelative({ path: join(readOkfProject().bundle, file.path) })}: ${rule.message} (found "${match[0]}")`,
        );
      }
    }
  }

  const paths = new Set(opts.files.map(file => file.path));

  for (const axis of collectCoverageAxes()) {
    const section = axis.name;

    for (const name of axis.items) {
      if (!paths.has(`${section}/${name}.md`)) {
        problems.push(`coverage: ${section}/${name} has no concept (${section}/${name}.md)`);
      }
    }
  }

  for (const region of opts.regions) {
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

  for (const { renderer, context } of opts.renderers) {
    if (renderer.render === undefined) {
      continue;
    }

    const rendered = renderer.render({ context, facts: renderer.collect({ context }) });
    const path = join(context.bundle, rendered.path);
    const content = rendered.content;
    const current = existsSync(path) ? readFileSync(path, 'utf8') : '';

    if (!sameContent({ left: current, right: content })) {
      problems.push(`freshness: ${repoRelative({ path })} is stale - ${REGENERATE_HINT}`);
    }
  }

  // C3: every dated changelog entry declares its packages by npm name.
  problems.push(...collectChangelogProblems());

  return problems;
};

/** OKF conformance (errors fail, warnings print); `strict` adds the house rules. */

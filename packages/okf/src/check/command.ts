import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { RESERVED_FILES } from '../config.ts';
import { readOkfProject } from '../project/index.ts';
import { IssueSeverities, OkfVersions, checkBundle } from '../spec/index.ts';
import type { IBundleFile, IConformanceIssue } from '../spec/index.ts';
import { collectHouseProblems } from './house.ts';
import { repoRelative, walkFiles } from '../source/index.ts';

export const readBundleFiles = (): IBundleFile[] =>
  walkFiles({ dir: readOkfProject().bundle })
    .filter(file => file.endsWith('.md'))
    .map(file => ({
      path: relative(readOkfProject().bundle, file),
      text: readFileSync(file, 'utf8'),
    }));

export const formatIssue = (opts: { issue: IConformanceIssue }): string =>
  `${repoRelative({ path: join(readOkfProject().bundle, opts.issue.file) })}: ${opts.issue.rule} ${opts.issue.message}`;

/** The house rules on top of OKF conformance: links resolve, docs style, structural coverage, freshness. */

export const check = (opts: { strict: boolean }): void => {
  const files = readBundleFiles();
  const issues = checkBundle({ files });
  const warnings = issues.filter(issue => issue.severity === IssueSeverities.WARNING);
  const problems = issues
    .filter(issue => issue.severity === IssueSeverities.ERROR)
    .map(issue => formatIssue({ issue }));

  if (opts.strict) {
    problems.push(...collectHouseProblems({ files }));
  }

  if (warnings.length) {
    console.error(
      `check: ${warnings.length} warning(s):\n` +
        warnings.map(issue => '  - ' + formatIssue({ issue })).join('\n'),
    );
  }

  if (problems.length) {
    console.error(
      `check: ${problems.length} problem(s):\n` +
        problems.map(problem => '  - ' + problem).join('\n'),
    );
    process.exit(1);
  }

  const conceptCount = files.filter(
    file => !RESERVED_FILES.has(file.path.split('/').pop() ?? ''),
  ).length;
  const scope = opts.strict
    ? `OKF v${OkfVersions.LATEST} + house rules`
    : `OKF v${OkfVersions.LATEST}`;

  console.log(`check: OK - ${scope} - ${files.length} files, ${conceptCount} concepts`);
};

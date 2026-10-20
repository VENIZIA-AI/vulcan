/**
 * Guards VULCAN's shipped source against any one project's names (Project Contract v1, V1).
 *
 * VULCAN serves every project from the contract alone. A project's name in `src` is a project's
 * shape leaking into the tool - it has happened three times - so the gate fails on it. Tests and
 * fixtures name projects as data and are exempt.
 */
import { Glob } from 'bun';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PROJECT_NAMES = /\b(ignis|ardor|bana)\b/i;
/** The source, and everything the cli ships to every project: rules, skills, hooks, make. */
const SOURCE_GLOBS = [
  'packages/*/src/**/*.{ts,mts,html,css,md}',
  'packages/cli/base/**/*.{md,js,mjs,ts,mts,mk,json,sh}',
];
const EXEMPT = /\/(__tests__|fixtures|evals)\//;

const readRoot = (opts: { argv: string[] }): string => {
  const index = opts.argv.indexOf('--root');

  return index === -1 ? join(import.meta.dir, '..') : (opts.argv[index + 1] ?? '.');
};

const root = readRoot({ argv: process.argv });
const offences: string[] = [];

const files = SOURCE_GLOBS.flatMap(glob => [...new Glob(glob).scanSync({ cwd: root })]);

for (const file of [...new Set(files)].sort()) {
  if (EXEMPT.test(`/${file}`) || file.includes('/node_modules/')) {
    continue;
  }

  readFileSync(join(root, file), 'utf8')
    .split('\n')
    .forEach((line, index) => {
      const found = PROJECT_NAMES.exec(line);

      if (found) {
        offences.push(`${file}:${index + 1}: names a project ("${found[0]}")`);
      }
    });
}

if (offences.length > 0) {
  console.error(
    `project-names: ${offences.length} line(s) in VULCAN's source name a project - VULCAN serves every project from the contract alone:\n` +
      offences.map(offence => `  ${offence}`).join('\n'),
  );
  process.exit(1);
}

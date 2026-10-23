import { expect, test } from 'bun:test';
import { Glob } from 'bun';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..', '..', '..');
const FRAMEWORK = '@venizia/ignis-helpers';
// An import, not a mention: atlas's symbol fixtures name IGNIS packages as data.
const IMPORT = /(?:from\s+|require\(|import\()['"]@venizia\/ignis-helpers/;

// VULCAN is tooling for every project; depending on one project's framework pins every consumer to
// that framework's release, and installs a second copy next to IGNIS's own.
test('no VULCAN source file imports the IGNIS framework', () => {
  const files = [
    ...new Glob('packages/*/{src,base,scripts}/**/*.ts').scanSync({ cwd: ROOT }),
    ...new Glob('scripts/**/*.ts').scanSync({ cwd: ROOT }),
  ].filter(file => !file.includes('/node_modules/'));

  expect(files.length).toBeGreaterThan(100);
  expect(files.filter(file => IMPORT.test(readFileSync(join(ROOT, file), 'utf8')))).toEqual([]);
});

test('no VULCAN package or the root catalog declares the IGNIS framework', () => {
  const manifests = [
    'package.json',
    'packages/cli/package.json',
    'packages/okf/package.json',
    'packages/atlas/package.json',
  ];

  expect(
    manifests.filter(file => readFileSync(join(ROOT, file), 'utf8').includes(FRAMEWORK)),
  ).toEqual([]);
});

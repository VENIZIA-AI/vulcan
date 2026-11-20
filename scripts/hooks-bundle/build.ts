#!/usr/bin/env bun
/**
 * Builds the hooks of `@venizia/vulcan` into one self-contained file each, `packages/cli/base/bundle/<name>.js`, and writes
 * `SHA256SUMS.json` beside them: the version and the sha256 of every file. `vulcan sync` copies these files into a project's
 * `.agents/local/hooks/` and the hooks run from there, so a package manager, `node_modules` and the store cannot change what a
 * hook runs. The build is deterministic: the same sources and the same bun give the same bytes.
 *
 *   bun scripts/hooks-bundle/build.ts [--out <folder>]
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { HooksBundle } from '../../packages/cli/src/sync/hooks-bundle.ts';

const PACKAGE = resolve(import.meta.dir, '..', '..', 'packages', 'cli');
const outIndex = process.argv.indexOf('--out');
const folder = resolve(outIndex === -1 ? HooksBundle.SOURCE : (process.argv[outIndex + 1] ?? ''));
const { version }: { version: string } = JSON.parse(
  readFileSync(join(PACKAGE, 'package.json'), 'utf8'),
);
const sums = HooksBundle.build({ folder, version });

console.log(
  `hooks-bundle: ${Object.keys(sums.files).length} files, version ${sums.version}, in ${folder}`,
);

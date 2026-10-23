import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const writeFile = (opts: { root: string; path: string; content: string }): void => {
  mkdirSync(dirname(join(opts.root, opts.path)), { recursive: true });
  writeFileSync(join(opts.root, opts.path), opts.content);
  process.stderr.write(`  created  ${opts.path}\n`);
};

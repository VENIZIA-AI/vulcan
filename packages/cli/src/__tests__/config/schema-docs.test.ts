import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Glob } from 'bun';

const SOURCE_ROOT = join(import.meta.dir, '../..');
/** The files that define the keys of the config: every schema file under config/, and the shapes the config shares with a feature. */
const SCHEMA_FILES = [
  ...new Glob('config/**/schema.ts').scanSync({ cwd: SOURCE_ROOT }),
  'owner/schema.ts',
  'board/schema.ts',
  'doctor/schema.ts',
].toSorted();
/** Every documented key today: a file the scan stops reading drops keys, and the count shows it. */
const DOCUMENTED_KEYS = 172;
/** A key of a zod object: its value is a `z` call (the chain may continue on the next lines) or a named schema constant. */
const KEY =
  /^ {2,}(?:'[^']+'|[A-Za-z]\w*): (?:z$|z\.(?!infer\b|RefinementCtx\b)|[A-Z][A-Z0-9_]+\b)/;

describe('the config schema documents every key', () => {
  test('a comment sits directly above each key of every schema file', () => {
    let keys = 0;
    const missing: string[] = [];

    for (const file of SCHEMA_FILES) {
      const lines = readFileSync(join(SOURCE_ROOT, file), 'utf8').split('\n');

      lines.forEach((line, index) => {
        if (!KEY.test(line)) {
          return;
        }

        keys += 1;

        if (!(lines[index - 1] ?? '').trim().endsWith('*/')) {
          missing.push(`${file}:${index + 1}: ${line.trim().slice(0, 60)}`);
        }
      });
    }

    expect(keys).toBe(DOCUMENTED_KEYS);
    expect(missing).toEqual([]);
  });
});

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The files that define the keys of the config: the generated configuration reference reads the comment above each key. */
const SCHEMA_FILES = ['config/schema.ts', 'owner/schema.ts', 'board/schema.ts', 'doctor/schema.ts'];
/** A key of a zod object: its value is a `z.` call or a named schema constant. */
const KEY = /^ {2,}(?:'[^']+'|[A-Za-z]\w*): (?:z\.\w+\(|[A-Z][A-Z0-9_]+\b)/;

describe('the config schema documents every key', () => {
  test('a comment sits directly above each key of every schema file', () => {
    let keys = 0;
    const missing: string[] = [];

    for (const file of SCHEMA_FILES) {
      const lines = readFileSync(join(import.meta.dir, '../..', file), 'utf8').split('\n');

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

    expect(keys).toBeGreaterThan(100);
    expect(missing).toEqual([]);
  });
});

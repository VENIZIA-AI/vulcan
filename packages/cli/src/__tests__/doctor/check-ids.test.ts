import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DoctorChecks } from '../../doctor/common/constants.ts';

const SOURCE = join(import.meta.dir, '../../doctor/common/constants.ts');
const PAGE = join(
  import.meta.dir,
  '../../../../../docs/wiki/content/references/commands/doctor.md',
);

describe('every doctor check id is documented', () => {
  test('a comment sits directly above each id, which the generated reference reads', () => {
    const lines = readFileSync(SOURCE, 'utf8').split('\n');
    const start = lines.findIndex((line) => line.startsWith('export class DoctorChecks'));
    const end = lines.findIndex((line, index) => index > start && line === '}');
    const ids = lines.flatMap((line, index) =>
      index > start && index < end && line.startsWith('  static readonly ') ? [index] : [],
    );
    const missing = ids.filter((index) => !(lines[index - 1] ?? '').trim().endsWith('*/'));

    expect(ids).toHaveLength(Object.keys(DoctorChecks).length);
    expect(missing.map((index) => lines[index].trim())).toEqual([]);
  });

  test('the doctor page names every id', () => {
    const page = readFileSync(PAGE, 'utf8');
    const unnamed = Object.values(DoctorChecks).filter((id) => !page.includes(`\`${id}\``));

    expect(unnamed).toEqual([]);
  });
});

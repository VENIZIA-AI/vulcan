import { PackageEntries } from '@/common/package-entries';
import { AtlasSymbols } from '@/symbols/generator';
import type { ISymbolRecord } from '@/symbols';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'bun:test';
import { SymbolWorkspace } from '../helpers/symbol-workspace.helper';

// A workspace the test builds itself: sources, declarations and declaration maps, the same on every machine.
const workspace = SymbolWorkspace.create();
const REPOSITORY_ROOT = workspace.root;
const SAMPLE_SIZE = 50;

afterAll(workspace.remove);

/**
 * Re-exports under another name (`export { BaseRelationalEntity as BaseEntity }`) have no declaration of their own, so
 * `file:line` points at what they alias and the line names the aliased symbol. Listed, never skipped - the sample
 * measures every other symbol.
 */
const KNOWN_ALIASES = new Set<string>(['BaseEntity', 'IConfigs']);

/**
 * The aliases whose declaration file never spells the alias out at all - pinned exactly, so a new one fails here
 * instead of hiding. `IConfigs` is absent: its file spells that name on another line.
 */
const ALIASES_MISSING_FROM_THEIR_FILE = new Set<string>(['BaseEntity']);

/** Whether the file `entry` names exists and mentions the symbol at all - the line-level check is the sample's job. */
const fileMentionsItsName = (opts: { entry: ISymbolRecord }): boolean => {
  const absolute = join(REPOSITORY_ROOT, opts.entry.file);

  return existsSync(absolute) && readFileSync(absolute, 'utf8').includes(opts.entry.name);
};

/** Round-robin across packages, evenly spaced inside each, so one large package cannot fill the sample. */
const sampleOf = (opts: { symbols: ISymbolRecord[]; size: number }): ISymbolRecord[] => {
  const byPackage = new Map<string, ISymbolRecord[]>();

  for (const symbol of opts.symbols) {
    const bucket = byPackage.get(symbol.package) ?? [];

    bucket.push(symbol);
    byPackage.set(symbol.package, bucket);
  }

  const buckets = [...byPackage.values()];
  const perPackage = Math.ceil(opts.size / Math.max(buckets.length, 1));
  const picked: ISymbolRecord[] = [];

  for (let round = 0; round < perPackage; round += 1) {
    for (const bucket of buckets) {
      const stride = Math.max(Math.floor(bucket.length / perPackage), 1);
      const entry = bucket[round * stride];

      if (entry && picked.length < opts.size) {
        picked.push(entry);
      }
    }
  }

  return picked;
};

describe('symbol accuracy on a 50-symbol sample', () => {
  const symbols = AtlasSymbols.recordsOf({
    repoRoot: REPOSITORY_ROOT,
    packages: SymbolWorkspace.PACKAGES.map((dir) =>
      PackageEntries.readDirectory({
        directory: join(REPOSITORY_ROOT, 'packages', dir),
        name: dir,
      }),
    ),
  });
  // The aliases are pinned by the whole-table test below; the sample measures the rest.
  const sample = sampleOf({
    symbols: symbols.filter((entry) => !KNOWN_ALIASES.has(entry.name)),
    size: SAMPLE_SIZE,
  });

  test('the sample covers every package of the workspace, at the full sample size', () => {
    expect(sample).toHaveLength(SAMPLE_SIZE);
    expect(new Set(sample.map((entry) => entry.package)).size).toBe(
      new Set(symbols.map((entry) => entry.package)).size,
    );
  });

  test('every symbol lands in a file that names it, except the aliases listed here', () => {
    const unresolved = symbols.filter((entry) => !fileMentionsItsName({ entry }));

    expect([...new Set(unresolved.map((entry) => entry.name))].sort()).toEqual(
      [...ALIASES_MISSING_FROM_THEIR_FILE].sort(),
    );
  });

  const rows: Array<[string, ISymbolRecord]> = sample.map((entry) => [
    `${entry.specifier} ${entry.name}`,
    entry,
  ]);

  test.each(rows)('%s resolves to a source line that carries the name', (_label, entry) => {
    const absolute = join(REPOSITORY_ROOT, entry.file);

    expect(existsSync(absolute), `${entry.file} does not exist`).toBe(true);

    const lines = readFileSync(absolute, 'utf8').split('\n');

    expect(entry.line).toBeGreaterThan(0);
    expect(entry.line, `${entry.file}:${entry.line} is past the end`).toBeLessThanOrEqual(
      lines.length,
    );
    expect(lines[entry.line - 1], `${entry.file}:${entry.line} misses ${entry.name}`).toContain(
      entry.name,
    );
  });
});

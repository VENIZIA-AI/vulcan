import { describe, expect, test } from 'bun:test';
import { ProjectConfig } from '@/common/project-config';
import { GraphSymbols } from '@/graph/graph-symbols';

const project = ProjectConfig.toAtlasProject({
  root: '/work',
  manifest: { schemaVersion: 1, name: 'fx', packages: [] },
});

describe('GraphSymbols.recordsOf', () => {
  test('gives the records of the reader', () => {
    const records = [{ name: 'A' }];
    const result = GraphSymbols.recordsOf({
      project,
      read: () => JSON.parse(JSON.stringify(records)),
    });

    expect(result.records).toHaveLength(1);
    expect(result.error).toBeUndefined();
  });

  test('a reader that throws costs the symbols, not the graph: no records and the reason', () => {
    const result = GraphSymbols.recordsOf({
      project,
      read: () => {
        throw new Error('no typescript to read with');
      },
    });

    expect(result).toEqual({ records: [], error: 'no typescript to read with' });
  });
});

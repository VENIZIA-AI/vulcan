import { describe, expect, test } from 'bun:test';
import { healNextTags, planNextTag } from '../next-tag.ts';
import type { IDistTags } from '../next-tag.ts';

describe('planNextTag', () => {
  test('next below latest is moved to latest', () => {
    expect(planNextTag({ tags: { latest: '0.3.1', next: '0.2.0-9' } })).toBe('0.3.1');
  });

  test('a prerelease sorts below the release of the same x.y.z', () => {
    expect(planNextTag({ tags: { latest: '0.3.1', next: '0.3.1-0' } })).toBe('0.3.1');
  });

  test('equal is fine', () => {
    expect(planNextTag({ tags: { latest: '0.3.1', next: '0.3.1' } })).toBeUndefined();
  });

  test('next above latest is left alone', () => {
    expect(planNextTag({ tags: { latest: '0.3.1', next: '0.4.0-0' } })).toBeUndefined();
  });

  test('versions compare as numbers, not text', () => {
    expect(planNextTag({ tags: { latest: '0.9.0', next: '0.10.0-1' } })).toBeUndefined();
    expect(planNextTag({ tags: { latest: '0.10.0', next: '0.9.0' } })).toBe('0.10.0');
  });

  test('a missing next is set to latest', () => {
    expect(planNextTag({ tags: { latest: '0.3.1' } })).toBe('0.3.1');
  });

  test('a missing latest changes nothing', () => {
    expect(planNextTag({ tags: { next: '0.2.0-9' } })).toBeUndefined();
    expect(planNextTag({ tags: {} })).toBeUndefined();
  });

  test('a stable version just published counts as latest before the registry shows it', () => {
    const tags: IDistTags = { latest: '0.3.0', next: '0.3.0' };

    expect(planNextTag({ tags, published: { version: '0.3.1', tag: 'latest' } })).toBe('0.3.1');
  });

  test('a prerelease just published to next counts as next before the registry shows it', () => {
    const tags: IDistTags = { latest: '0.3.1', next: '0.2.0-9' };

    expect(planNextTag({ tags, published: { version: '0.4.0-0', tag: 'next' } })).toBeUndefined();
  });

  test('a published version on another tag changes nothing about the plan', () => {
    const tags: IDistTags = { latest: '0.3.1', next: '0.2.0-9' };

    expect(planNextTag({ tags, published: { version: '0.4.0-0', tag: 'beta' } })).toBe('0.3.1');
  });
});

describe('healNextTags', () => {
  const names = ['@venizia/vulcan-okf', '@venizia/vulcan-atlas', '@venizia/vulcan'];

  test('every package below latest gets next moved, and each move is reported', () => {
    const moves: string[] = [];
    const lines: string[] = [];
    const result = healNextTags({
      packages: names,
      read: () => ({ latest: '0.3.1', next: '0.2.0-9' }),
      move: opts => {
        moves.push(`${opts.name}@${opts.version}`);
      },
      log: line => lines.push(line),
    });

    expect(moves).toEqual(names.map(name => `${name}@0.3.1`));
    expect(result).toEqual({ moved: names, failed: [] });
    expect(lines.filter(line => line.includes('0.2.0-9'))).toHaveLength(3);
  });

  test('a package already at or above latest is not touched', () => {
    const moves: string[] = [];
    const result = healNextTags({
      packages: names,
      read: () => ({ latest: '0.3.1', next: '0.3.1' }),
      move: opts => {
        moves.push(opts.name);
      },
      log: () => {},
    });

    expect(moves).toEqual([]);
    expect(result).toEqual({ moved: [], failed: [] });
  });

  test('a failed move is reported loudly and does not stop the others', () => {
    const lines: string[] = [];
    const result = healNextTags({
      packages: names,
      read: () => ({ latest: '0.3.1' }),
      move: opts => {
        if (opts.name === '@venizia/vulcan-atlas') {
          throw new Error('E403');
        }
      },
      log: line => lines.push(line),
    });

    expect(result.failed).toEqual(['@venizia/vulcan-atlas']);
    expect(result.moved).toEqual(['@venizia/vulcan-okf', '@venizia/vulcan']);
    expect(lines.some(line => line.startsWith('::warning::') && line.includes('E403'))).toBe(true);
  });

  test('a registry read that fails is reported and skipped', () => {
    const lines: string[] = [];
    const result = healNextTags({
      packages: ['@venizia/vulcan'],
      read: () => {
        throw new Error('offline');
      },
      move: () => {},
      log: line => lines.push(line),
    });

    expect(result).toEqual({ moved: [], failed: ['@venizia/vulcan'] });
    expect(lines.some(line => line.startsWith('::warning::') && line.includes('offline'))).toBe(
      true,
    );
  });
});

import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { ConfigLoader } from '../../config/index.ts';

const REPOSITORY = join(import.meta.dir, '..', '..', '..', '..', '..');

describe("this repository's own config", () => {
  test('loads, and refuses writes outside the project instead of asking about them', async () => {
    const loaded = await ConfigLoader.load({ root: REPOSITORY });

    expect(loaded.ok).toBe(true);
    expect(loaded.ok && loaded.config.guard.outside).toBe('deny');
  });
});

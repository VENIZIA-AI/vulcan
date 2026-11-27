import { AtlasConstants } from '@/common';
import { describe, expect, test } from 'bun:test';

describe('atlas skeleton', () => {
  test('names the server', () => {
    expect(AtlasConstants.SERVER_NAME).toBe('vulcan-atlas');
  });
});

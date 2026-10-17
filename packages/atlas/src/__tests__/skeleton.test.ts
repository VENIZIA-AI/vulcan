import { AtlasConstants, AtlasModes } from '@/common';
import { describe, expect, test } from 'bun:test';

describe('atlas skeleton', () => {
  test('names the server and its one mode - the packaged snapshot is gone', () => {
    expect(AtlasConstants.SERVER_NAME).toBe('vulcan-atlas');
    expect(AtlasModes.isValid('repo')).toBe(true);
    expect(AtlasModes.isValid('snapshot')).toBe(false);
    expect(AtlasModes.isValid('cloud')).toBe(false);
  });
});

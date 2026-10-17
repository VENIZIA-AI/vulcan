import { expect, test } from 'bun:test';
import { regenerateHintOf } from '@/common/regenerate-hint';

test('the stale hint names the tool command, never a make target the project may not have', () => {
  expect(regenerateHintOf({ command: 'surface' })).toBe('run `vulcan x atlas surface gen`');
});

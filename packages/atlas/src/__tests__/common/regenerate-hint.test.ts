import { expect, test } from 'bun:test';
import { RegenerateHint } from '@/common/regenerate-hint';

test('the stale hint names the tool command, never a make target the project may not have', () => {
  expect(RegenerateHint.of({ command: 'surface' })).toBe('run `vulcan x atlas surface gen`');
});

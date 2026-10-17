import { expect, test } from 'bun:test';
import { REGENERATE_HINT } from '../config.ts';

test('the stale hint names the tool command, never a make target the project may not have', () => {
  expect(REGENERATE_HINT).toBe('run `vulcan x okf gen`');
});

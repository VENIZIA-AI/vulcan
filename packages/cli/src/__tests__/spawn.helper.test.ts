import { expect, test } from 'bun:test';
import { spawnSyncBounded } from './spawn.helper.ts';

test('a child that outlives its bound is killed, and the call throws naming the command', () => {
  const started = performance.now();

  expect(() => spawnSyncBounded({ cmd: ['sleep', '30'], timeout: 300 })).toThrow(
    '[spawnSyncBounded] did not exit within 300 ms, killed | cmd: sleep 30',
  );
  expect(performance.now() - started).toBeLessThan(5_000);
});

test('a child that exits in time returns its result', () => {
  const result = spawnSyncBounded({ cmd: ['sh', '-c', 'echo ok; exit 3'] });

  expect(result.exitCode).toBe(3);
  expect(result.stdout.toString()).toBe('ok\n');
});

import { afterEach, describe, expect, test } from 'bun:test';
import { headStatusOf, waitForTarballs } from '../release-wait.ts';

const TARGETS = [
  { name: '@v/okf', version: '1.0.0' },
  { name: '@v/atlas', version: '1.0.0' },
  { name: '@v/cli', version: '1.0.0' },
];

/** A clock the test moves: the waits cost nothing and the elapsed time is exact. */
const clock = () => {
  let now = 0;

  return {
    now: () => now,
    sleep: async (ms: number): Promise<void> => {
      now += ms;
    },
    waited: () => now,
  };
};

describe('waitForTarballs waits until every tarball of the train is served', () => {
  test('a tarball that answers 404 twice and then 200 is waited for, and the wait is reported', async () => {
    const time = clock();
    const answers = new Map<string, number[]>([
      ['u/okf', [404, 404, 200]],
      ['u/atlas', [200]],
      ['u/cli', [200]],
    ]);
    const waits: string[] = [];
    const result = await waitForTarballs({
      targets: TARGETS,
      urlOf: (target) => `u/${target.name.split('/')[1]}`,
      statusOf: async (url) => {
        const queue = answers.get(url) ?? [];

        return queue.length > 1 ? (queue.shift() ?? 0) : (queue[0] ?? 0);
      },
      now: time.now,
      sleep: time.sleep,
      timeoutMs: 600_000,
      intervalMs: 10_000,
      onWait: (missing) => waits.push(missing.map((target) => target.name).join(',')),
    });

    expect(result.missing).toEqual([]);
    expect(result.ready.map((target) => target.name)).toEqual(['@v/okf', '@v/atlas', '@v/cli']);
    expect(time.waited()).toBe(20_000);
    expect(waits).toEqual(['@v/okf', '@v/okf']);
  });

  test('a version the registry does not show yet (no tarball URL) is waited for like a 404', async () => {
    const time = clock();
    let calls = 0;
    const result = await waitForTarballs({
      targets: [TARGETS[0]],
      urlOf: () => (++calls < 3 ? undefined : 'u/okf'),
      statusOf: async () => 200,
      now: time.now,
      sleep: time.sleep,
      timeoutMs: 600_000,
      intervalMs: 5_000,
    });

    expect(result.missing).toEqual([]);
    expect(time.waited()).toBe(10_000);
  });

  test('a tarball that is never served is reported as missing when the time is up, with the others ready', async () => {
    const time = clock();
    const result = await waitForTarballs({
      targets: TARGETS,
      urlOf: (target) => `u/${target.name}`,
      statusOf: async (url) => (url.endsWith('atlas') ? 404 : 200),
      now: time.now,
      sleep: time.sleep,
      timeoutMs: 60_000,
      intervalMs: 10_000,
    });

    expect(result.missing.map((target) => target.name)).toEqual(['@v/atlas']);
    expect(result.ready.map((target) => target.name)).toEqual(['@v/okf', '@v/cli']);
    expect(time.waited()).toBeGreaterThanOrEqual(60_000);
    expect(time.waited()).toBeLessThan(80_000);
  });

  test('any status but 200 is not served: a 302, a 403 and a network failure keep the wait going', async () => {
    const time = clock();
    const result = await waitForTarballs({
      targets: [TARGETS[0]],
      urlOf: () => 'u/okf',
      statusOf: async () => 302,
      now: time.now,
      sleep: time.sleep,
      timeoutMs: 30_000,
      intervalMs: 10_000,
    });

    expect(result.missing).toHaveLength(1);
  });

  test('nothing to wait for is done at once', async () => {
    const time = clock();
    const result = await waitForTarballs({
      targets: [],
      urlOf: () => undefined,
      statusOf: async () => 0,
      now: time.now,
      sleep: time.sleep,
      timeoutMs: 1_000,
      intervalMs: 100,
    });

    expect(result).toEqual({ ready: [], missing: [] });
    expect(time.waited()).toBe(0);
  });
});

describe('headStatusOf asks a real server', () => {
  let server: ReturnType<typeof Bun.serve> | undefined;

  afterEach(() => {
    server?.stop(true);
  });

  test('it returns the status the server gives, and 0 when nothing answers', async () => {
    let calls = 0;

    server = Bun.serve({
      port: 0,
      fetch: () => new Response(null, { status: ++calls < 3 ? 404 : 200 }),
    });

    const url = `http://127.0.0.1:${server.port}/pkg.tgz`;

    expect(await headStatusOf({ url })).toBe(404);
    expect(await headStatusOf({ url })).toBe(404);
    expect(await headStatusOf({ url })).toBe(200);

    server.stop(true);
    expect(await headStatusOf({ url })).toBe(0);
  });
});

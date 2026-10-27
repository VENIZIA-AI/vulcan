/**
 * After a publish the registry and the tarball URLs lag by minutes: IGNIS's tarball answered 404 for about eight
 * minutes after `npm view` showed the version, and a consumer that installs it at once gets that 404. The release is
 * reported done only when every tarball of the train answers 200.
 */

export interface ITarballTarget {
  name: string;
  version: string;
}

export interface ITarballWait {
  ready: ITarballTarget[];
  missing: ITarballTarget[];
}

/** The status a HEAD request gets; 0 when nothing answers. Only a 200 counts as served. */
export const headStatusOf = async (opts: { url: string }): Promise<number> => {
  try {
    const response = await fetch(opts.url, {
      method: 'HEAD',
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    });

    return response.status;
  } catch {
    return 0;
  }
};

/**
 * Polls every target not yet served until all answer 200 or `timeoutMs` has passed. A version whose tarball URL the
 * registry cannot show yet (`urlOf` returns `undefined`) waits like a 404; any status but 200 is not served.
 */
export const waitForTarballs = async (opts: {
  targets: ITarballTarget[];
  urlOf: (target: ITarballTarget) => string | undefined | Promise<string | undefined>;
  statusOf: (url: string) => Promise<number>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  timeoutMs: number;
  intervalMs: number;
  onWait?: (missing: ITarballTarget[]) => void;
}): Promise<ITarballWait> => {
  const deadline = opts.now() + opts.timeoutMs;
  const ready: ITarballTarget[] = [];
  let pending = [...opts.targets];

  while (pending.length > 0) {
    const stillPending: ITarballTarget[] = [];

    for (const target of pending) {
      const url = await opts.urlOf(target);

      if (url !== undefined && (await opts.statusOf(url)) === 200) {
        ready.push(target);
      } else {
        stillPending.push(target);
      }
    }

    pending = stillPending;

    if (pending.length === 0 || opts.now() >= deadline) {
      break;
    }

    opts.onWait?.(pending);
    await opts.sleep(opts.intervalMs);
  }

  const order = (target: ITarballTarget): number => opts.targets.indexOf(target);

  return { ready: ready.sort((a, b) => order(a) - order(b)), missing: pending };
};

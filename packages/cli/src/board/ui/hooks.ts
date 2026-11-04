import { useCallback, useEffect, useRef, useState } from 'react';
import type { IBoardData } from '../common/index.ts';
import { BoardStorage } from './storage.ts';

/** A choice that survives a reload: `allowed` guards against a value some older page wrote. */
export const useStored = <TValue extends string>(opts: {
  key: string;
  initial: TValue;
  allowed: readonly TValue[];
}): [TValue, (value: TValue) => void] => {
  const [value, setValue] = useState<TValue>(() => {
    const kept = BoardStorage.get({ key: opts.key }) as TValue | null;

    return kept !== null && opts.allowed.includes(kept) ? kept : opts.initial;
  });
  const save = useCallback(
    (next: TValue) => {
      BoardStorage.set({ key: opts.key, value: next });
      setValue(next);
    },
    [opts.key],
  );

  return [value, save];
};

/** The time, again every minute: what the page says as "5 min ago" moves without an event. */
export const useNow = (): number => {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);

    return () => clearInterval(timer);
  }, []);

  return now;
};

export type TLiveState = 'wait' | 'on' | 'off' | 'big';

/** `vulcan board serve`: each snapshot of the stream replaces the data. A dropped stream is retried with a growing wait. */
export const useLive = (opts: {
  data: IBoardData;
  onData: (data: IBoardData) => void;
}): TLiveState => {
  const stream = opts.data.live?.stream;
  const [state, setState] = useState<TLiveState>('wait');

  useEffect(() => {
    if (stream === undefined) {
      return undefined;
    }

    let source: EventSource | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let failures = 0;
    const connect = (): void => {
      source = new EventSource(stream);
      source.onmessage = (message) => {
        failures = 0;
        const next = JSON.parse(message.data);

        if (next.tooLarge) {
          setState('big');

          return;
        }

        opts.onData(next);
        setState('on');
      };
      source.onerror = () => {
        source?.close();
        setState('off');

        if (!stopped) {
          timer = setTimeout(connect, Math.min(30_000, 1000 * 2 ** failures));
          failures += 1;
        }
      };
    };

    connect();

    return () => {
      stopped = true;
      source?.close();
      clearTimeout(timer);
    };
  }, [stream]);

  return state;
};

/** Plays a CSS animation again each time `trigger` changes, but not when the page first draws; none when motion is reduced. */
export const useReplay = (opts: {
  ref: { current: Element | null };
  trigger: unknown;
  className: string;
  when?: boolean;
}): void => {
  const first = useRef(true);

  useEffect(() => {
    const element = opts.ref.current;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!first.current && element && !reduced && opts.when !== false) {
      element.classList.remove(opts.className);
      element.getBoundingClientRect();
      element.classList.add(opts.className);
    }

    first.current = false;
  }, [opts.trigger]);
};

import { createContext, useContext } from 'react';
import type { TTranslate } from '../common/types.ts';

interface IUi {
  t: TTranslate;
  /** The clock of the page, moved every minute. */
  now: number;
}

/** The translator of the language the page is in, and the time it says "ago" against. */
export const UiContext = createContext<IUi>({ t: (key) => key, now: 0 });

export const useUi = (): IUi => useContext(UiContext);
export const useT = (): TTranslate => useContext(UiContext).t;

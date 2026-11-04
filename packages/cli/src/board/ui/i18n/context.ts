import { createContext, useContext } from 'react';
import type { TTranslate } from '../common/types.ts';

/** The translator of the language the page is in. */
export const TranslateContext = createContext<TTranslate>((key) => key);

export const useT = (): TTranslate => useContext(TranslateContext);

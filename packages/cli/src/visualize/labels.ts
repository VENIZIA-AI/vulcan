import { DEFAULT_CHROME } from './constants.ts';
import type { TChrome } from './constants.ts';
import { VI_CHROME } from './labels-vi.ts';
import type { TVisualizeSpec } from './schema.ts';

/** The word sets that ship with the page, by the primary subtag of the language; English is the default. */
export const BUNDLED_LANGUAGES: Readonly<Record<string, TChrome>> = {
  en: DEFAULT_CHROME,
  vi: VI_CHROME,
};

const definedOnly = (opts: {
  value: Record<string, string | undefined> | undefined;
}): Record<string, string> =>
  Object.fromEntries(
    Object.entries(opts.value ?? {}).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );

/** The bundled words of a language: `vi`, `vi-VN` and `VI` are Vietnamese; no bundled set is English. */
const bundledOf = (opts: { language?: string }): TChrome => {
  const primary = (opts.language ?? 'en').trim().split(/[-_]/)[0]?.toLowerCase() ?? 'en';

  return Object.hasOwn(BUNDLED_LANGUAGES, primary)
    ? (BUNDLED_LANGUAGES[primary] ?? DEFAULT_CHROME)
    : DEFAULT_CHROME;
};

/** The strings of the page: the bundled words of the page's language, with whatever the spec replaces. */
export const chromeOf = (opts: { spec: TVisualizeSpec; language?: string }): TChrome => {
  const given = opts.spec.chrome ?? {};
  const base = bundledOf({ language: opts.language });
  const merged: Record<string, unknown> = { ...base };

  for (const [key, value] of Object.entries(given)) {
    if (typeof value === 'string') {
      merged[key] = value;
    }
  }

  return {
    ...base,
    ...Object.fromEntries(Object.entries(merged).filter(([, value]) => typeof value === 'string')),
    statusStates: { ...base.statusStates, ...definedOnly({ value: given.statusStates }) },
    minimapStates: { ...base.minimapStates, ...definedOnly({ value: given.minimapStates }) },
    evidenceLabels: { ...base.evidenceLabels, ...definedOnly({ value: given.evidenceLabels }) },
  };
};

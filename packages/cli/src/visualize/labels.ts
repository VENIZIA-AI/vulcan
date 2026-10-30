import { DEFAULT_CHROME } from './constants.ts';
import type { TChrome } from './constants.ts';
import type { TVisualizeSpec } from './schema.ts';

const definedOnly = (opts: {
  value: Record<string, string | undefined> | undefined;
}): Record<string, string> =>
  Object.fromEntries(
    Object.entries(opts.value ?? {}).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );

/** The strings of the page: the bundled words of the page's language, with whatever the spec replaces. */
export const chromeOf = (opts: { spec: TVisualizeSpec; language?: string }): TChrome => {
  const given = opts.spec.chrome ?? {};
  const merged: Record<string, unknown> = { ...DEFAULT_CHROME };

  for (const [key, value] of Object.entries(given)) {
    if (typeof value === 'string') {
      merged[key] = value;
    }
  }

  return {
    ...DEFAULT_CHROME,
    ...Object.fromEntries(Object.entries(merged).filter(([, value]) => typeof value === 'string')),
    statusStates: { ...DEFAULT_CHROME.statusStates, ...definedOnly({ value: given.statusStates }) },
    minimapStates: {
      ...DEFAULT_CHROME.minimapStates,
      ...definedOnly({ value: given.minimapStates }),
    },
    evidenceLabels: {
      ...DEFAULT_CHROME.evidenceLabels,
      ...definedOnly({ value: given.evidenceLabels }),
    },
  };
};

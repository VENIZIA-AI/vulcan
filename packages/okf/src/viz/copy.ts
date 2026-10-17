import { Locales } from './common/index.ts';
import type { IVizCopy, TLocale } from './common/index.ts';

type TRecord = Record<string, unknown>;

const isRecord = (opts: { value: unknown }): opts is { value: TRecord } =>
  typeof opts.value === 'object' && opts.value !== null && !Array.isArray(opts.value);

/** The copy a project gets when its config gives none: plain, built from the brand. */
const defaultCopy = (opts: { brand: string }): Record<TLocale, IVizCopy> => ({
  [Locales.EN]: {
    heading: `Understand ${opts.brand}, one concept at a time.`,
    tagline: `The ${opts.brand} knowledge bundle.`,
    sectionDescriptions: {},
  },
  [Locales.VI]: {
    heading: `Hiểu ${opts.brand}, từng khái niệm một.`,
    tagline: `Knowledge bundle của ${opts.brand}.`,
    sectionDescriptions: {},
  },
});

/** One locale of `okf.viz.copy` over the default: a field the project left out keeps the default. */
const mergeLocale = (opts: { base: IVizCopy; value: unknown }): IVizCopy => {
  const given = { value: opts.value };

  if (!isRecord(given)) {
    return opts.base;
  }

  const descriptions = { value: given.value.sectionDescriptions };

  return {
    heading: typeof given.value.heading === 'string' ? given.value.heading : opts.base.heading,
    tagline: typeof given.value.tagline === 'string' ? given.value.tagline : opts.base.tagline,
    sectionDescriptions: isRecord(descriptions)
      ? Object.fromEntries(
          Object.entries(descriptions.value).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
          ),
        )
      : opts.base.sectionDescriptions,
  };
};

/** The explorer's copy per locale: the project's `okf.viz.copy` over a default built from the brand. */
export const resolveVizCopy = (opts: {
  brand: string;
  copy?: Record<string, unknown>;
}): Record<TLocale, IVizCopy> => {
  const base = defaultCopy({ brand: opts.brand });

  return {
    [Locales.EN]: mergeLocale({ base: base[Locales.EN], value: opts.copy?.[Locales.EN] }),
    [Locales.VI]: mergeLocale({ base: base[Locales.VI], value: opts.copy?.[Locales.VI] }),
  };
};

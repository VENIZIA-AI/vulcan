import { z } from 'zod';
import { RulePacks } from '../../../rules/packs.ts';
import { ConfigConstants } from '../../common/index.ts';

export const RULES_SECTION = {
  /** Choice of each base rule slot, keyed by rule ID (for example `V-W-01`) to the option picked; default `{}`. */
  rules: z.record(z.string().regex(ConfigConstants.RULE_ID_PATTERN), z.string()).default({}),
  /** The shipped rule packs this project follows, by name (`venizia`): rules for one stack, outside the base rules every project gets. */
  packs: z
    .array(
      z.string().refine((name) => RulePacks.names().includes(name), {
        error: () => `a rule pack VULCAN ships: ${RulePacks.names().join(', ')}`,
      }),
    )
    .default([]),
  /**
   * Takes items out of an array the shipped defaults or a rule pack added to, after every layer is in: the key is the dotted
   * name of the array (`atlas.sources`), the items are the strings of the array or, for an array of objects, their identity
   * (`presets` by `spec`, `atlas.sources` by `name`). An array not listed here, or an item that is not there, is reported by
   * `vulcan config effective`.
   */
  remove: z
    .record(
      z.string().refine((key) => Object.hasOwn(ConfigConstants.LAYERED_ARRAYS, key), {
        error: () =>
          `an array that shipped defaults can add to: ${Object.keys(ConfigConstants.LAYERED_ARRAYS).join(', ')}`,
      }),
      z.array(z.string().min(1)),
    )
    .optional(),
};

export const DIGEST_SECTION = {
  /** The session-start digest: the rule IDs it repeats as "the rules sessions drop most" - base or the project's own. */
  digest: z
    .strictObject({
      /**
       * Rule IDs the digest repeats as dropped most, each matching the rule ID pattern. The list the project writes is added to
       * the shipped one (`base/defaults.config.json`, then the packs'); `remove` takes ids out of the sum.
       */
      oftenDropped: z.array(z.string().regex(ConfigConstants.RULE_ID_PATTERN)).default([]),
    })
    .default({ oftenDropped: [] }),
};

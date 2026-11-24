import { z } from 'zod';
import {
  AGENTS_SECTION,
  ATLAS_SECTION,
  BOARD_SECTION,
  CLAUDE_SECTION,
  COMMIT_SECTION,
  DIGEST_SECTION,
  DOCTOR_SECTION,
  EVENTS_SECTION,
  GUARD_SECTION,
  KNOWLEDGE_SECTION,
  LOCAL_SECTION,
  OKF_SECTION,
  OWNER_SECTION,
  PACKAGES_SECTION,
  PROJECT_SECTION,
  RULES_SECTION,
  THEME_SECTION,
} from './sections/index.ts';

export { pathKeyOf } from './sections/index.ts';

/**
 * `.configs/vulcan.config.*` - strict: an unknown key is a typo, and a typo is an error. The sections are spread in the
 * order of the keys, which is the order of the parsed config.
 */
export const VULCAN_CONFIG_SCHEMA = z.strictObject({
  ...PROJECT_SECTION,
  ...AGENTS_SECTION,
  ...RULES_SECTION,
  ...PACKAGES_SECTION,
  ...KNOWLEDGE_SECTION,
  ...OKF_SECTION,
  ...ATLAS_SECTION,
  ...THEME_SECTION,
  ...BOARD_SECTION,
  ...DOCTOR_SECTION,
  ...CLAUDE_SECTION,
  ...DIGEST_SECTION,
  ...OWNER_SECTION,
  ...GUARD_SECTION,
  ...COMMIT_SECTION,
  ...EVENTS_SECTION,
  ...LOCAL_SECTION,
});

/** What a project writes in `.configs/vulcan.config.mts`: every key optional or defaulted, unknown keys refused. */
export type VulcanConfig = z.input<typeof VULCAN_CONFIG_SCHEMA>;
/** The config as the CLI reads it: every default filled in. */
export type TResolvedConfig = z.output<typeof VULCAN_CONFIG_SCHEMA>;

/** Identity at run time; gives TS and JS configs their types. The parameter is the options object (V-C-02). */
export const defineConfig = (config: VulcanConfig): VulcanConfig => config;

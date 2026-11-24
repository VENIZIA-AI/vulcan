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

/** The config in the flat shape the commands read (and the files of the releases before the groups wrote): every key optional or defaulted, unknown keys refused. */
export type TFlatConfig = z.input<typeof VULCAN_CONFIG_SCHEMA>;

type TFlatDoctor = NonNullable<TFlatConfig['doctor']>;

/**
 * What a project writes in `.configs/vulcan.config.mts`: seven groups, each one optional (the flat shape of the earlier files is still read
 * until the release that refuses it). The group types are `VulcanConfig.Project`, `.Agent`, `.Guard`, `.Board`, `.Knowledge`, `.Check`
 * and `.Common`.
 */
export type VulcanConfig = VulcanConfig.Groups | TFlatConfig;

// The one namespace of the package: it gives the group types the public name `VulcanConfig.<Group>` next to the type of the whole file.
// eslint-disable-next-line @typescript-eslint/no-namespace
export declare namespace VulcanConfig {
  type Project = {
    name?: TFlatConfig['name'];
    key?: NonNullable<TFlatConfig['project']>['key'];
    layout?: TFlatConfig['layout'];
    packages?: TFlatConfig['packages'];
    presets?: TFlatConfig['presets'];
  };
  type Agent = {
    list?: TFlatConfig['agents'];
    packs?: TFlatConfig['packs'];
    rules?: TFlatConfig['rules'];
    digest?: TFlatConfig['digest'];
    owner?: TFlatConfig['owner'];
    claude?: TFlatConfig['claude'];
  };
  type Guard = TFlatConfig['guard'];
  type Board = {
    events?: TFlatConfig['events'];
    page?: TFlatConfig['board'];
    provider?: TFlatConfig['provider'];
  };
  type Knowledge = NonNullable<TFlatConfig['knowledge']> & {
    okf?: TFlatConfig['okf'];
    atlas?: TFlatConfig['atlas'];
  };
  type Check = {
    doctor?: Omit<TFlatDoctor, 'layout'>;
    commit?: TFlatConfig['commit'];
    layout?: TFlatDoctor['layout'];
  };
  type Common = {
    theme?: TFlatConfig['theme'];
    local?: TFlatConfig['local'];
    remove?: TFlatConfig['remove'];
  };
  type Groups = {
    project?: Project;
    agent?: Agent;
    guard?: Guard;
    board?: Board;
    knowledge?: Knowledge;
    check?: Check;
    common?: Common;
  };
}
/** The config as the CLI reads it: every default filled in. */
export type TResolvedConfig = z.output<typeof VULCAN_CONFIG_SCHEMA>;

/** Identity at run time; gives TS and JS configs their types. The parameter is the options object (V-C-02). */
export const defineConfig = (config: VulcanConfig): VulcanConfig => config;

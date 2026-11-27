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
export const VulcanConfigSchema = z.strictObject({
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
export type TVulcanConfigInput = z.input<typeof VulcanConfigSchema>;

type TFlatDoctor = NonNullable<TVulcanConfigInput['doctor']>;

/**
 * What a project writes in `.configs/vulcan.config.mts`: seven groups, each one optional (the flat shape of the earlier files is still read
 * until the release that refuses it). The group types are `VulcanConfig.ProjectType`, `.AgentType`, `.GuardType`, `.BoardType`,
 * `.KnowledgeType`, `.CheckType` and `.CommonType`.
 */
export type VulcanConfigType = VulcanConfig.GroupsType | TVulcanConfigInput;

// The one namespace of the package: the rule is off for it alone.
/* eslint-disable @typescript-eslint/no-namespace */
/** The group types of the config, as `VulcanConfig.<Group>Type`. */
export declare namespace VulcanConfig {
  type ProjectType = {
    name?: TVulcanConfigInput['name'];
    key?: NonNullable<TVulcanConfigInput['project']>['key'];
    layout?: TVulcanConfigInput['layout'];
    packages?: TVulcanConfigInput['packages'];
    presets?: TVulcanConfigInput['presets'];
  };
  type AgentType = {
    list?: TVulcanConfigInput['agents'];
    packs?: TVulcanConfigInput['packs'];
    rules?: TVulcanConfigInput['rules'];
    digest?: TVulcanConfigInput['digest'];
    owner?: TVulcanConfigInput['owner'];
    claude?: TVulcanConfigInput['claude'];
  };
  type GuardType = TVulcanConfigInput['guard'];
  type BoardType = {
    events?: TVulcanConfigInput['events'];
    page?: TVulcanConfigInput['board'];
    provider?: TVulcanConfigInput['provider'];
  };
  type KnowledgeType = NonNullable<TVulcanConfigInput['knowledge']> & {
    okf?: TVulcanConfigInput['okf'];
    atlas?: TVulcanConfigInput['atlas'];
  };
  type CheckType = {
    doctor?: Omit<TFlatDoctor, 'layout'>;
    commit?: TVulcanConfigInput['commit'];
    layout?: TFlatDoctor['layout'];
  };
  type CommonType = {
    theme?: TVulcanConfigInput['theme'];
    local?: TVulcanConfigInput['local'];
    remove?: TVulcanConfigInput['remove'];
  };
  type GroupsType = {
    project?: ProjectType;
    agent?: AgentType;
    guard?: GuardType;
    board?: BoardType;
    knowledge?: KnowledgeType;
    check?: CheckType;
    common?: CommonType;
  };
}
/* eslint-enable @typescript-eslint/no-namespace */

/** The config as the CLI reads it: every default filled in. */
export type TVulcanConfigOutput = z.output<typeof VulcanConfigSchema>;

/** Identity at run time; gives TS and JS configs their types. The parameter is the options object (V-C-02). */
export const defineConfig = (config: VulcanConfigType): VulcanConfigType => config;

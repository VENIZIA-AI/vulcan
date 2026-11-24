import type { VulcanConfig } from '@venizia/vulcan';

// Team-shared Claude Code settings (permissions, env, enabledPlugins), merged by `vulcan project sync` into .claude/settings.json.
export const claude = {} satisfies NonNullable<VulcanConfig['claude']>;

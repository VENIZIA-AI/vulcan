import type { VulcanConfig } from '@venizia/vulcan';

export const common = {
  // W-00: a commit message never signs the commit as an agent. `vulcan project sync` installs the commit-msg hook; CI runs the same check.
  // The colour of this project's pages (vulcan page new); the generator has no colour of its own but a neutral slate.
  theme: { accent: '#8a5a20', accentDark: '#dead6a' },
  // The venizia pack adds the three repositories of the stack as atlas sources; this one is the repository itself.
  remove: { 'knowledge.atlas.sources': ['vulcan'] },
} satisfies VulcanConfig.Common;

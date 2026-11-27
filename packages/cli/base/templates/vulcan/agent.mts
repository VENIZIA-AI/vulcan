import type { VulcanConfig } from '@venizia/vulcan';

export const agent = {
  list: ['claude'],
  rules: { 'V-W-01': 'on-user-word' },
} satisfies VulcanConfig.AgentType;

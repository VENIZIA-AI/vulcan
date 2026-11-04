import type { VulcanConfig } from '@venizia/vulcan';

export default {
  project: { key: '{{key}}' },
  agents: ['claude'],
  rules: { 'V-W-01': 'on-user-word' },
} satisfies VulcanConfig;

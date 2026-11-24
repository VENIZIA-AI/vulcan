import type { VulcanConfig } from '@venizia/vulcan';
import { claude, doctor, okf, packages } from './vulcan/index.mts';

export default {
  project: { key: '{{key}}' },
  agents: ['claude'],
  rules: { 'V-W-01': 'on-user-word' },
  packages,
  okf,
  claude,
  doctor,
} satisfies VulcanConfig;

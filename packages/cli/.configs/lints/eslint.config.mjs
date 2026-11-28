import { houseConfigs } from '@venizia/dev-configs/linters';

export default [
  ...houseConfigs,
  // The owner turned this rule off by default; @venizia/dev-configs after 0.5.0-8 ships it off too.
  { rules: { 'venizia/no-parent-import': 'off' } },
];

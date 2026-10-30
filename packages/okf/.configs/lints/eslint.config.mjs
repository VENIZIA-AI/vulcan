import { asyncStyleConfigs, namingConventionConfigs } from '@venizia/dev-configs/linters';

// oxlint runs every other rule; ESLint keeps the one oxlint has no port of yet, and the async style rules.
export default [...namingConventionConfigs, ...asyncStyleConfigs];

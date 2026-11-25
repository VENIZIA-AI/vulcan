import type { VulcanConfig } from '@venizia/vulcan';
import { project, agent, guard, board, knowledge, check, common } from './vulcan/index.mts';

export default { project, agent, guard, board, knowledge, check, common } satisfies VulcanConfig;

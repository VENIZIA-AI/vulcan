import type { VulcanConfigType } from '@venizia/vulcan';
import { agent, board, check, common, guard, knowledge, project } from './vulcan/index.mts';

export default {
  project,
  agent,
  guard,
  board,
  knowledge,
  check,
  common,
} satisfies VulcanConfigType;

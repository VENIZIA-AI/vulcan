import type { TConstValue } from '@venizia/ignis-helpers/common';
import type { CodingAgents, ConfigExtensions, HookEvents } from './constants.ts';

export type TConfigExtension = TConstValue<typeof ConfigExtensions>;
export type TCodingAgent = TConstValue<typeof CodingAgents>;
export type THookEvent = TConstValue<typeof HookEvents>;

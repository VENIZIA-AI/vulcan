import type { TConstValue } from '../../common/index.ts';
import type {
  CodingAgents,
  ConfigExtensions,
  HookEvents,
  LibraryKinds,
  PackageKinds,
} from './constants.ts';

export type TConfigExtension = TConstValue<typeof ConfigExtensions>;
export type TCodingAgent = TConstValue<typeof CodingAgents>;
export type THookEvent = TConstValue<typeof HookEvents>;
export type TPackageKind = TConstValue<typeof PackageKinds>;
export type TLibraryKind = TConstValue<typeof LibraryKinds>;

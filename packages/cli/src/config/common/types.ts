import type { TConstValue } from '../../common/index.ts';
import type { ConfigExtensions, LibraryKinds, PackageKinds } from './constants.ts';

export type TConfigExtension = TConstValue<typeof ConfigExtensions>;
export type TPackageKind = TConstValue<typeof PackageKinds>;
export type TLibraryKind = TConstValue<typeof LibraryKinds>;

import type { TConstValue } from '../../common/index.ts';
import type { LibraryKinds, PackageKinds } from './constants.ts';

export type TPackageKind = TConstValue<typeof PackageKinds>;
export type TLibraryKind = TConstValue<typeof LibraryKinds>;

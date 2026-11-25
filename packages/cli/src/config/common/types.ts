import type { TConstValue } from '../../common/index.ts';
import type { LibraryTypes, PackageTypes } from './constants.ts';

export type TPackageType = TConstValue<typeof PackageTypes>;
export type TLibraryType = TConstValue<typeof LibraryTypes>;

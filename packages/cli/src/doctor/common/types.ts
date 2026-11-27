import type { TConstValue } from '../../common/index.ts';
import type { IConfigLayer, IConfigMerge, TVulcanConfigOutput } from '../../config/index.ts';
import type { DoctorChecks, PrivateValueKinds } from './constants.ts';

export type TDoctorCheck = TConstValue<typeof DoctorChecks>;
export type TPrivateValueKind = TConstValue<typeof PrivateValueKinds>;

export interface IViolation {
  check: TDoctorCheck;
  file: string;
  message: string;
}

export interface ICheckContext {
  root: string;
  config: TVulcanConfigOutput;
  configFile: string;
  /** The project's own object, the shipped layers below it and the merge, when the caller loaded them: the two config-layer checks need them. */
  layers?: {
    project: Record<string, unknown>;
    below: IConfigLayer[];
    merge: IConfigMerge;
  };
}

import type { TConstValue } from '../../common/index.ts';
import type { DoctorChecks, PrivateValueKinds } from './constants.ts';

export type TDoctorCheck = TConstValue<typeof DoctorChecks>;
export type TPrivateValueKind = TConstValue<typeof PrivateValueKinds>;

export interface IViolation {
  check: TDoctorCheck;
  file: string;
  message: string;
}

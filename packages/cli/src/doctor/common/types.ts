import type { TConstValue } from '../../common/index.ts';
import type { DoctorChecks } from './constants.ts';

export type TDoctorCheck = TConstValue<typeof DoctorChecks>;

export interface IViolation {
  check: TDoctorCheck;
  file: string;
  message: string;
}

import type { TConstValue } from '@/common/types';

export class MigrateDirections {
  static readonly UPGRADE = 'upgrade';
  static readonly DOWNGRADE = 'downgrade';
  /** The two versions are the same: nothing to do. */
  static readonly NONE = 'none';
}

export type TMigrateDirection = TConstValue<typeof MigrateDirections>;

/** Which way a step moves the app: undo what an item was (`downgrade`), or apply what it is (`upgrade`). */
export type TStepDirection = typeof MigrateDirections.UPGRADE | typeof MigrateDirections.DOWNGRADE;

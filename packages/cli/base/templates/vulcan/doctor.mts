import type { VulcanConfig } from '@venizia/vulcan';

// What `vulcan project doctor` is told: the files that may keep private values (privateValues.acknowledged) and the layout check (layout).
export const doctor = {} satisfies NonNullable<VulcanConfig['doctor']>;

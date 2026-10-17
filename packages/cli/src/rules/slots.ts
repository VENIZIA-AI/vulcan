import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE_DIRECTORY } from '../common/index.ts';
import type { ISlot } from './common/index.ts';

export const readSlots = (): Record<string, ISlot> => {
  const slots: Record<string, ISlot> = JSON.parse(
    readFileSync(join(BASE_DIRECTORY, 'slots.json'), 'utf8'),
  );

  return slots;
};

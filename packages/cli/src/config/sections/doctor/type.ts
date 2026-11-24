import type { z } from 'zod';
import type { DOCTOR_SCHEMA } from './schema.ts';

/** The settings of the layout check, every default filled in. */
export type TLayoutSettings = z.output<typeof DOCTOR_SCHEMA>['layout'];

/** One decision to keep private values in files, as doctor reads it. */
export type TPrivateValueAcknowledgement = z.output<
  typeof DOCTOR_SCHEMA
>['privateValues']['acknowledged'][number];

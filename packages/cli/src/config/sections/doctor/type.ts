import type { z } from 'zod';
import type { DoctorSchema } from './schema.ts';

/** The settings of the layout check, every default filled in. */
export type TLayoutSettings = z.output<typeof DoctorSchema>['layout'];

/** One decision to keep private values in files, as doctor reads it. */
export type TPrivateValueAcknowledgement = z.output<
  typeof DoctorSchema
>['privateValues']['acknowledged'][number];

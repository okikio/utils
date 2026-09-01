import { z } from 'zod';

/** Stable schema for one accepted meter fact. */
export const MeterReadingSchema = z.object({
	value: z.number(),
	at: z.iso.datetime({ offset: true }),
	attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
}).strict().readonly();

/** Runtime measurement validated before it enters an effect occurrence. */
export type MeterReadingType = z.output<typeof MeterReadingSchema>;

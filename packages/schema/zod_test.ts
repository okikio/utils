import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import * as z from 'zod';

import { jsonSchema } from './zod.ts';

describe('Zod JSON Schema projection', () => {
	it('projects Zod input and output contracts through the public Zod adapter', () => {
		const TestSchema = z.object({ count: z.coerce.number().int().positive() });
		const input = jsonSchema(TestSchema, 'input') as Readonly<Record<string, unknown>>;
		const output = jsonSchema(TestSchema, 'output') as Readonly<Record<string, unknown>>;
		expect(input).toBeDefined();
		expect(output).toBeDefined();
		expect(input).not.toBe(output);
	});

	it('leaves schemas owned by other Standard Schema vendors to another projector', () => {
		const TestSchema = {
			'~standard': {
				version: 1 as const,
				vendor: 'test',
				validate: (value: unknown) => ({ value }),
			},
		};
		expect(jsonSchema(TestSchema)).toBeUndefined();
	});
});

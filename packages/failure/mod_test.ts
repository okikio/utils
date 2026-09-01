import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import type { StandardSchemaV1 } from '@standard-schema/spec';

import * as failure from './mod.ts';

const Timeout = failure.define({
	id: 'capture.timeout',
	description: 'Capture exceeded its deadline.',
	data: {
		'~standard': {
			version: 1,
			vendor: 'test',
			validate(value: unknown) {
				return typeof value === 'object' && value !== null && typeof (value as { milliseconds?: unknown }).milliseconds === 'number'
					? { value: Object.freeze({ milliseconds: (value as { milliseconds: number }).milliseconds }) }
					: { issues: [{ message: 'Expected timeout data.' }] };
			},
		},
	} satisfies StandardSchemaV1<unknown, Readonly<{ milliseconds: number }>>,
});

const Failures = failure.catalog('capture', { Timeout });

describe('failure', () => {
	it('creates occurrences with exact definition identity', async () => {
		const occurrence = await failure.create(Timeout, { data: { milliseconds: 50 }, cause: new Error('socket') });
		expect(failure.is(occurrence, Timeout)).toBe(true);
		expect(occurrence.data?.milliseconds).toBe(50);
	});

	it('round-trips durable data without serializing the cause', async () => {
		const occurrence = await failure.create(Timeout, { data: { milliseconds: 50 }, cause: new Error('socket') });
		const encoded = await failure.encode(occurrence);
		expect('cause' in encoded).toBe(false);
		const decoded = await failure.decode(encoded, Failures);
		expect(decoded.definition).toBe(Timeout);
		expect(decoded.data).toEqual({ milliseconds: 50 });
	});


	it('rejects structural impostors that were not created by the failure module', () => {
		const impostor = Object.assign(new Error('forged'), {
			definition: Timeout,
			data: Object.freeze({ milliseconds: 50 }),
		});
		expect(failure.isOccurrence(impostor)).toBe(false);
		expect(failure.is(impostor, Timeout)).toBe(false);
	});

	it('rejects accessor-backed encoded input without invoking accessors', async () => {
		let reads = 0;
		const encoded = Object.create(null) as Record<string, unknown>;
		Object.defineProperty(encoded, 'id', {
			enumerable: true,
			get() {
				reads += 1;
				return Timeout.id;
			},
		});
		Object.defineProperty(encoded, 'message', { enumerable: true, value: 'timeout' });
		Object.defineProperty(encoded, 'data', { enumerable: true, value: { milliseconds: 50 } });

		await expect(failure.decode(encoded, Failures)).rejects.toThrow(TypeError);
		expect(reads).toBe(0);
	});

	it('rejects invalid data and unknown durable failure IDs', async () => {
		await expect(failure.create(Timeout, { data: { milliseconds: 'bad' } })).rejects.toThrow();
		await expect(failure.decode({ id: 'unknown', message: 'no', data: {} }, Failures)).rejects.toBeInstanceOf(
			failure.UnknownFailureDefinitionError,
		);
	});
});

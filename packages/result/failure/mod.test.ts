import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import * as schema from '@okikio/schema';
import * as codec from '@okikio/schema/codec';

import * as failure from './mod.ts';

const Timeout = failure.define({
	id: 'capture.timeout',
	description: 'Capture exceeded its deadline.',
	data: schema.object({ milliseconds: schema.number({ minimum: 0 }) }),
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

	it('round trips transformed data through its explicit inverse without decoding output twice', async () => {
		const Timed = failure.define({
			id: 'capture.at',
			description: 'Capture timestamp.',
			data: codec.define({
				decode: schema.transform(schema.string(), (value) => new Date(value)),
				encode: schema.transform(schema.date(), (value) => value.toISOString()),
			}),
		});
		const occurrence = await failure.create(Timed, { data: '2026-01-01T00:00:00.000Z' });
		expect(occurrence.data).toBeInstanceOf(Date);
		const encoded = await failure.encode(occurrence);
		expect(encoded.data).toBe('2026-01-01T00:00:00.000Z');
		expect((await failure.decode(encoded, [Timed])).data).toEqual(occurrence.data);
	});

	it('rejects serialization of a transform without an authored inverse', async () => {
		const Transformed = failure.define({
			id: 'capture.transformed',
			description: 'Transform.',
			data: schema.transform(schema.string(), (value) => value.length),
		});
		const occurrence = await failure.create(Transformed, { data: 'abc' });
		await expect(failure.encode(occurrence)).rejects.toThrow('explicit codec encoder');
	});

	it('uses only own data handlers for prototype-shaped failure IDs', async () => {
		const Constructor = failure.define({
			id: 'constructor',
			description: 'Constructor-shaped ID.',
			data: schema.number(),
		});
		const occurrence = await failure.create(Constructor, { data: 3 });
		expect(failure.match(occurrence, {}, () => 'fallback')).toBe('fallback');
		let reads = 0;
		const cases = Object.defineProperty({}, 'constructor', {
			get() {
				reads++;
				return () => 'wrong';
			},
		});
		expect(() => failure.match(occurrence, cases, () => 'fallback')).toThrow();
		expect(reads).toBe(0);
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

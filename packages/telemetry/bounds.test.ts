import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as telemetry from './mod.ts';

describe('bounded telemetry retention and projection', () => {
	it('evicts whole oldest correlations, then oldest records, and counts exact drops', async () => {
		const output = telemetry.memory();
		const buffer = telemetry.buffer(output, { maximumKeys: 2, maximumRecords: 3, capacity: 2 });
		const emit = (key: string, index: number) =>
			buffer.report(telemetry.event({ name: 'test.event', fields: { request_id: key, index } }));
		await emit('a', 1);
		await emit('a', 2);
		await emit('b', 3);
		await emit('b', 4);
		expect(buffer.stats()).toEqual({ keys: 2, records: 3, dropped: 1 });
		await emit('c', 5);
		expect(buffer.keys).toEqual(['b', 'c']);
		expect(buffer.stats()).toEqual({ keys: 2, records: 3, dropped: 2 });
		await buffer.flush();
		expect(output.records.map((event) => event.fields.index)).toEqual([3, 4, 5]);
		expect(buffer.stats()).toEqual({ keys: 0, records: 0, dropped: 2 });
	});
	it('bounds repeated event identity and high-cardinality retention; discard does not count as overflow', async () => {
		const buffer = telemetry.buffer(telemetry.noop, { maximumKeys: 4, maximumRecords: 7, capacity: 3 });
		const same = telemetry.event({ name: 'test.event' });
		await buffer.report(same);
		await buffer.report(same);
		expect(buffer.stats().records).toBe(2);
		buffer.discard();
		for (let index = 0; index < 1000; index++) {
			await buffer.report(telemetry.event({ name: 'test.event', fields: { request_id: String(index) } }));
			expect(buffer.stats().keys).toBeLessThanOrEqual(4);
			expect(buffer.stats().records).toBeLessThanOrEqual(7);
		}
		expect(buffer.stats().dropped).toBe(996);
	});
	it('permits failure delivery with zero retention and rejects invalid bounds', async () => {
		const output = telemetry.memory();
		const buffer = telemetry.buffer(output, { maximumKeys: 0, maximumRecords: 0 });
		await buffer.report(telemetry.event({ name: 'test.debug', level: 'debug' }));
		await buffer.report(telemetry.event({ name: 'test.failure', level: 'error' }));
		expect(buffer.stats()).toEqual({ keys: 0, records: 0, dropped: 1 });
		expect(output.records.length).toBe(1);
		for (const maximumKeys of [-1, NaN, Infinity, .5]) {
			expect(() => telemetry.buffer(output, { maximumKeys, maximumRecords: 1 })).toThrow(TypeError);
		}
	});
	it('bounds alias expansion and rejects cycles without invoking accessors', () => {
		const cycle: Record<string, telemetry.Value> = {};
		cycle.self = cycle;
		expect(() => telemetry.event({ name: 'test.event', fields: cycle })).toThrow(TypeError);
		expect(() =>
			telemetry.event({ name: 'test.event', fields: { text: '12345' } }, {}, () => 'now', { maximumStringCodeUnits: 8 })
		).toThrow(RangeError);
		const shared = { value: 1 };
		expect(() =>
			telemetry.event({ name: 'test.event', fields: { a: shared, b: shared } }, {}, () => 'now', { maximumNodes: 4 })
		).toThrow(RangeError);
		let read = false;
		const unsafe = Object.defineProperty({}, 'secret', {
			enumerable: true,
			get() {
				read = true;
				return 'secret';
			},
		});
		expect(() => telemetry.create(telemetry.noop, { fields: unsafe })).toThrow(TypeError);
		expect(read).toBe(false);
	});
});

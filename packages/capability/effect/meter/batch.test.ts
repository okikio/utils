import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as context from '@okikio/context';
import * as effects from '../mod.ts';
import * as meter from './mod.ts';

describe('bounded meter batch acceptance', () => {
	it('preflights count, bytes, schema and units before any sink acceptance and closes iterators', async () => {
		await using owner = context.create({ id: 'preflight' });
		const Bytes = meter.define({ id: 'bytes', unit: 'byte' });
		let emitted = 0;
		const ctx = effects.scope(owner, {
			effects: [meter.effect(Bytes)],
			emitter: {
				async emit() {
					emitted++;
				},
			},
		});
		const good = { key: 'asset', value: 1, unit: 'byte' };
		for (const readings of [[good, { ...good, unit: 'second' }], [good, { ...good, value: NaN }], [good, good, good]]) {
			await expect(meter.recordBatch(ctx, Bytes, readings, { maximumItems: 2, maximumBytes: 10000 })).rejects.toThrow();
		}
		let closed = false;
		function* source() {
			try {
				yield good;
				yield good;
			} finally {
				closed = true;
			}
		}
		await expect(meter.recordBatch(ctx, Bytes, source(), { maximumItems: 1, maximumBytes: 10000 })).rejects.toThrow();
		await expect(meter.recordBatch(ctx, Bytes, [good], { maximumItems: 1, maximumBytes: 1 })).rejects.toThrow();
		expect(closed).toBe(true);
		expect(emitted).toBe(0);
	});
	it('retains exact accepted identities and duplicate keys in order; sink owns deduplication', async () => {
		await using owner = context.create({ id: 'accepted' });
		const Bytes = meter.define({ id: 'bytes' });
		const accepted: effects.EffectOccurrence[] = [];
		const ctx = effects.scope(owner, {
			effects: [meter.effect(Bytes)],
			emitter: {
				async emit(_ctx, occurrence) {
					accepted.push(occurrence);
				},
			},
		});
		const result = await meter.recordBatch(ctx, Bytes, [{ key: 'same', value: 1 }, { key: 'same', value: 1 }], {
			maximumItems: 2,
			maximumBytes: 10000,
		});
		expect(result.status).toBe('accepted');
		expect(result.accepted[0]).toBe(accepted[0]);
		expect(result.accepted[1]).toBe(accepted[1]);
		expect(accepted.map((item) => item.key)).toEqual(['same', 'same']);
		expect(Object.isFrozen(result.accepted)).toBe(true);
	});
	it('returns the accepted prefix and exact sink failure, without sending later facts', async () => {
		await using owner = context.create({ id: 'partial' });
		const Count = meter.define({ id: 'count' });
		let calls = 0;
		const ctx = effects.scope(owner, {
			effects: [meter.effect(Count)],
			emitter: {
				async emit() {
					if (++calls === 2) throw undefined;
				},
			},
		});
		const result = await meter.recordBatch(ctx, Count, [1, 2, 3].map((value) => ({ key: String(value), value })), {
			maximumItems: 3,
			maximumBytes: 10000,
		});
		expect(result).toMatchObject({ status: 'partial', rejectedIndex: 1, error: undefined });
		expect(result.accepted.length).toBe(1);
		expect(calls).toBe(2);
	});
});

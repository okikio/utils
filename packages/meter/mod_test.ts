import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import * as context from '@okikio/context';
import * as effects from '@okikio/effect';
import * as meter from './mod.ts';

function base(id: string) {
	return context.create({ id });
}

describe('@okikio/meter', () => {
	it('defines stable metadata and exposes one exact measurement effect', () => {
		const Bytes = meter.define({ id: 'bytes', description: 'Transferred bytes.', unit: 'byte', aggregation: 'sum' });
		expect(Bytes.kind).toBe('meter');
		expect(meter.effect(Bytes)).toBe(Bytes.effect);
		expect(Bytes.effect.id).toBe('meter:bytes');
	});

	it('records one timestamped fact through the required effect owner', async () => {
		await using owned = base('meter-record');
		const Bytes = meter.define({ id: 'bytes', unit: 'byte' });
		let accepted: effects.EffectOccurrence | undefined;
		const ctx = effects.scope(owned, {
			effects: [meter.effect(Bytes)],
			emitter: { async emit(_ctx, occurrence) { accepted = occurrence; } },
		});

		const occurrence = await meter.record(ctx, Bytes, 42, { key: 'asset:42', attributes: { source: 'test' } });
		expect(occurrence).toBe(accepted);
		expect(meter.MeterReadingSchema.safeParse(occurrence.value).success).toBe(true);
		expect(occurrence.value).toMatchObject({ value: 42, attributes: { source: 'test' } });
	});
});

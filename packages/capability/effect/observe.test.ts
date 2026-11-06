import * as codecs from '@okikio/schema/codec';
import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as context from '@okikio/context';
import * as schema from '@okikio/schema';
import * as effect from './mod.ts';

const Rows = effect.define({
	id: 'import.rows',
	value: codecs.identity(schema.define((value: unknown) => {
		if (typeof value !== 'number') throw new TypeError('Expected rows.');
		return value;
	})),
});

describe('accepted effect observations', () => {
	it('publishes only accepted occurrences and rejects refused delivery', async () => {
		await using ctx = context.create({ id: 'reports' });
		const refused = new Error('recipient refused');
		using reports = effect.observe({
			emitter: {
				async emit() {
					throw refused;
				},
			},
		});
		const seen: unknown[] = [];
		using _listener = reports.events.subscribe((value) => seen.push(value));
		await expect(reports.emit(ctx, await effect.create(Rows, 1, { key: 'batch:1' }))).rejects.toBe(refused);
		expect(reports.latest).toBeUndefined();
		expect(seen).toEqual([]);
	});
	it('keeps the latest report when an earlier acceptance finishes late', async () => {
		await using ctx = context.create({ id: 'reports' });
		const release = Promise.withResolvers<void>();
		using reports = effect.observe({
			emitter: {
				async emit(_ctx, occurrence) {
					if (occurrence.value === 1) await release.promise;
				},
			},
		});
		const first = reports.emit(ctx, await effect.create(Rows, 1, { key: 'batch:1' }));
		await reports.emit(ctx, await effect.create(Rows, 2, { key: 'batch:2' }));
		release.resolve();
		await first;
		expect(reports.latest?.value).toBe(2);
	});
	it('delivers the pending snapshot before completion and reports rejected callbacks', async () => {
		await using ctx = context.create({ id: 'reports' });
		const errors: unknown[] = [];
		using reports = effect.observe({
			onError: (error) => {
				errors.push(error);
			},
		});
		let completed = false;
		using _listener = reports.events.subscribe({
			async next() {
				throw new Error('view failed');
			},
			complete() {
				completed = true;
			},
		});
		await reports.emit(ctx, await effect.create(Rows, 1, { key: 'batch:1' }));
		reports.close();
		await Promise.resolve();
		expect(completed).toBe(true);
		expect(errors.length).toBe(1);
		await expect(reports.emit(ctx, await effect.create(Rows, 2, { key: 'batch:2' }))).rejects.toThrow('closed');
	});
});

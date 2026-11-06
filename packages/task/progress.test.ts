import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as schema from '@okikio/schema';
import * as effect from '@okikio/capability/effect';
import * as task from './mod.ts';

const Progress = effect.define({
	id: 'import.progress',
	value: schema.number({ integer: true, minimum: 0 }),
});
const Charged = effect.define({ id: 'credits.charged', value: Progress.value });

describe('effect progress for local tasks', () => {
	it('publishes an owned immutable progress snapshot and preserves its wire representation', async () => {
		const supplied = { completed: 1, total: 2, data: { pages: ['first'] } };
		const parsed = task.ProgressSchema.parse(supplied);
		expect(Object.isFrozen(parsed)).toBe(true);
		expect(Reflect.set(parsed, 'completed', 99)).toBe(false);
		expect(Object.isFrozen(supplied)).toBe(false);
		supplied.data.pages.push('second');
		expect(parsed.data).toEqual({ pages: ['first'] });
		const occurrence = await effect.create(task.ProgressEffect, parsed, { key: 'latest' });
		const encoded = await effect.encode(occurrence);
		expect(encoded.value).toEqual(parsed);
	});
	it('validates reports, routes business effects, and isolates observer failures from the result', async () => {
		const seen: unknown[] = [], errors: unknown[] = [], charges: unknown[] = [];
		const entered = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		let completed = false;
		await using work = task.start(async (ctx) => {
			entered.resolve();
			await release.promise;
			await expect(effect.emit(ctx, Progress, -1, { key: 'bad' })).rejects.toBeInstanceOf(TypeError);
			await effect.emit(ctx, Progress, 200, { key: 'batch:1' });
			await effect.emit(ctx, Charged, 2, { key: 'credits:1' });
			await effect.emit(ctx, Progress, 400, { key: 'batch:2' });
			return 400;
		}, {
			progress: Progress,
			effects: [Charged],
			emitter: {
				async emit(_ctx, value) {
					charges.push(value.value);
				},
			},
			onError: (error) => {
				errors.push(error);
			},
		});
		await entered.promise;
		using _listener = work.updates.subscribe({
			next: (value) => seen.push(value.value),
			complete() {
				completed = true;
			},
		});
		using _broken = work.updates.subscribe(() => {
			throw new Error('screen failed');
		});
		release.resolve();
		expect(await work.done).toBe(400);
		await Promise.resolve();
		expect(seen.at(-1)).toBe(400);
		expect(work.progress?.value).toBe(400);
		expect(charges).toEqual([2]);
		expect(errors.length).toBeGreaterThan(0);
		expect(completed).toBe(true);
	});
	it('requires an owner for non-progress effects', async () => {
		await using work = task.start((ctx) => effect.emit(ctx, Charged, 1, { key: 'credits' }), { effects: [Charged] });
		await expect(work.done).rejects.toBeInstanceOf(effect.MissingEffectEmitterError);
	});
});

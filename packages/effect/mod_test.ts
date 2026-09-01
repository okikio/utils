import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import type { Context } from '@okikio/context';
import * as context from '@okikio/context';
import * as queue from '@okikio/queue';
import * as effect from './mod.ts';
function baseContext(id: string): Context {
	return Object.freeze({
		id,
		startedAt: Object.freeze({}) as Temporal.Instant,
		signal: new AbortController().signal,
		clock: Object.freeze({ now: () => Object.freeze({}) as Temporal.Instant }),
	});
}

const RouteSchema = Object.freeze({
	'~standard': Object.freeze({
		version: 1 as const,
		vendor: 'utility-test',
		validate(value: unknown) {
			if (typeof value !== 'object' || value === null || typeof (value as { routeId?: unknown }).routeId !== 'string') {
				return { issues: [{ message: 'Expected routeId.' }] };
			}
			return { value: Object.freeze({ routeId: (value as { routeId: string }).routeId }) };
		},
	}),
});

const RouteCommitted = effect.define({
	id: 'capture.route-committed',
	description: 'A route unit became authoritative.',
	value: RouteSchema,
});

const CaptureFinalized = effect.define({
	id: 'capture.finalized',
	value: RouteSchema,
});

describe('@okikio/effect', () => {
	it('creates a validated immutable occurrence without delivery', async () => {
		const occurrence = await effect.create(RouteCommitted, { routeId: 'route-7' }, { key: 'generation-2:route-7' });
		expect(occurrence).toMatchObject({
			kind: 'effect-occurrence',
			definition: RouteCommitted,
			key: 'generation-2:route-7',
			value: { routeId: 'route-7' },
		});
		expect(Object.isFrozen(occurrence)).toBe(true);
	});

	it('emits an existing occurrence and resolves only after the owner accepts it', async () => {
		const base = baseContext('capture-job');
		const accepted: effect.EffectOccurrence[] = [];
		const ctx = effect.scope(base, {
			effects: [RouteCommitted],
			emitter: {
				async emit(_ctx, occurrence) {
					accepted.push(occurrence);
				},
			},
		});
		const occurrence = await effect.create(RouteCommitted, { routeId: 'route-8' }, { key: 'generation-2:route-8' });
		const returned = await effect.emit(ctx, occurrence);
		expect(returned).toBe(occurrence);
		expect(accepted).toEqual([occurrence]);
	});

	it('supports create-and-emit convenience without changing occurrence identity', async () => {
		const base = baseContext('capture-job');
		let accepted: effect.EffectOccurrence | undefined;
		const ctx = effect.scope(base, {
			effects: [RouteCommitted],
			emitter: {
				async emit(_ctx, occurrence) {
					accepted = occurrence;
				},
			},
		});
		const occurrence = await effect.emit(ctx, RouteCommitted, { routeId: 'route-9' }, { key: 'generation-2:route-9' });
		expect(accepted).toBe(occurrence);
	});

	it('fails closed for undeclared or unconfigured effects before delivery', async () => {
		const base = baseContext('capture-job');
		const configured = effect.scope(base, {
			effects: [RouteCommitted],
			emitter: { async emit() {} },
		});
		await expect(effect.emit(configured, CaptureFinalized, { routeId: 'route-1' }, { key: 'capture' }))
			.rejects.toBeInstanceOf(effect.UndeclaredEffectError);
		await expect(effect.emit(configured, CaptureFinalized, {} as never, { key: 'capture-invalid' }))
			.rejects.toBeInstanceOf(effect.UndeclaredEffectError);

		const missing = effect.scope(base, { effects: [RouteCommitted] });
		await expect(effect.emit(missing, RouteCommitted, { routeId: 'route-1' }, { key: 'route-1' }))
			.rejects.toBeInstanceOf(effect.MissingEffectEmitterError);
	});

	it('encodes and decodes through trusted definitions', async () => {
		const occurrence = await effect.create(RouteCommitted, { routeId: 'route-10' }, { key: 'generation-2:route-10' });
		const encoded = await effect.encode(occurrence);
		expect(encoded).toEqual({
			id: 'capture.route-committed',
			key: 'generation-2:route-10',
			value: { routeId: 'route-10' },
		});
		const decoded = await effect.decode(encoded, [RouteCommitted]);
		expect(decoded.definition).toBe(RouteCommitted);
		expect(decoded.key).toBe(occurrence.key);
		expect(decoded.value).toEqual(occurrence.value);
	});

	it('does not revoke an effect that was accepted before producer cancellation', async () => {
		const controller = new AbortController();
		const base = Object.freeze({ ...baseContext('capture-accepted'), signal: controller.signal });
		const ctx = effect.scope(base, {
			effects: [RouteCommitted],
			emitter: {
				async emit() {
					controller.abort('producer cancelled after acceptance');
				},
			},
		});

		const occurrence = await effect.emit(
			ctx,
			RouteCommitted,
			{ routeId: 'route-accepted' },
			{ key: 'route-accepted' },
		);
		expect(occurrence).toMatchObject({ key: 'route-accepted' });
	});

	it('does not deliver an effect after execution cancellation', async () => {
		const controller = new AbortController();
		controller.abort('capture cancelled');
		const base = Object.freeze({ ...baseContext('capture-cancelled'), signal: controller.signal });
		let calls = 0;
		const ctx = effect.scope(base, {
			effects: [RouteCommitted],
			emitter: {
				async emit() {
					calls++;
				},
			},
		});

		await expect(effect.emit(ctx, RouteCommitted, { routeId: 'route-12' }, { key: 'route-12' }))
			.rejects.toMatchObject({ name: 'ContextCancelledError' });
		expect(calls).toBe(0);
	});

	it('propagates owner rejection instead of treating it as acceptance', async () => {
		const base = baseContext('capture-job');
		const failure = new Error('outbox unavailable');
		const ctx = effect.scope(base, {
			effects: [RouteCommitted],
			emitter: {
				async emit() {
					throw failure;
				},
			},
		});
		await expect(effect.emit(ctx, RouteCommitted, { routeId: 'route-11' }, { key: 'route-11' })).rejects.toBe(failure);
	});

	it('rejects structural effect-occurrence impostors', async () => {
		const occurrence = await effect.create(RouteCommitted, { routeId: 'real' }, { key: 'real' });
		const impostor = Object.freeze({ ...occurrence });
		expect(effect.isOccurrence(occurrence)).toBe(true);
		expect(effect.isOccurrence(impostor)).toBe(false);
	});

	it('rejects accessor-backed encoded effects without invoking accessors', async () => {
		let reads = 0;
		const encoded = Object.create(null) as Record<string, unknown>;
		Object.defineProperty(encoded, 'id', { enumerable: true, get() { reads += 1; return RouteCommitted.id; } });
		Object.defineProperty(encoded, 'key', { enumerable: true, value: 'route-accessor' });
		Object.defineProperty(encoded, 'value', { enumerable: true, value: { routeId: 'accessor' } });
		await expect(effect.decode(encoded, [RouteCommitted])).rejects.toThrow(TypeError);
		expect(reads).toBe(0);
	});

});

describe('@okikio/effect handlers and outbox', () => {
	it('runs one exact direct handler and rejects duplicate authority', async () => {
		await using ctx = context.create({ id: 'effect-direct', clock: new context.TestClock() });
		const accepted: string[] = [];
		const handler = effect.implement(RouteCommitted, (_ctx, occurrence) => { accepted.push(occurrence.key); });
		const emitter = effect.emitter(handler);
		const occurrence = await effect.create(RouteCommitted, { routeId: 'direct' }, { key: 'route-direct' });
		await emitter.emit(ctx, occurrence);
		expect(accepted).toEqual(['route-direct']);
		expect(() => effect.emitter(handler, handler)).toThrow(effect.DuplicateEffectHandlerError);
	});

	it('accepts producer ownership at idempotent outbox admission and handles one logical effect once', async () => {
		const clock = new context.TestClock();
		await using ctx = context.create({ id: 'effect-producer-attempt-2', idempotencyKey: 'capture-job', clock });
		await using jobs = queue.memory<effect.EffectEncoded, effect.EffectReceiptType>({ clock });
		const handled: string[] = [];
		await using box = effect.outbox({
			queue: jobs,
			handlers: [effect.implement(RouteCommitted, (_ctx, occurrence) => { handled.push(occurrence.key); })],
		});
		const occurrence = await effect.create(RouteCommitted, { routeId: 'route-20' }, { key: 'generation-2:route-20' });

		await box.emit(ctx, occurrence);
		// Simulate a lost producer acknowledgement by admitting the same logical
		// occurrence again with a new activity attempt but the same idempotency key.
		await box.emit(ctx, occurrence);
		expect((await jobs.stats()).queued).toBe(1);

		expect(await box.drain(ctx, { owner: 'effect-worker', limit: 8 })).toEqual({
			claimed: 1,
			accepted: 1,
			retried: 0,
			failed: 0,
		});
		expect(handled).toEqual(['generation-2:route-20']);
		expect((await jobs.stats()).completed).toBe(1);
	});

	it('retries handler faults under the same logical queue item and attempt sequence', async () => {
		const clock = new context.TestClock();
		await using ctx = context.create({ id: 'effect-retry', idempotencyKey: 'capture-retry', clock });
		await using jobs = queue.memory<effect.EffectEncoded, effect.EffectReceiptType>({ clock });
		let calls = 0;
		await using box = effect.outbox({
			queue: jobs,
			maximumAttempts: 2,
			retryDelay: { milliseconds: 0 },
			handlers: [effect.implement(RouteCommitted, () => {
				if (calls++ === 0) throw new Error('temporary sink failure');
			})],
		});
		await box.emit(ctx, await effect.create(RouteCommitted, { routeId: 'retry' }, { key: 'route-retry' }));

		expect(await box.drain(ctx)).toMatchObject({ claimed: 1, accepted: 0, retried: 1, failed: 0 });
		expect(await box.drain(ctx)).toMatchObject({ claimed: 1, accepted: 1, retried: 0, failed: 0 });
		expect(calls).toBe(2);
	});
});

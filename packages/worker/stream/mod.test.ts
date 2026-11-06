import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as context from '@okikio/context';
import * as stream from './mod.ts';
import { header } from './wire.ts';

const policy = { maximumChunkBytes: 16, maximumChunks: 8, maximumBytes: 64 };
const options = { ...policy, id: 'fixture', timeout: 1000 };
/** Await a real native frame without replacing MessagePort dispatch with direct callbacks. */
function frame(port: MessagePort): Promise<Record<string, unknown>> {
	return new Promise((resolve) => port.addEventListener('message', (event) => resolve(event.data), { once: true }));
}

describe('versioned dedicated-port byte streaming', () => {
	it('starts lazily and applies one downstream credit per producer read through native piping', async () => {
		await using ctx = context.create({ id: 'stream' });
		const channel = new MessageChannel();
		let starts = 0, reads = 0, cleanup = 0;
		await using _producer = stream.serve(ctx, channel.port1, async function* (owner) {
			starts++;
			owner.defer(() => {
				cleanup++;
			});
			for (const value of [1, 2, 3]) {
				reads++;
				yield Uint8Array.of(value);
			}
		}, policy);
		await using receiver = stream.open(ctx, channel.port2, options);
		const native: string[] = [], observable: string[] = [];
		receiver.target.addEventListener(
			'state',
			(event) => native.push((event as CustomEvent<stream.EventType>).detail.type),
		);
		using _subscription = receiver.events.subscribe((event) => observable.push(event.type));
		await receiver.ready;
		expect([starts, reads, cleanup]).toEqual([0, 0, 0]);
		const gate = Promise.withResolvers<void>(), first = Promise.withResolvers<void>();
		const values: number[] = [];
		const pipe = receiver.readable.pipeTo(
			new WritableStream<Uint8Array>({
				async write(value) {
					values.push(value[0]!);
					if (values.length === 1) {
						first.resolve();
						await gate.promise;
					}
				},
			}),
		);
		await first.promise;
		expect(reads).toBe(1);
		gate.resolve();
		await pipe;
		expect(values).toEqual([1, 2, 3]);
		expect(await receiver.closed).toMatchObject({ status: 'complete', chunks: 3, bytes: 3 });
		expect((await _producer.closed).status).toBe('complete');
		expect(cleanup).toBe(1);
		expect(native).toEqual(observable);
		expect(native).toEqual(['ready', 'chunk', 'chunk', 'chunk', 'complete']);
	});
	it('joins iterator and Context cleanup before sending a cancellation receipt', async () => {
		await using ctx = context.create({ id: 'cancel' });
		const { port1, port2 } = new MessageChannel();
		const cleaning = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
		let cleaned = false;
		await using _producer = stream.serve(ctx, port1, async function* (owner) {
			owner.defer(async () => {
				cleaning.resolve();
				await release.promise;
				cleaned = true;
			});
			yield Uint8Array.of(1);
			yield Uint8Array.of(2);
		}, policy);
		await using receiver = stream.open(ctx, port2, options);
		const reader = receiver.readable.getReader();
		await reader.read();
		const reason = { cancelled: true };
		const cancellation = reader.cancel(reason);
		await cleaning.promise;
		let finished = false;
		void receiver.closed.then(() => {
			finished = true;
		});
		await Promise.resolve();
		expect(finished).toBe(false);
		release.resolve();
		await cancellation;
		expect(cleaned).toBe(true);
		expect((await receiver.closed).reason).toBe(reason);
		expect((await receiver.closed).status).toBe('cancelled');
	});
	it('reports remote cleanup faults after cancellation while preserving the exact local reason', async () => {
		for (const phase of ['iterator', 'context'] as const) {
			await using ctx = context.create({ id: phase });
			const { port1, port2 } = new MessageChannel();
			const cleanup = { secret: phase }, reason = { stop: phase };
			await using producer = stream.serve(ctx, port1, (owner) => {
				if (phase === 'context') {
					owner.defer(() => {
						throw cleanup;
					});
				}
				return {
					[Symbol.asyncIterator]() {
						return {
							next: async () => ({ done: false as const, value: Uint8Array.of(1) }),
							return: async () => {
								if (phase === 'iterator') throw cleanup;
								return { done: true as const, value: undefined };
							},
						};
					},
				};
			}, policy);
			await using receiver = stream.open(ctx, port2, options);
			const reader = receiver.readable.getReader();
			await reader.read();
			await reader.cancel(reason);
			expect((await receiver.closed).status).toBe('fault');
			expect((await receiver.closed).reason).toBe(reason);
			expect((await producer.closed).status).toBe('fault');
			if (phase === 'iterator') expect((await producer.closed).reason).toBe(cleanup);
		}
	});
	it('reports unconfirmed when cancellation cannot join a pending source, then permits real cleanup to finish', async () => {
		const clock = new context.TestClock();
		await using ctx = context.create({ id: 'pending', clock });
		const { port1, port2 } = new MessageChannel();
		const started = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
		await using _producer = stream.serve(ctx, port1, async function* () {
			started.resolve();
			await release.promise;
			yield Uint8Array.of(1);
		}, policy);
		await using receiver = stream.open(ctx, port2, { ...options, timeout: 25 });
		const read = receiver.readable.getReader().read().catch((error: unknown) => error);
		await started.promise;
		const cancellation = receiver.cancel('stop');
		clock.advance({ milliseconds: 25 });
		expect((await cancellation).status).toBe('unconfirmed');
		expect(await read).toBe('stop');
		let joined = false;
		void _producer.closed.then(() => {
			joined = true;
		});
		await Promise.resolve();
		expect(joined).toBe(false);
		release.resolve();
		expect((await _producer.closed).status).toBe('cancelled');
	});
	it('negotiates the minimum limits and rejects oversized, shared and excessive source chunks', async () => {
		for (const mode of ['chunk', 'count', 'total', 'shared'] as const) {
			await using ctx = context.create({ id: mode });
			const { port1, port2 } = new MessageChannel();
			const local = {
				maximumChunkBytes: 2,
				maximumChunks: mode === 'count' ? 1 : 8,
				maximumBytes: mode === 'total' ? 1 : 64,
			};
			await using _producer = stream.serve(ctx, port1, async function* () {
				yield mode === 'chunk'
					? new Uint8Array(3)
					: mode === 'shared'
					? new Uint8Array(new SharedArrayBuffer(1))
					: Uint8Array.of(1);
				yield Uint8Array.of(2);
			}, local);
			await using receiver = stream.open(ctx, port2, options);
			await expect(Array.fromAsync(receiver.readable)).rejects.toBeInstanceOf(stream.StreamProtocolError);
			expect((await _producer.closed).status).toBe('fault');
			expect((await receiver.closed).status).toBe('fault');
		}
	});
	it('does not detach caller buffers and counts empty chunks as real sequenced frames', async () => {
		await using ctx = context.create({ id: 'ownership' });
		const { port1, port2 } = new MessageChannel();
		const original = Uint8Array.of(4, 5);
		await using _producer = stream.serve(ctx, port1, async function* () {
			yield original;
			yield new Uint8Array(0);
		}, policy);
		await using receiver = stream.open(ctx, port2, options);
		expect((await Array.fromAsync(receiver.readable)).map((value) => [...value])).toEqual([[4, 5], []]);
		expect([...original]).toEqual([4, 5]);
		expect(await receiver.closed).toMatchObject({ chunks: 2, bytes: 2 });
	});
	it('preserves producer work and cleanup faults locally and redacts remote details', async () => {
		await using ctx = context.create({ id: 'fault' });
		const { port1, port2 } = new MessageChannel();
		const work = { secret: 'work' }, cleanup = { secret: 'cleanup' };
		await using _producer = stream.serve(ctx, port1, (owner) => {
			owner.defer(() => {
				throw cleanup;
			});
			return {
				[Symbol.asyncIterator]() {
					return { next: () => Promise.reject(work) };
				},
			};
		}, policy);
		await using receiver = stream.open(ctx, port2, options);
		await expect(receiver.readable.getReader().read()).rejects.toBeInstanceOf(stream.StreamProtocolError);
		const outcome = await _producer.closed;
		expect(outcome.reason).toBeInstanceOf(AggregateError);
		expect((outcome.reason as AggregateError).errors).toEqual([work, cleanup]);
		expect((await receiver.closed).reason).not.toBe(outcome.reason);
	});
	it('rejects out-of-order/uncredited frames and records cleanup confirmation independently', async () => {
		for (const kind of ['sequence', 'version', 'identity', 'unsolicited'] as const) {
			await using ctx = context.create({ id: kind });
			const { port1, port2 } = new MessageChannel();
			port1.start();
			const opening = frame(port1);
			await using receiver = stream.open(ctx, port2, options);
			await opening;
			port1.postMessage({ ...header(options.id), kind: 'ready', ...policy });
			await receiver.ready;
			const cancellation = frame(port1);
			port1.postMessage({
				...header(kind === 'identity' ? 'other' : options.id),
				version: kind === 'version' ? 2 : 1,
				kind: 'chunk',
				sequence: kind === 'sequence' ? 3 : 0,
				bytes: Uint8Array.of(1),
			});
			expect((await cancellation).kind).toBe('cancel');
			port1.postMessage({ ...header(options.id), kind: 'end', sequence: 0, status: 'cancelled' });
			expect((await receiver.closed).status).toBe('fault');
			port1.close();
		}
	});
	it('rejects duplicate credits without reading or queuing another source item', async () => {
		await using ctx = context.create({ id: 'duplicate' });
		const { port1, port2 } = new MessageChannel();
		port2.start();
		const started = Promise.withResolvers<void>(),
			release = Promise.withResolvers<void>(),
			cancelled = Promise.withResolvers<void>();
		let reads = 0;
		await using _producer = stream.serve(ctx, port1, async function* (owner) {
			owner.signal.addEventListener('abort', () => cancelled.resolve(), { once: true });
			reads++;
			started.resolve();
			await release.promise;
			yield Uint8Array.of(1);
		}, policy);
		const ready = frame(port2);
		port2.postMessage({ ...header('fixture'), kind: 'open', ...policy });
		await ready;
		port2.postMessage({ ...header('fixture'), kind: 'pull', sequence: 0 });
		await started.promise;
		port2.postMessage({ ...header('fixture'), kind: 'pull', sequence: 0 });
		// Source cancellation proves duplicate validation ran while next() was still pending.
		await cancelled.promise;
		const ended = frame(port2);
		release.resolve();
		expect((await ended).kind).toBe('end');
		expect(reads).toBe(1);
		expect((await _producer.closed).status).toBe('fault');
		port2.close();
	});
	it('retires silent peers under a bounded handshake and request wait', async () => {
		for (const stage of ['handshake', 'pull'] as const) {
			const clock = new context.TestClock();
			await using ctx = context.create({ id: stage, clock });
			const { port1, port2 } = new MessageChannel();
			port1.start();
			const opening = frame(port1);
			await using receiver = stream.open(ctx, port2, { ...options, timeout: 25 });
			await opening;
			if (stage === 'pull') {
				port1.postMessage({ ...header(options.id), kind: 'ready', ...policy });
				await receiver.ready;
				const requested = frame(port1);
				void receiver.readable.getReader().read().catch(() => {});
				await requested;
			}
			clock.advance({ milliseconds: 25 });
			expect(await receiver.closed).toMatchObject({
				status: 'unconfirmed',
				reason: expect.any(stream.StreamTimeoutError),
			});
			port1.close();
		}
	});
	it('retains exact parent cancellation and releases all Context-clock timers after cooperative cleanup', async () => {
		const clock = new context.TestClock();
		await using ctx = context.create({ id: 'cooperative', clock });
		const { port1, port2 } = new MessageChannel();
		const started = Promise.withResolvers<void>();
		let released = 0;
		await using _producer = stream.serve(ctx, port1, async function* (owner) {
			owner.defer(() => {
				released++;
			});
			started.resolve();
			await new Promise<void>((_resolve, reject) =>
				owner.signal.addEventListener('abort', () => reject(owner.signal.reason), { once: true })
			);
			yield Uint8Array.of(1);
		}, policy);
		await using receiver = stream.open(ctx, port2, options);
		const pending = receiver.readable.getReader().read().catch((error: unknown) => error);
		await started.promise;
		context.cancel(ctx, null);
		expect(await pending).toBe(null);
		expect(await receiver.closed).toMatchObject({ status: 'cancelled', reason: null });
		expect((await _producer.closed).status).toBe('cancelled');
		expect(released).toBe(1);
		expect(clock.pending()).toHaveLength(0);
	});
	it('rejects wrong sequence even with an outstanding valid receive credit', async () => {
		await using ctx = context.create({ id: 'sequence' });
		const { port1, port2 } = new MessageChannel();
		port1.start();
		const opening = frame(port1);
		await using receiver = stream.open(ctx, port2, options);
		await opening;
		port1.postMessage({ ...header(options.id), kind: 'ready', ...policy });
		await receiver.ready;
		const pull = frame(port1);
		const pending = receiver.readable.getReader().read().catch((error: unknown) => error);
		expect((await pull).sequence).toBe(0);
		const cancelled = frame(port1);
		port1.postMessage({ ...header(options.id), kind: 'chunk', sequence: 1, bytes: Uint8Array.of(1) });
		expect((await cancelled).kind).toBe('cancel');
		port1.postMessage({ ...header(options.id), kind: 'end', sequence: 0, status: 'cancelled' });
		expect(await pending).toBeInstanceOf(stream.StreamProtocolError);
		expect((await receiver.closed).status).toBe('fault');
		port1.close();
	});
	it('never starts a producer for an incompatible revision or unknown control field', async () => {
		for (const invalid of [{ version: 2 }, { injected: true }]) {
			await using ctx = context.create({ id: 'incompatible' });
			const { port1, port2 } = new MessageChannel();
			let starts = 0;
			await using _producer = stream.serve(ctx, port1, async function* () {
				starts++;
				yield Uint8Array.of(1);
			}, policy);
			port2.postMessage({ ...header('fixture'), kind: 'open', ...policy, ...invalid });
			expect((await _producer.closed).status).toBe('fault');
			expect(starts).toBe(0);
			port2.close();
		}
	});
	it('settles local retirement failures instead of leaking an unhandled cleanup rejection', async () => {
		await using ctx = context.create({ id: 'retire' });
		const { port1, port2 } = new MessageChannel();
		const failure = new Error('injected close failure');
		let removed = 0;
		const port: stream.Port = {
			postMessage(value: unknown, transfer?: ArrayBuffer[]) {
				port2.postMessage(value, transfer ?? []);
			},
			start() {
				port2.start();
			},
			addEventListener(type, listener) {
				port2.addEventListener(type, listener);
			},
			removeEventListener(type, listener) {
				removed++;
				port2.removeEventListener(type, listener);
			},
			close() {
				port2.close();
				throw failure;
			},
		};
		await using _producer = stream.serve(ctx, port1, async function* () {
			yield Uint8Array.of(1);
		}, policy);
		await using receiver = stream.open(ctx, port, options);
		await expect(Array.fromAsync(receiver.readable)).rejects.toBeInstanceOf(AggregateError);
		const outcome = await receiver.closed;
		expect(outcome.status).toBe('fault');
		expect((outcome.reason as AggregateError).errors).toEqual([failure]);
		expect(removed).toBe(2);
	});
});

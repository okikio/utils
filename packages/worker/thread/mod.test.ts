import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import * as context from '@okikio/context';
import * as worker from './mod.ts';
import { FakeWorker, open, requestId, RequestSchema, ResponseSchema } from './fixtures/protocol.ts';

describe('Worker handle', () => {
	it('shares shutdown with an observer that calls stop during the stopping notification', async () => {
		await using ctx = context.create({ id: 'reentrant-worker-stop' });
		const fake = new FakeWorker();
		fake.onPost = (message) => {
			if ((message as { type: string }).type === 'shutdown') fake.message({ type: 'stopped' });
		};
		const handle = open(fake, ctx);
		let nested: Promise<void> | undefined;
		let notices = 0;
		using _subscription = handle.events.subscribe((event) => {
			if (event.type !== 'stopping') return;
			notices++;
			if (notices === 1) nested = handle.stop('observer');
		});
		const stopping = handle.stop('owner');
		expect(nested).toBe(stopping);
		expect(handle[Symbol.asyncDispose]()).toBe(stopping);
		await stopping;
		expect(notices).toBe(1);
		expect(fake.posted.filter((entry) => (entry.message as { type: string }).type === 'shutdown')).toHaveLength(1);
		expect(fake.terminated).toBe(1);
	});
	it('looks up the optional native constructor only when no factory was supplied', async () => {
		await using ctx = context.create({ id: 'optional-worker-host' });
		const original = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
		let lookups = 0;
		Object.defineProperty(globalThis, 'Worker', {
			configurable: true,
			get() {
				lookups++;
				return undefined;
			},
		});
		try {
			expect(() =>
				worker.open(ctx, {
					module: new URL('file:///thread.ts'),
					protocol: worker.protocol({ request: RequestSchema, response: ResponseSchema }),
				})
			).toThrow('explicit Worker factory');
			expect(lookups).toBe(1);
			const fake = new FakeWorker();
			fake.onPost = (message) => {
				if (typeof message === 'object' && message !== null && 'type' in message && message.type === 'shutdown') {
					queueMicrotask(() => fake.message({ type: 'stopped' }));
				}
			};
			await using handle = open(fake, ctx);
			await handle.stop();
			expect(lookups).toBe(1);
			expect(fake.terminated).toBe(1);
		} finally {
			if (original === undefined) Reflect.deleteProperty(globalThis, 'Worker');
			else Object.defineProperty(globalThis, 'Worker', original);
		}
	});

	it('validates shutdown policy before creating a raw Worker', async () => {
		await using ctx = context.create({ id: 'invalid-policy' });
		let created = 0;
		expect(() =>
			worker.open(ctx, {
				module: new URL('file:///thread.ts'),
				protocol: worker.protocol({ request: RequestSchema, response: ResponseSchema }),
				shutdownMs: -1,
				create: () => {
					created++;
					return new FakeWorker();
				},
			})
		).toThrow(TypeError);
		expect(created).toBe(0);
	});

	it('validates requests and correlated responses', async () => {
		await using ctx = context.create({ id: 'worker-result' });
		const fake = new FakeWorker();
		fake.onPost = (message) => {
			if (typeof message !== 'object' || message === null || !('type' in message) || message.type !== 'request') return;
			queueMicrotask(() => fake.message({ type: 'result', id: requestId(message), response: { upper: 'VALUE' } }));
		};
		await using handle = open(fake, ctx);
		expect(await handle.request(ctx, { value: 'value' })).toEqual({ upper: 'VALUE' });
		await expect(handle.request(ctx, { value: 42 } as never)).rejects.toThrow();
	});

	it('returns expected encoded failures without invalidating the Worker', async () => {
		await using ctx = context.create({ id: 'worker-failure' });
		const fake = new FakeWorker();
		let count = 0;
		fake.onPost = (message) => {
			if (typeof message !== 'object' || message === null || !('type' in message) || message.type !== 'request') return;
			const id = requestId(message);
			queueMicrotask(() => {
				if (count++ === 0) {
					fake.message({
						type: 'failure',
						id,
						failure: { id: 'analysis.rejected', data: { reason: 'invalid' }, message: 'Analysis was rejected.' },
					});
				} else fake.message({ type: 'result', id, response: { upper: 'RECOVERED' } });
			});
		};
		await using handle = open(fake, ctx, 'failure-request');
		await expect(handle.request(ctx, { value: 'bad' })).rejects.toBeInstanceOf(worker.WorkerFailureError);
		expect(await handle.request(ctx, { value: 'good' }, { id: 'recovery-request' })).toEqual({ upper: 'RECOVERED' });
	});

	it('retains cancelled ownership until a terminal cleanup receipt and then permits reuse', async () => {
		await using ownerCtx = context.create({ id: 'worker-owner' });
		const controller = new AbortController();
		await using requestCtx = context.create({ id: 'worker-cancel', signal: controller.signal });
		const fake = new FakeWorker();
		await using handle = open(fake, ownerCtx, 'cancelled-request');
		const pending = handle.request(requestCtx, { value: 'slow' });
		await fake.waitForPosts(1);
		controller.abort('caller stopped waiting');
		fake.message({ type: 'result', id: 'cancelled-request', response: { upper: 'TOO LATE' } });
		await expect(pending).rejects.toBeInstanceOf(context.ContextCancelledError);
		expect(
			fake.posted.some(({ message }) =>
				typeof message === 'object' && message !== null && 'type' in message && message.type === 'cancel'
			),
		).toBe(true);

		fake.onPost = (message) => {
			if (typeof message === 'object' && message !== null && 'type' in message && message.type === 'request') {
				queueMicrotask(() => fake.message({ type: 'result', id: requestId(message), response: { upper: 'NEXT' } }));
			}
		};
		expect(await handle.request(ownerCtx, { value: 'next' }, { id: 'next-request' })).toEqual({ upper: 'NEXT' });
	});

	it('invalidates immediately when a response uses an unknown request ID', async () => {
		await using ctx = context.create({ id: 'worker-protocol' });
		const fake = new FakeWorker();
		await using handle = open(fake, ctx, 'known-request');
		const pending = handle.request(ctx, { value: 'pending' });
		await fake.waitForPosts(1);
		fake.message({ type: 'result', id: 'unknown-request', response: { upper: 'INVALID' } });
		await expect(pending).rejects.toBeInstanceOf(worker.WorkerStoppedError);
		expect(fake.terminated).toBe(1);
		await expect(handle.request(ctx, { value: 'after-fault' }, { id: 'after-fault' })).rejects.toBeInstanceOf(
			worker.WorkerStoppedError,
		);
	});

	it('rejects invalid response data and settles every pending request', async () => {
		await using ctx = context.create({ id: 'worker-invalid-response' });
		const fake = new FakeWorker();
		await using handle = open(fake, ctx, 'invalid-response');
		const pending = handle.request(ctx, { value: 'pending' });
		await fake.waitForPosts(1);
		fake.message({ type: 'result', id: 'invalid-response', response: { upper: 42 } });
		await expect(pending).rejects.toBeInstanceOf(worker.WorkerStoppedError);
		expect(fake.terminated).toBe(1);
	});

	it('uses cooperative shutdown when acknowledged and makes repeated stops harmless', async () => {
		await using ctx = context.create({ id: 'worker-stop' });
		const fake = new FakeWorker();
		fake.onPost = (message) => {
			if (typeof message === 'object' && message !== null && 'type' in message && message.type === 'shutdown') {
				queueMicrotask(() => fake.message({ type: 'stopped' }));
			}
		};
		const handle = open(fake, ctx);
		await Promise.all([handle.stop('shutdown'), handle.stop('shutdown'), handle[Symbol.asyncDispose]()]);
		expect(fake.terminated).toBe(1);
	});
});

import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import * as context from '@okikio/context';
import * as worker from './mod.ts';
import {
	admission,
	admissionContext,
	FakeWorker,
	FakeWorkerScope,
	requestId,
	ResponseSchema,
} from './fixtures/protocol.ts';

describe('Worker admission', () => {
	it('reserves a parent ID while its request schema is waiting', async () => {
		await using ctx = context.create({ id: 'worker-admission' });
		const gate = admission();
		const fake = new FakeWorker();
		fake.onPost = (message) => {
			if (typeof message === 'object' && message !== null && 'type' in message && message.type === 'request') {
				fake.message({ type: 'result', id: requestId(message), response: { upper: 'ONE' } });
			}
		};
		await using handle = worker.open(ctx, {
			module: new URL('file:///admission.ts'),
			create: () => fake,
			shutdownMs: 0,
			protocol: worker.protocol({ request: gate.contract, response: ResponseSchema }),
		});
		// Open validation before transport teardown joins pending admission.
		using _release = { [Symbol.dispose]: () => gate.release.resolve() };
		const first = handle.request(ctx, { value: 'one' }, { id: 'same' });
		// An earlier duplicate-ID assertion can fail before this request is awaited.
		void first.catch(() => {});
		await gate.entered;
		await expect(handle.request(ctx, { value: 'two' }, { id: 'same' })).rejects.toBeInstanceOf(TypeError);
		gate.release.resolve();
		expect(await first).toEqual({ upper: 'ONE' });
		expect(fake.posted).toHaveLength(1);
	});

	it('cancels parent admission without sending an unvalidated request or cancel frame', async () => {
		await using owner = context.create({ id: 'worker-admission' });
		await using ctx = context.child(owner);
		const gate = admission();
		const fake = new FakeWorker();
		await using handle = worker.open(owner, {
			module: new URL('file:///admission.ts'),
			create: () => fake,
			shutdownMs: 0,
			protocol: worker.protocol({ request: gate.contract, response: ResponseSchema }),
		});
		// Open validation before transport teardown joins pending admission.
		using _release = { [Symbol.dispose]: () => gate.release.resolve() };
		const pending = handle.request(ctx, { value: 'one' }, { id: 'cancelled' });
		await gate.entered;
		context.cancel(ctx, 'cancel during validation');
		await expect(pending).rejects.toBeInstanceOf(context.ContextCancelledError);
		expect(fake.posted).toEqual([]);
		// A validator can reject after its caller stops waiting. The transport must
		// consume that rejection and must never send its result later.
		gate.release.reject(new Error('late validator rejection'));
	});

	it('stops parent admission even when a validator does not cooperate', async () => {
		await using ctx = context.create({ id: 'worker-admission' });
		const gate = admission();
		const fake = new FakeWorker();
		await using handle = worker.open(ctx, {
			module: new URL('file:///admission.ts'),
			create: () => fake,
			shutdownMs: 0,
			protocol: worker.protocol({ request: gate.contract, response: ResponseSchema }),
		});
		// Open validation before transport teardown joins pending admission.
		using _release = { [Symbol.dispose]: () => gate.release.resolve() };
		const pending = handle.request(ctx, { value: 'one' });
		await gate.entered;
		const rejection = expect(pending).rejects.toBeInstanceOf(worker.WorkerStoppedError);
		await handle.stop();
		await rejection;
		expect(fake.posted).toEqual([{ message: { type: 'shutdown' } }]);
	});

	it('keeps the channel usable when cancellation arrives during server validation', async () => {
		const gate = admission();
		const scope = new FakeWorkerScope();
		const ran: string[] = [];
		await using server = worker.serve({
			scope,
			protocol: worker.protocol({ request: gate.contract, response: ResponseSchema }),
			run(request) {
				ran.push(request.value);
				return { upper: request.value.toUpperCase() };
			},
		});
		// Open validation before transport teardown joins pending admission.
		using _release = { [Symbol.dispose]: () => gate.release.resolve() };
		scope.message({ type: 'request', id: 'cancelled', context: admissionContext, request: { value: 'one' } });
		await gate.entered;
		scope.message({ type: 'cancel', id: 'cancelled', reason: 'stop' });
		scope.message({ type: 'request', id: 'next', context: admissionContext, request: { value: 'two' } });
		await scope.waitForPosts(1);
		expect(scope.posted[0]?.message).toMatchObject({ type: 'result', id: 'next' });
		gate.release.resolve();
		await scope.waitForPosts(2);
		await server.stop();
		expect(ran).toEqual(['two']);
		expect(scope.posted).toEqual([{ message: { type: 'result', id: 'next', response: { upper: 'TWO' } } }, {
			message: { type: 'cancelled', id: 'cancelled' },
		}]);
	});

	it('rejects duplicate server admission before either handler can run', async () => {
		const gate = admission();
		const scope = new FakeWorkerScope();
		let runs = 0;
		await using server = worker.serve({
			scope,
			protocol: worker.protocol({ request: gate.contract, response: ResponseSchema }),
			run() {
				runs += 1;
				return { upper: 'INVALID' };
			},
		});
		// Open validation before transport teardown joins pending admission.
		using _release = { [Symbol.dispose]: () => gate.release.resolve() };
		const frame = { type: 'request', id: 'duplicate', context: admissionContext, request: { value: 'one' } };
		scope.message(frame);
		await gate.entered;
		scope.message(frame);
		await scope.waitForPosts(1);
		gate.release.resolve();
		await server.closed;
		expect(runs).toBe(0);
		expect(scope.posted).toHaveLength(2);
		expect(scope.posted[0]?.message).toMatchObject({ type: 'fault', fault: { name: 'WorkerProtocolError' } });
		expect(scope.posted[1]?.message).toEqual({ type: 'cancelled', id: 'duplicate' });
	});

	it('joins server validation before acknowledging cooperative shutdown', async () => {
		const gate = admission();
		const scope = new FakeWorkerScope();
		let runs = 0;
		await using server = worker.serve({
			scope,
			protocol: worker.protocol({ request: gate.contract, response: ResponseSchema }),
			run() {
				runs += 1;
				return { upper: 'INVALID' };
			},
		});
		// Open validation before transport teardown joins pending admission.
		using _release = { [Symbol.dispose]: () => gate.release.resolve() };
		scope.message({ type: 'request', id: 'waiting', context: admissionContext, request: { value: 'one' } });
		await gate.entered;
		scope.message({ type: 'shutdown' });
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
		expect(scope.posted).toHaveLength(0);
		gate.release.resolve();
		await server.closed;
		expect(runs).toBe(0);
		expect(scope.posted.at(-1)?.message).toEqual({ type: 'stopped' });
		expect(scope.posted.some(({ message }) => (message as { type: string }).type === 'cancelled')).toBe(true);
	});
});

import * as codecs from '@okikio/schema/codec';
import * as schemaCore from '@okikio/schema';
import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import * as context from '@okikio/context';
import * as worker from './mod.ts';
import { FakeWorker, FakeWorkerScope, RequestSchema, ResponseSchema } from './fixtures/protocol.ts';

describe('worker payload contracts', () => {
	it('keeps all five worker payload types through explicit encoding directions', async () => {
		const dates = codecs.define({
			decode: schemaCore.transform(schemaCore.string(), (text) => new Date(text)),
			encode: schemaCore.transform(schemaCore.date(), (date) => date.toISOString()),
		});
		const contract = worker.protocol({
			request: dates,
			response: dates,
			notice: dates,
			call: { request: dates, response: dates },
		});
		const raw = new FakeWorker();
		class LinkedScope extends FakeWorkerScope {
			override postMessage(message: unknown, transfer?: readonly Transferable[]): void {
				super.postMessage(message, transfer);
				queueMicrotask(() => raw.message(message));
			}
		}
		const scope = new LinkedScope();
		raw.onPost = (message) => queueMicrotask(() => scope.message(message));
		await using ctx = context.create({ id: 'worker-dates' });
		const date = new Date('2026-01-02T03:04:05Z');
		const notices: Date[] = [];
		await using _server = worker.serve({
			scope,
			protocol: contract,
			async run(request, _ctx, control) {
				expect(request).toBeInstanceOf(Date);
				await control.notify(request);
				const reply = await control.call(request);
				expect(reply).toBeInstanceOf(Date);
				return reply;
			},
		});
		await using client = worker.open(ctx, {
			module: new URL('file:///dates.ts'),
			create: () => raw,
			protocol: contract,
			notice(value) {
				notices.push(value);
			},
			call(value) {
				expect(value).toBeInstanceOf(Date);
				return value;
			},
		});
		const returned: Date = await client.request(ctx, date);
		expect(returned).toEqual(date);
		expect(notices).toEqual([date]);
	});

	it('negotiates before payload encoding, bounds handshake admissions and rejects mismatched revisions', async () => {
		for (const mismatch of [false, true]) {
			let encoded = 0;
			const Request = codecs.identity(schemaCore.define((value) => {
				encoded++;
				return schemaCore.object({ value: schemaCore.string() }).parse(value);
			}));
			const compatibility = { contract: 'test.negotiation', version: 1, features: ['echo'], required: ['echo'] };
			const parent = worker.protocol({ request: Request, response: codecs.identity(ResponseSchema), compatibility });
			const remote = worker.protocol({ ...parent, compatibility: { ...compatibility, version: mismatch ? 2 : 1 } });
			const raw = new FakeWorker();
			class Linked extends FakeWorkerScope {
				override postMessage(message: unknown): void {
					super.postMessage(message);
					queueMicrotask(() => raw.message(message));
				}
			}
			const scope = new Linked();
			let releaseHello!: () => void;
			const hello = Promise.withResolvers<void>();
			raw.onPost = (message) => {
				if ((message as { type: string }).type === 'hello') {
					releaseHello = () => scope.message(message);
					hello.resolve();
				} else queueMicrotask(() => scope.message(message));
			};
			await using _server = worker.serve({
				scope,
				protocol: remote,
				maximumRequests: 1,
				run: (value) => ({ upper: value.value.toUpperCase() }),
			});
			await using ctx = context.create({ id: 'negotiated-thread' });
			await using handle = worker.open(ctx, {
				module: new URL('file:///negotiated.ts'),
				create: () => raw,
				protocol: parent,
				maximumRequests: 1,
				shutdownMs: 10,
			});
			const pending = handle.request(ctx, { value: 'hello' });
			await hello.promise;
			expect(encoded).toBe(0);
			await expect(handle.request(ctx, { value: 'excess' })).rejects.toThrow(RangeError);
			expect(encoded).toBe(0);
			releaseHello();
			if (mismatch) {
				await expect(pending).rejects.toThrow();
				expect(encoded).toBe(0);
			} else {
				expect(await pending).toEqual({ upper: 'HELLO' });
				expect(encoded).toBe(2);
			}
		}
	});

	it('rejects raw oversize payloads before encoding and retains byte admission through remote cleanup', async () => {
		let encoded = 0;
		const raw = new FakeWorker();
		const contract = worker.protocol({
			request: codecs.identity(schemaCore.define((value) => {
				encoded++;
				return value as { value: string };
			})),
			response: codecs.identity(ResponseSchema),
		});
		await using owner = context.create({ id: 'byte-admission' });
		await using handle = worker.open(owner, {
			module: new URL('file:///byte-admission.ts'),
			create: () => raw,
			protocol: contract,
			budget: { maximumMessageBytes: 1200, maximumInFlightBytes: 1400, maximumNodes: 1000 },
			shutdownMs: 0,
		});
		await expect(handle.request(owner, { value: 'x'.repeat(2000) })).rejects.toThrow(RangeError);
		expect(encoded).toBe(0);
		expect(raw.posted).toHaveLength(0);
		const first = handle.request(owner, { value: 'x'.repeat(900) }, { id: 'first' });
		await raw.waitForPosts(1);
		await expect(handle.request(owner, { value: 'x'.repeat(900) }, { id: 'second' })).rejects.toThrow(RangeError);
		expect(encoded).toBe(1);
		raw.message({ type: 'result', id: 'first', response: { upper: 'ok' } });
		expect(await first).toEqual({ upper: 'ok' });
		const next = handle.request(owner, { value: 'x'.repeat(900) }, { id: 'next' });
		await raw.waitForPosts(2);
		raw.message({ type: 'result', id: 'next', response: { upper: 'again' } });
		expect(await next).toEqual({ upper: 'again' });
	});

	it('publishes closed only after native termination and reports unconfirmed host failure', async () => {
		for (const fails of [false, true]) {
			await using owner = context.create({ id: 'termination-receipt' });
			const raw = new FakeWorker();
			const gate = Promise.withResolvers<void>();
			let terminating = false;
			const failure = new Error('native termination failed');
			raw.terminate = async () => {
				terminating = true;
				await gate.promise;
				if (fails) throw failure;
			};
			const handle = worker.open(owner, {
				module: new URL('file:///termination.ts'),
				create: () => raw,
				protocol: worker.protocol({ request: RequestSchema, response: ResponseSchema }),
				shutdownMs: 0,
			});
			let closed = false;
			void handle.closed.then(() => {
				closed = true;
			});
			const stop = handle.stop('receipt');
			for (let index = 0; index < 100 && !terminating; index++) await Promise.resolve();
			expect(terminating).toBe(true);
			expect(closed).toBe(false);
			gate.resolve();
			await stop;
			expect((await handle.closed).status).toBe(fails ? 'failed' : 'stopped');
			expect(raw.listeners.message.size).toBe(0);
		}
	});

	it('joins host finalization once before shutdown acknowledgement and reports even undefined cleanup failure', async () => {
		for (const failed of [false, true]) {
			const scope = new FakeWorkerScope();
			const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
			let calls = 0;
			const server = worker.serve({
				scope,
				protocol: worker.protocol({ request: RequestSchema, response: ResponseSchema }),
				run: (request) => ({ upper: request.value }),
				async finalize() {
					calls++;
					entered.resolve();
					await release.promise;
					if (failed) throw undefined;
				},
			});
			const closed = server.closed.then(() => ({ failed: false }), (error: unknown) => ({ failed: true, error }));
			scope.message({ type: 'shutdown' });
			await entered.promise;
			expect(scope.posted.some((entry) => (entry.message as { type: string }).type === 'stopped')).toBe(false);
			const local = server.stop();
			expect(server[Symbol.asyncDispose]()).toBe(local);
			const observed = local.then(() => false, () => true);
			release.resolve();
			expect(await observed).toBe(failed);
			expect((await closed).failed).toBe(failed);
			expect(calls).toBe(1);
			expect(scope.posted.some((entry) => (entry.message as { type: string }).type === 'stopped')).toBe(!failed);
			expect(scope.listeners.message.size).toBe(0);
		}
	});
});

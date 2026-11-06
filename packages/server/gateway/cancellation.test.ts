import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import { expect } from '@std/expect';
import { it } from 'node:test';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import * as endpoint from '@okikio/server/endpoint';
import * as response from '@okikio/http/response';
import * as service from '../service/mod.ts';
import * as gateway from './mod.ts';

const Body: StandardSchemaV1<unknown, unknown> = {
	'~standard': { version: 1, vendor: 'test', validate: (value) => ({ value }) },
};
const Ok = response.ok(Body, { id: 'cancel:ok', description: 'Response body.' });
const Upload = endpoint.post({ id: 'cancel:upload', path: '/upload', raw: Body, responses: [Ok] });
const Service = service.define({ id: 'cancel-service', path: '/', endpoints: [Upload] });

/** Bound a regression assertion without abandoning its test-owned operation. */
async function within<Value>(work: Promise<Value>): Promise<Value> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			work,
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(() => reject(new Error('Gateway cancellation did not settle.')), 5_000);
			}),
		]);
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}

for (const started of [false, true]) {
	it(`applies the gateway deadline to a stalled upload ${started ? 'after its first chunk' : 'before its first chunk'}`, async () => {
		const caller = new AbortController();
		const cleanup = Promise.withResolvers<void>();
		const cancelled = Promise.withResolvers<void>();
		let contactedOrigin = false;
		const source = new ReadableStream<Uint8Array>({
			start(controller) {
				// Exercise both an empty pending read and partial progress. Neither
				// upload may contact the origin after its buffering deadline expires.
				if (started) controller.enqueue(new Uint8Array([1]));
			},
			cancel() {
				cancelled.resolve();
				return cleanup.promise;
			},
		});
		const compiled = gateway.compile(gateway.define({
			id: 'cancel-gateway',
			services: [gateway.mount(Service, { origin: 'http://localhost:8080' })],
			policies: [gateway.policy({
				id: 'bounded-upload',
				endpoints: [Upload],
				bodyLimit: 16,
				timeout: Temporal.Duration.from({ milliseconds: 20 }),
			})],
		}));
		const runtime = gateway.create(compiled, {
			fetch: () => {
				contactedOrigin = true;
				return Promise.resolve(new Response('unexpected'));
			},
		});
		const init: RequestInit & { duplex: 'half' } = {
			method: 'POST',
			body: source,
			signal: caller.signal,
			duplex: 'half',
		};
		const pending = runtime.fetch(new Request('http://public.test/upload', init));
		// Keep a rejection observer even if the prompt-settlement assertion fails.
		void pending.catch(() => {});
		try {
			const result = await within(pending);
			expect(result.status).toBe(504);
			expect(contactedOrigin).toBe(false);
			// The native Request may forward cancellation to its source after the
			// gateway has returned 504. Observe callback entry, not a same-turn flag;
			// its cleanup promise must remain pending until this scenario releases it.
			await within(cancelled.promise);
			// Request body transfer may retain its source lock until late cleanup.
			await result.body?.cancel().catch(() => {});
		} finally {
			caller.abort(new Error('test finished'));
			cleanup.resolve();
			await pending.catch(() => {});
		}
	});
}

for (const cleanupFails of [false, true]) {
	it(`preserves the response abort reason before upstream cleanup ${cleanupFails ? 'rejects' : 'completes'}`, async () => {
		const caller = new AbortController();
		const cleanup = Promise.withResolvers<void>();
		let cancelled: unknown;
		let cancellations = 0;
		let cleaned = false;
		const source = new ReadableStream<Uint8Array>({
			cancel(reason) {
				cancelled = reason;
				cancellations += 1;
				return cleanup.promise.then(() => {
					cleaned = true;
				}, (error: unknown) => {
					cleaned = true;
					throw error;
				});
			},
		});
		const compiled = gateway.compile(gateway.define({
			id: 'response-gateway',
			services: [gateway.mount(Service, { origin: 'http://localhost:8080' })],
		}));
		const runtime = gateway.create(compiled, { fetch: () => Promise.resolve(new Response(source)) });
		const result = await runtime.fetch(
			new Request('http://public.test/upload', { method: 'POST', signal: caller.signal }),
		);
		const reader = result.body!.getReader();
		const pending = reader.read().then(
			() => ({ fulfilled: true as const }),
			(reason: unknown) => ({ fulfilled: false as const, reason }),
		);
		const reason = cleanupFails ? null : Object.freeze({ stop: 'client disconnected' });
		try {
			caller.abort(reason);
			const outcome = await within(pending);
			expect(outcome.fulfilled).toBe(false);
			if (!outcome.fulfilled) expect(outcome.reason).toBe(reason);
			expect(cancelled).toBe(reason);
			expect(cancellations).toBe(1);
			expect(source.locked).toBe(false);
			expect(cleaned).toBe(false);
		} finally {
			if (cleanupFails) cleanup.reject(undefined);
			else cleanup.resolve();
			await pending;
			reader.releaseLock();
		}
		await cleanup.promise.catch(() => {});
		await Promise.resolve();
		expect(cleaned).toBe(true);
	});
}

it('refuses a late Fetch response before its stalled discard finishes', async () => {
	const caller = new AbortController();
	const started = Promise.withResolvers<void>();
	const upstream = Promise.withResolvers<Response>();
	const cleanup = Promise.withResolvers<void>();
	let cancellations = 0;
	let cancelled: unknown;
	let cleaned = false;
	const source = new ReadableStream<Uint8Array>({
		cancel(reason) {
			cancellations += 1;
			cancelled = reason;
			return cleanup.promise.then(() => {
				cleaned = true;
			});
		},
	});
	const compiled = gateway.compile(gateway.define({
		id: 'late-response-gateway',
		services: [gateway.mount(Service, { origin: 'http://localhost:8080' })],
	}));
	const runtime = gateway.create(compiled, {
		fetch: () => {
			started.resolve();
			return upstream.promise;
		},
	});
	const pending = runtime.fetch(new Request('http://public.test/upload', { method: 'POST', signal: caller.signal }))
		.then(
			() => ({ fulfilled: true as const }),
			(reason: unknown) => ({ fulfilled: false as const, reason }),
		);
	const reason = Object.freeze({ stop: 'caller left before adapter returned' });
	try {
		await started.promise;
		caller.abort(reason);
		upstream.resolve(new Response(source));
		const outcome = await within(pending);
		expect(outcome.fulfilled).toBe(false);
		if (!outcome.fulfilled) expect(outcome.reason).toBe(reason);
		expect(cancellations).toBe(1);
		expect(cancelled).toBe(reason);
		expect(cleaned).toBe(false);
	} finally {
		cleanup.resolve();
		await pending;
	}
	await cleanup.promise;
	await Promise.resolve();
	expect(cleaned).toBe(true);
});

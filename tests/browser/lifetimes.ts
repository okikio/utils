/** Browser consumers for pooled cleanup, cancellation, channel failure and shared resources. @module */
import '@okikio/dispose/polyfill';
import '@okikio/duration/polyfill';
import * as context from '@okikio/context';
import * as pool from '@okikio/pool';
import * as resource from '@okikio/capability/resource';
import * as state from '@okikio/context/state';
import * as schema from '@okikio/schema';
import * as client from '@okikio/server/client';
import * as endpoint from '@okikio/server/endpoint';
import * as response from '@okikio/http/response';
import { split } from '@okikio/streams/frame';
import * as text from '@okikio/streams/text';
import * as csv from '@okikio/format/csv';
import { rows } from '@okikio/format/csv/validate';
import { Channel, mapPooledOrdered } from '@okikio/scheduler/concurrency';

/** Fail on the public lifetime invariant, without depending on a test-runner runtime. */
function assert(value: unknown, message: string): void {
	if (!value) throw new Error(message);
}

/** Both drain callers must retain ownership while a provider is still closing an idle value. */
async function poolDrain(): Promise<string> {
	await using owner = context.create({ id: 'browser-pool', clock: new context.TestClock() });
	const closing = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	let closed = 0;
	await using values = await pool.create({
		ctx: owner,
		minimum: 1,
		maximum: 1,
		maximumWaiting: 32,
		create: () => ({ id: 1 }),
		async close() {
			closing.resolve();
			await release.promise;
			closed++;
		},
	});
	const draining = values.drain();
	let joined = false;
	const concurrent = values.drain().then(() => {
		joined = true;
	});
	try {
		await closing.promise;
		// A completed admission attempt gives both drain continuations a turn.
		const [admission] = await Promise.allSettled([values.acquire(owner)]);
		assert(admission.status === 'rejected', 'A draining browser pool admitted another lease.');
		assert(!joined && closed === 0, 'Concurrent drain finished before idle cleanup.');
		release.resolve();
		await Promise.all([draining, concurrent]);
		assert(joined && closed === 1, 'Idle cleanup did not join exactly once.');
		return 'pool concurrent drain joins browser idle cleanup';
	} finally {
		release.resolve();
		await Promise.allSettled([draining, concurrent]);
	}
}

/** A late source read may finish, but cancellation must prevent its mapper's side effects. */
async function cancelledMapping(): Promise<string> {
	const controller = new AbortController();
	const reading = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	const reason = new Error('Browser request cancelled.');
	let mapped = 0;
	let closed = false;
	async function* source(): AsyncIterable<number> {
		try {
			reading.resolve();
			await release.promise;
			yield 1;
		} finally {
			closed = true;
		}
	}
	const consumed = Array.fromAsync(mapPooledOrdered({
		items: source(),
		concurrency: 1,
		signal: controller.signal,
		map(value) {
			mapped++;
			return Promise.resolve(value);
		},
	}));
	const settled = Promise.allSettled([consumed]);
	try {
		await reading.promise;
		controller.abort(reason);
		release.resolve();
		const [outcome] = await settled;
		assert(outcome.status === 'rejected' && outcome.reason === reason, 'Mapper cancellation lost its exact reason.');
		assert(mapped === 0 && closed, 'A late source value started mapping or failed to close.');
		return 'ordered mapping rejects late admission after browser cancellation';
	} finally {
		controller.abort(reason);
		release.resolve();
		await settled;
	}
}

/** A supplied undefined reason is a failure, distinct from argument-free normal closure. */
async function channelFailure(): Promise<string> {
	await using channel = new Channel<number>({ capacity: 1 });
	await channel.send(7);
	channel.close(undefined);
	const iterator = channel[Symbol.asyncIterator]();
	try {
		const first = await iterator.next();
		assert(!first.done && first.value === 7, 'Channel did not drain its buffered browser value.');
		const [iteration, receiving] = await Promise.allSettled([iterator.next(), channel.receive()]);
		assert(
			iteration.status === 'rejected' && iteration.reason === undefined &&
				receiving.status === 'rejected' && receiving.reason === undefined,
			'An explicit undefined channel failure became normal completion.',
		);
		return 'channel preserves explicit undefined failure in browser iteration and receive';
	} finally {
		await iterator.return?.();
	}
}

/** Failed partial cleanup must be observable to the collection owner as well as the borrower. */
async function resourceCleanup(): Promise<string> {
	await using owner = context.create({ id: 'browser-resource', clock: new context.TestClock() });
	const started = Promise.withResolvers<void>();
	const cleanup = new Error('Browser resource cleanup failed.');
	let cleaned = 0;
	const Pending = resource.define<never>()({ id: 'browser.pending', description: 'A cancellable browser resource.' });
	const implementation = resource.implement(Pending, {
		create({ ctx }) {
			ctx.defer(() => {
				cleaned++;
				throw cleanup;
			});
			return new Promise<never>((_resolve, reject) => {
				ctx.signal.addEventListener('abort', () => reject(ctx.signal.reason), { once: true });
				started.resolve();
			});
		},
	});
	const collection = resource.create(resource.implementations(implementation), { host: {}, ctx: owner });
	const borrowing = collection.get(owner, Pending);
	const borrowed = Promise.allSettled([borrowing]);
	try {
		await started.promise;
		const [disposal] = await Promise.allSettled([collection[Symbol.asyncDispose]()]);
		const [acquisition] = await borrowed;
		assert(
			acquisition.status === 'rejected' && disposal.status === 'rejected' &&
				acquisition.reason === disposal.reason && disposal.reason instanceof SuppressedError &&
				disposal.reason.error === cleanup && disposal.reason.suppressed instanceof resource.CollectionDisposedError,
			'Browser collection disposal lost its acquisition cleanup or cancellation failure.',
		);
		assert(cleaned === 1, 'Browser partial acquisition was not cleaned exactly once.');
		return 'resource disposal retains browser acquisition cleanup failure';
	} finally {
		await Promise.allSettled([collection[Symbol.asyncDispose](), borrowed]);
	}
}

/** New portable leaves must preserve native browser decoding, parser ownership and read-only projection. */
async function composedImport(): Promise<string> {
	using source = state.create({ count: 0 });
	using selected = state.select(source.reader, ({ count }) => count);
	source.set({ count: 2 });
	assert(selected.get() === 2 && !('set' in selected), 'Browser projection lost its read-only boundary.');
	const wire = new TextEncoder().encode('é::z');
	const frames = await Array.fromAsync(split(
		new ReadableStream({
			start(controller) {
				for (const value of wire) controller.enqueue(new Uint8Array([value]));
				controller.close();
			},
		}),
		new TextEncoder().encode('::'),
		{
			maximumBytes: 100,
			maximumChunkBytes: 4,
			maximumFrameBytes: 10,
			incomplete: 'emit',
		},
	));
	assert(
		frames.map((value) => new TextDecoder().decode(value)).join('|') === 'é|z',
		'Browser delimiter framing changed split UTF-8 bytes.',
	);
	const decoded = await Array.fromAsync(text.decode(
		new ReadableStream({
			start(controller) {
				controller.enqueue(wire.subarray(0, 1));
				controller.enqueue(wire.subarray(1));
				controller.close();
			},
		}),
		{ maximumBytes: 100, maximumChunkBytes: 100, fatal: true, ignoreBOM: false },
	));
	assert(decoded.join('') === 'é::z', 'Browser decoder lost UTF-8 carry.');
	await using document = await csv.parseStream(
		new ReadableStream({
			start(controller) {
				controller.enqueue(new TextEncoder().encode('Name,Name\nignored,Ada\n'));
				controller.close();
			},
		}),
		{ delimiter: ',', encoding: 'utf-8', headerRow: 1 },
	);
	const values = await Array.fromAsync(rows(schema.object({ name: schema.string() }), document.rows, {
		columns: { name: 1 },
		maximumColumns: 1,
		maximumRows: 1,
		maximumIssues: 1,
		maximumPathLength: 4,
		onInvalid: 'throw',
	}));
	assert(
		values[0]?.kind === 'value' && values[0].value.name === 'Ada',
		'Browser typed CSV selected a duplicate header by name.',
	);
	return 'derived readers, bounded frames/UTF-8 and typed CSV in native browser';
}

/** Native browser Request construction preserves the explicit transport policy; no server resources are acquired. */
async function clientPolicy(): Promise<string> {
	const Route = endpoint.get({
		id: 'browser-client',
		path: '/item',
		responses: [response.ok(schema.string(), { description: 'Text.' })],
	});
	let calls = 0;
	const api = client.create(Route, {
		baseUrl: 'https://client.invalid',
		maximumDeclarations: 2,
		maximumRequestBytes: 100,
		maximumResponseBytes: 100,
		fetch(request, init) {
			assert(
				request.credentials === 'omit' && init.credentials === 'omit',
				'Browser client changed credential policy.',
			);
			assert(
				request.redirect === 'manual' && init.redirect === 'manual',
				'Browser client followed a redirect implicitly.',
			);
			calls++;
			return Response.json('native');
		},
	});
	assert(calls === 0, 'Client construction started I/O.');
	const result = await api.call(Route.operations[0], {});
	assert(result.kind === 'success' && result.value === 'native' && calls === 1, 'Browser client round trip failed.');
	return 'typed client native browser credentials, redirect and bounded body contract';
}

/** Execute the same public consumers against source and installed browser bundles. */
export async function verify(): Promise<string[]> {
	return [
		await poolDrain(),
		await cancelledMapping(),
		await channelFailure(),
		await resourceCleanup(),
		await composedImport(),
		await clientPolicy(),
	];
}

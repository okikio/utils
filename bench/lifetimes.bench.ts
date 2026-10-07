/**
 * Local pipeline ownership: admission, mapping, byte-to-line consumption and
 * acquired dependency lifetime. Every cycle releases what it owns; independent
 * formulas validate all transformed values before any measurement is registered.
 */
import { deepStrictEqual, strictEqual } from 'node:assert';
import { bench, do_not_optimize, group } from 'mitata';
import { pooledMap } from '@std/async';
import * as capacity from '@okikio/capacity';
import * as concurrency from '@okikio/concurrency';
import * as context from '@okikio/context';
import * as resource from '@okikio/resource';
import * as streams from '@okikio/streams';
import * as task from '@okikio/task';
import * as telemetry from '@okikio/telemetry';
import { run } from './run.ts';

const values = Array.from({ length: 100 }, (_, index) => index);
const bytes = new TextEncoder().encode(values.map((value) => `asset-${value}\n`).join(''));
const Expected = values.map((value) => value * 2);
const Slots = capacity.create({ readers: 4, writers: 2 });
const Store = resource.define<{ read(id: string): string }>()({
	id: 'bench.store',
	description: 'Borrow a process-local asset reader.',
});
let disposedResources = 0;
const StoreLive = resource.implement(Store, {
	create: () => ({
		read: (id) => `value:${id}`,
		[Symbol.asyncDispose]() {
			disposedResources++;
			return Promise.resolve();
		},
	}),
});
const factories = resource.implementations(StoreLive);

/** Chunk shape is fixed and borrowed; consumers must join readers and source iteration. */
function source(blocks = 1): ReadableStream<Uint8Array> {
	let offset = 0;
	return new ReadableStream({
		pull(controller) {
			if (offset === bytes.length * blocks) {
				controller.close();
				return;
			}
			const local = offset % bytes.length;
			const end = Math.min(local + 31, bytes.length);
			controller.enqueue(bytes.subarray(local, end));
			offset += end - local;
		},
	});
}

/** Local cleanup and child deadline construction are part of this operation's cost. */
async function lifetime(): Promise<number> {
	let closed = 0;
	await using owner = context.create({ id: 'lifetime-benchmark' });
	await using child = context.timeout(owner, 'PT30S');
	child.defer(() => {
		closed++;
	});
	context.check(child);
	await child[Symbol.asyncDispose]();
	return closed;
}

/** Acquire and close a declared collection around one borrowed read. */
async function acquire(): Promise<{ value: string; closed: number }> {
	const initial = disposedResources;
	await using owner = context.create({ id: 'resource-benchmark' });
	await using collection = resource.create(factories, { ctx: owner, host: {} });
	const value = (await collection.get(owner, Store)).read('asset-1');
	await collection[Symbol.asyncDispose]();
	return { value, closed: disposedResources - initial };
}

/** All diagnostics remain bounded by the ring capacity even over many iterations. */
async function report(verify = false): Promise<number> {
	let received = 0;
	const names: string[] = [];
	const target = {
		report(event: telemetry.Event) {
			received++;
			if (verify) names.push(event.name);
		},
	};
	const buffered = telemetry.buffer(target, { capacity: 16 });
	const scope = telemetry.create(buffered, { fields: { request_id: 'bench-import' } });
	for (let index = 0; index < 32; index++) await scope.report({ name: `asset.read.${index}`, level: 'debug' });
	await scope.report({ name: 'asset.failed', level: 'error' });
	if (verify) {
		deepStrictEqual(names, [...Array.from({ length: 16 }, (_, index) => `asset.read.${index + 16}`), 'asset.failed']);
	}
	return received;
}

/** Cancellation must propagate to every child before its asynchronous cleanup is joined. */
async function cancellation(): Promise<number> {
	await using owner = context.create({ id: 'cancel-benchmark' });
	const children = Array.from({ length: 100 }, (_, index) => context.child(owner, { id: `child-${index}` }));
	let closed = 0;
	for (const child of children) {
		child.defer(async () => {
			await Promise.resolve();
			closed++;
		});
	}
	context.cancel(owner, 'benchmark-cancel');
	for (const child of children) {
		if (!child.signal.aborted) throw new Error('Cancellation did not reach child.');
		await child[Symbol.asyncDispose]();
	}
	return closed;
}
/** Incremental consumption holds no row array while workload size grows. */
async function largeStream(blocks: number, verify = false): Promise<number> {
	let count = 0;
	for await (const line of streams.lines(source(blocks))) {
		if (verify && line !== `asset-${count % values.length}`) throw new Error('Scaled stream changed a source line.');
		count++;
	}
	return count;
}
strictEqual(await cancellation(), 100);
strictEqual(await largeStream(1024, true), values.length * 1024);
strictEqual(await lifetime(), 1);
deepStrictEqual(await acquire(), { value: 'value:asset-1', closed: 1 });
strictEqual(await report(true), 17);
const lease = await capacity.acquire(Slots, { readers: 1, writers: 1 });
deepStrictEqual(capacity.available(Slots), { readers: 3, writers: 1 });
lease.release();
deepStrictEqual(capacity.available(Slots), { readers: 4, writers: 2 });
const mapped = await Array.fromAsync(concurrency.mapPooledOrdered({
	items: values,
	concurrency: 4,
	async map(value, { signal }) {
		signal.throwIfAborted();
		return value * 2;
	},
}));
deepStrictEqual(mapped, Expected);
deepStrictEqual(await Array.fromAsync(pooledMap(4, values, (value) => Promise.resolve(value * 2))), Expected);
deepStrictEqual(await Array.fromAsync(streams.lines(source())), values.map((value) => `asset-${value}`));
deepStrictEqual((await Array.fromAsync(streams.batch(values, { maximumItems: 16 }))).flat(), values);
await using initial = task.start(async (ctx) => {
	await ctx.checkpoint();
	return 42;
}, { id: 'task-benchmark' });
strictEqual(await initial.done, 42);
strictEqual(initial.status, 'completed');

group('Joined local lifetimes', () => {
	bench('cancel 100 admitted children + join asynchronous cleanup', async () => do_not_optimize(await cancellation()))
		.gc('once');
	bench('context owner + child deadline + joined cleanup', async () => do_not_optimize(await lifetime()));
	bench('task checkpoint + terminal result + cleanup', async () => {
		await using work = task.start(async (ctx) => {
			await ctx.checkpoint();
			return 42;
		}, { id: 'task-benchmark' });
		do_not_optimize(await work.done);
	});
	bench('declared resource create + borrow + dispose', async () => do_not_optimize(await acquire()));
	bench('atomic two-resource capacity acquire + release', async () => {
		const lease = await capacity.acquire(Slots, { readers: 1, writers: 1 });
		lease.release();
		do_not_optimize(capacity.available(Slots));
	});
});
group('Bounded transformations and observation', () => {
	bench('ordered cancellable map: 100 records, concurrency 4', async () => {
		do_not_optimize(
			await Array.fromAsync(concurrency.mapPooledOrdered({
				items: values,
				concurrency: 4,
				async map(value) {
					return value * 2;
				},
			})),
		);
	});
	bench('@std/async pooledMap: same successful output, different failure contract', async () => {
		do_not_optimize(await Array.fromAsync(pooledMap(4, values, (value) => Promise.resolve(value * 2))));
	});
	bench(
		'chunked UTF-8 stream to 100 lines',
		async () => do_not_optimize(await Array.fromAsync(streams.lines(source()))),
	);
	bench('bounded 16-record batches: 100 records', async () => {
		do_not_optimize(await Array.fromAsync(streams.batch(values, { maximumItems: 16 })));
	});
	bench(
		'bounded telemetry ring: 32 debug records, retain 16 + triggering error',
		async () => do_not_optimize(await report()),
	);
});
group('stream scaling without application row retention', () => {
	for (const blocks of [1, 1024]) {
		bench(
			`${blocks * values.length} UTF-8 lines, 31-byte source chunks`,
			async () => do_not_optimize(await largeStream(blocks)),
		).gc('once');
	}
});
await run();

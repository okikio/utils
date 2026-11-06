/** Warm reuse excludes construction; burst and rotation retain their explicit admission and cleanup costs. @module */
import '@okikio/dispose/polyfill';
import { run } from './fixtures/bench.ts';
import { bench, do_not_optimize, group } from 'mitata';

import * as context from '@okikio/context';
import * as pool from '@okikio/pool';

const OPERATIONS = 100;
await using ctx = context.create({ id: 'pool-benchmark', clock: new context.TestClock() });
await using values = await pool.create({
	ctx,
	minimum: 8,
	maximum: 8,
	maximumWaiting: 32,
	create: () => ({ ready: true }),
	close: () => {},
});
const direct = {};

/** Exercise the reusable path once before timing and reject a leaked lease. */
async function cycle(verify = false): Promise<pool.Stats> {
	for (let index = 0; index < OPERATIONS; index += 1) {
		await using lease = await values.acquire(ctx);
		if (verify && lease.value.ready !== true) throw new Error('Pool returned an invalid resource.');
		do_not_optimize(lease.value);
	}
	return values.stats();
}

const initial = await cycle(true);
if (initial.leased !== 0 || initial.idle !== 8) {
	throw new Error('Warm pool benchmark did not return every leased value.');
}

group('pool warm reuse', () => {
	bench('pool.acquire/release: 100 operations, maximum 8', async () => {
		do_not_optimize(await cycle());
	});
});

group('value-read primitive cost reference', () => {
	bench('direct reusable value read: 100 operations', () => {
		for (let index = 0; index < OPERATIONS; index += 1) do_not_optimize(direct);
	});
});

/** Saturate eight leases, verify the admission cap, then join every accepted borrower. */
async function burst(): Promise<number> {
	await using held = new AsyncDisposableStack();
	for (let index = 0; index < 8; index++) held.use(await values.acquire(ctx));
	const pending = Array.from({ length: 32 }, () => values.acquire(ctx));
	// Attach consumers before checking overload. Failure must still release the
	// held resources and join every borrower accepted into the waiting queue.
	const returned = Promise.all(pending.map(async (lease) => {
		await using _lease = await lease;
	}));
	let rejected = 0;
	try {
		for (let index = 0; index < 32; index++) {
			try {
				await values.acquire(ctx);
			} catch (error) {
				if (!(error instanceof pool.PoolWaitLimitError)) throw error;
				rejected++;
			}
		}
		if (values.stats().waiting !== 32 || rejected !== 32) throw new Error('Waiting admission escaped its cap.');
	} finally {
		await held.disposeAsync();
		await returned;
	}
	if (values.stats().waiting !== 0 || values.stats().leased !== 0) throw new Error('Burst leaked borrowers.');
	return rejected;
}
await burst();
group('pool bounded burst: 8 leased, 32 waiting, 32 rejected', () => {
	bench('admit, reject and join burst', async () => {
		do_not_optimize(await burst());
	});
});

/** A fresh pool cycle includes reset, retirement and shutdown; exact counts are the untimed oracle too. */
async function rotate(manual: boolean): Promise<number> {
	let created = 0;
	let reset = 0;
	let closed = 0;
	await using rotating = await pool.create({
		ctx,
		maximum: 8,
		maximumWaiting: 32,
		maximumUses: 10,
		create: () => ({ id: ++created }),
		reset: manual ? undefined : () => {
			reset++;
		},
		close: () => {
			closed++;
		},
	});
	for (let index = 0; index < 100; index++) {
		await using _lease = await rotating.acquire(ctx);
		if (manual && index % 10 !== 9) reset++;
	}
	await rotating[Symbol.asyncDispose]();
	if (created !== 10 || closed !== 10 || reset !== 90) throw new Error('Pool rotation oracle failed.');
	return reset;
}
await rotate(false);
await rotate(true);
group('pool 100 leases, retire every 10 uses', () => {
	bench('owned reset and rotation', async () => do_not_optimize(await rotate(false)));
	bench('caller reset and owned rotation', async () => do_not_optimize(await rotate(true)));
});
/** Hold the workload fixed at 100 exact-value selections; construction, 8 values and all retirement/close work are timed. */
async function selected(): Promise<void> {
	let created = 0, closed = 0;
	const identities: { id: number }[] = [];
	await using selected = await pool.create({
		ctx,
		minimum: 8,
		maximum: 8,
		maximumWaiting: 0,
		create() {
			const value = { id: ++created };
			identities.push(value);
			return value;
		},
		close() {
			closed++;
		},
	});
	for (let index = 0; index < 100; index++) {
		const target = identities[index % 8]!;
		await using lease = await selected.select(ctx, target);
		if (lease.value !== target) throw new Error('Exact selection substituted a pool value.');
		do_not_optimize(lease.value);
	}
	await Promise.all(identities.map((value) => selected.retire(value)));
	if (created !== 8 || closed !== 8 || selected.stats().idle !== 0) {
		throw new Error('Selected pool cleanup oracle failed.');
	}
}
await selected();
group('pool 100 exact selections, 8 values, complete owned lifetime', () => {
	bench('select, release and retire all values', selected);
});
await run();

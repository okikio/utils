import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import * as z from 'zod';

import * as capacity from './mod.ts';

const count = capacity.unit('count', {
	description: 'A discrete number of concurrently usable items.',
	symbol: 'items',
});
const countField = capacity.field(z.number().int().nonnegative(), count, {
	description: 'A non-negative count.',
});

type HostValues = Readonly<{ cores: number; threads: number; threadsPerCore: number }>;
const threadConstraint = capacity.constraint<HostValues, typeof count>({
	id: 'threads-per-core',
	description: 'Threads must not exceed cores multiplied by threads per core.',
	unit: count,
	used: (value) => value.threads,
	maximum: (value) => value.cores * value.threadsPerCore,
});
const Host = capacity.define({
	cores: countField,
	threads: countField,
	threadsPerCore: countField,
}, { constraints: [threadConstraint] });

describe('capacity authoring records', () => {
	it('rejects hidden definition fields instead of dropping them from the snapshot', () => {
		const fields = { cores: countField };
		Object.defineProperty(fields, 'hidden', { value: countField, enumerable: false });
		expect(() => capacity.define(fields)).toThrow('enumerable data property');
	});

	it('rejects inherited admission limits and requests', async () => {
		const inheritedLimits = Object.create({ browserContexts: 1 }) as { browserContexts: number };
		expect(() => capacity.create(inheritedLimits)).toThrow('plain object or null-prototype record');

		const admission = capacity.create({ browserContexts: 1 });
		const inheritedRequest = Object.create({ browserContexts: 1 }) as { browserContexts: number };
		await expect(capacity.acquire(admission, inheritedRequest)).rejects.toThrow('plain object or null-prototype record');
	});
});

describe('capacity definitions', () => {
	it('reports satisfied, hit, and exceeded relationships', async () => {
		expect((await capacity.check(Host, { cores: 4, threads: 4, threadsPerCore: 2 })).status).toBe('satisfied');
		expect((await capacity.check(Host, { cores: 4, threads: 8, threadsPerCore: 2 })).status).toBe('hit');
		const exceeded = await capacity.check(Host, { cores: 4, threads: 9, threadsPerCore: 2 });
		expect(exceeded.status).toBe('exceeded');
		expect(exceeded.constraints[0]).toMatchObject({ used: 9, maximum: 8, remaining: -1 });
	});

	it('asserts only exceeded capacity while retaining schema validation', async () => {
		await expect(capacity.assert(Host, { cores: 4, threads: 9, threadsPerCore: 2 }))
			.rejects.toBeInstanceOf(capacity.CapacityExceededError);
		await expect(capacity.check(Host, { cores: -1, threads: 1, threadsPerCore: 1 })).rejects.toThrow();
	});

	it('composes canonical fields and rejects independent same-name definitions', () => {
		const left = capacity.define({ cores: countField });
		const right = capacity.define({ threads: countField });
		expect(capacity.compose(left, right).keys).toEqual(['cores', 'threads']);
		const conflicting = capacity.define({
			cores: capacity.field(z.number().int().nonnegative(), count, { description: 'Another core field.' }),
		});
		expect(() => capacity.compose(left, conflicting)).toThrow('conflicting definitions');
	});
});

describe('capacity admission', () => {
	it('reserves several names atomically and releases idempotently', async () => {
		const admission = capacity.create({ browserContexts: 2, uploadParts: 4 });
		const lease = await capacity.acquire(admission, { browserContexts: 1, uploadParts: 3 });
		expect(capacity.available(admission)).toEqual({ browserContexts: 1, uploadParts: 1 });
		lease.release();
		lease.release();
		expect(capacity.available(admission)).toEqual({ browserContexts: 2, uploadParts: 4 });
	});

	it('does not grant partial reservations and preserves FIFO head-of-line fairness', async () => {
		const admission = capacity.create({ browserContexts: 1, uploadParts: 1 });
		const occupied = await capacity.acquire(admission, { uploadParts: 1 });
		let headAdmitted = false;
		let tailAdmitted = false;
		const head = capacity.acquire(admission, { browserContexts: 1, uploadParts: 1 }).then((lease) => {
			headAdmitted = true;
			return lease;
		});
		const tail = capacity.acquire(admission, { browserContexts: 1 }).then((lease) => {
			tailAdmitted = true;
			return lease;
		});
		await Promise.resolve();
		expect(headAdmitted).toBe(false);
		expect(tailAdmitted).toBe(false);
		expect(capacity.available(admission)).toEqual({ browserContexts: 1, uploadParts: 0 });
		occupied.release();
		const headLease = await head;
		expect(headAdmitted).toBe(true);
		expect(tailAdmitted).toBe(false);
		headLease.release();
		const tailLease = await tail;
		tailLease.release();
	});

	it('preserves the legacy snapshot shape used by runtime telemetry', async () => {
		const admission = capacity.create({ browser_contexts: 1, upload_parts: 2 });
		const held = await capacity.acquire(admission, { upload_parts: 2 });
		const waiting = capacity.acquire(admission, { browser_contexts: 1, upload_parts: 1 });
		await Promise.resolve();
		expect(capacity.snapshot(admission)).toMatchObject({
			capacity: { browser_contexts: 1, upload_parts: 2 },
			available: { browser_contexts: 1, upload_parts: 0 },
			queuedRequests: 1,
		});
		held.release();
		(await waiting).release();
	});

	it('does not strand a waiter when abort races registration', async () => {
		for (let index = 0; index < 100; index += 1) {
			const admission = capacity.create({ browserContexts: 1 });
			const held = await capacity.acquire(admission, { browserContexts: 1 });
			const abort = new AbortController();
			const waiting = capacity.acquire(admission, { browserContexts: 1 }, abort.signal);
			abort.abort(new DOMException('cancelled', 'AbortError'));
			await expect(waiting).rejects.toThrow('cancelled');
			held.release();
			expect(capacity.snapshot(admission).queuedRequests).toBe(0);
		}
	});

	it('removes an aborted head waiter and admits the next request', async () => {
		const admission = capacity.create({ a: 1, b: 1 });
		const occupiedB = await capacity.acquire(admission, { b: 1 });
		const abort = new AbortController();
		const head = capacity.acquire(admission, { a: 1, b: 1 }, abort.signal);
		const tail = capacity.acquire(admission, { a: 1 });
		abort.abort(new Error('skip blocked head'));
		await expect(head).rejects.toThrow('skip blocked head');
		const tailLease = await tail;
		tailLease.release();
		occupiedB.release();
		expect(capacity.snapshot(admission).queuedRequests).toBe(0);
	});

	it('rejects unknown and impossible requests before they enter the FIFO queue', async () => {
		const admission = capacity.create({ browserContexts: 1 });
		await expect(capacity.acquire(admission, { browserContexts: 2 })).rejects.toThrow('exceeds capacity');
		await expect(capacity.acquire(admission, { uploadParts: 1 })).rejects.toThrow('Unknown resource capacity');
	});

	it('preserves resource names exactly as the previous Zod record contract did', async () => {
		const admission = capacity.create({ ' browser contexts ': 1 });
		const lease = await capacity.acquire(admission, { ' browser contexts ': 1 });
		expect(capacity.available(admission)).toEqual({ ' browser contexts ': 0 });
		lease.release();
	});
});

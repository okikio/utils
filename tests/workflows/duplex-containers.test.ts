/** Real container application ownership across authority replies, cancellation and socket disconnect. @module */
import { after, before, describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as context from '@okikio/context';
import * as duplex from '@okikio/activity/http/duplex';
import type { ActivityAttemptControl } from '@okikio/workflow';
import { attempt, Engine, Work } from '../fixtures/duplex/contracts.ts';
import { start } from '../fixtures/duplex/container.ts';
import type { Host } from '../fixtures/duplex/container.ts';
import { until } from './fixtures/evidence.ts';

let host: Host;
before(async () => {
	host = await start();
});
after(async () => {
	await host?.[Symbol.asyncDispose]();
});

/** Caller services remain outside the container; each receipt proves the reverse request reached this owner. */
function authority(
	receipts: { heartbeats: unknown[]; permissions: unknown[]; effects: unknown[] },
): ActivityAttemptControl {
	return {
		async heartbeat(value) {
			receipts.heartbeats.push(value);
		},
		permission: {
			maximumChecks: 8,
			async check(_ctx, requests) {
				receipts.permissions.push(...requests.map((value) => value.target));
				return requests.map(() => ({ allowed: true }));
			},
		},
		effect: {
			async emit(_ctx, value) {
				receipts.effects.push(value.value);
			},
		},
	};
}
function client() {
	return duplex.create({
		engine: Engine,
		activities: [Work],
		url: host.url,
		allowLoopbackHttp: true,
		headers: () => ({ authorization: `Bearer ${host.token}` }),
		timeoutMs: 15_000,
		cleanupMs: 5000,
	});
}

/** Read and bound the concrete application state, never infer cleanup solely from a returned cancellation. */
async function observed(id: string, phase: 'started' | 'cleanup' | 'closed') {
	await until(async () => (await host.metrics())[phase].includes(id), `container ${id} entered ${phase}`, 10_000);
}

describe('duplex HTTP in a native container', { concurrency: false, timeout: 120_000 }, () => {
	it('returns only after original authority and actual container activity cleanup finish', async () => {
		const id = `authority-${crypto.randomUUID()}`;
		const receipts = { heartbeats: [] as unknown[], permissions: [] as unknown[], effects: [] as unknown[] };
		await using ctx = context.create({ id });
		const result = await client().run(
			ctx,
			attempt(ctx, { id, mode: 'authority', cleanup: 'automatic', calls: 8 }),
			authority(receipts),
		);
		const metrics = await host.metrics();
		expect(result).toEqual({ type: 'success', value: { id, pid: metrics.pid } });
		expect(metrics.pid).toBe(1);
		expect(metrics.closed).toContain(id);
		expect(metrics.active).not.toContain(id);
		expect(receipts.heartbeats).toEqual(Array.from({ length: 8 }, (_, index) => ({ id, index })));
		expect(receipts.permissions).toEqual([id]);
		expect(receipts.effects).toEqual([{ id }]);
		expect(metrics.authenticatedPosts).toBeGreaterThanOrEqual(11);
	});

	it('keeps a cancelled scope active until its explicit resource cleanup is released', async () => {
		const id = `cancel-${crypto.randomUUID()}`;
		const stopped = new AbortController();
		await using ctx = context.create({ id, signal: stopped.signal });
		const receipts = { heartbeats: [] as unknown[], permissions: [] as unknown[], effects: [] as unknown[] };
		let returned = false;
		const pending = client().run(ctx, attempt(ctx, { id, mode: 'wait', cleanup: 'manual' }), authority(receipts)).then(
			(value) => {
				returned = true;
				return value;
			},
		);
		try {
			await observed(id, 'started');
			stopped.abort('stop');
			await observed(id, 'cleanup');
			expect(returned).toBe(false);
			const held = await host.metrics();
			expect(held.active).toContain(id);
			expect(held.closed).not.toContain(id);
		} finally {
			await host.release(id);
		}
		expect((await pending).type).toBe('cancelled');
		await observed(id, 'closed');
		expect((await host.metrics()).active).not.toContain(id);
	});

	it('cancels and joins a physically disconnected response without releasing ownership early', async () => {
		const id = `disconnect-${crypto.randomUUID()}`;
		await using ctx = context.create({ id });
		const response = await fetch(host.url, {
			method: 'POST',
			headers: {
				authorization: `Bearer ${host.token}`,
				'content-type': 'application/json',
				'x-okikio-activity-version': '2',
				'x-okikio-activity-operation': 'start',
			},
			body: JSON.stringify(attempt(ctx, { id, mode: 'wait', cleanup: 'manual' })),
			signal: AbortSignal.timeout(10_000),
		});
		expect(response.status).toBe(200);
		const reader = response.body!.getReader();
		await reader.read();
		await observed(id, 'started');
		await reader.cancel('physical socket consumer disconnected');
		try {
			await observed(id, 'cleanup');
			const held = await host.metrics();
			expect(held.active).toContain(id);
			expect(held.closed).not.toContain(id);
		} finally {
			await host.release(id);
		}
		await observed(id, 'closed');
	});

	it('enforces authentication before dispatch inside the container', async () => {
		const before = await host.metrics();
		const response = await fetch(host.url, {
			method: 'POST',
			body: '{',
			headers: {
				'content-type': 'application/json',
				'x-okikio-activity-version': '2',
				'x-okikio-activity-operation': 'start',
			},
		});
		expect(response.status).toBe(401);
		const after = await host.metrics();
		expect(after.started).toEqual(before.started);
	});

	it('does not turn a real provider cleanup exception into acknowledged cancellation', async () => {
		const id = `failed-cleanup-${crypto.randomUUID()}`;
		const cancelled = new AbortController();
		await using ctx = context.create({ id, signal: cancelled.signal });
		const receipts = { heartbeats: [] as unknown[], permissions: [] as unknown[], effects: [] as unknown[] };
		const result = client().run(ctx, attempt(ctx, { id, mode: 'wait', cleanup: 'failure' }), authority(receipts));
		await until(async () => (await host.metrics()).waiting.includes(id), 'provider acknowledged its heartbeat', 10_000);
		cancelled.abort('stop with failed cleanup');
		expect((await result).type).toBe('lost');
		const metrics = await host.metrics();
		expect(metrics.failed).toContain(id);
		expect(metrics.closed).not.toContain(id);
		expect(metrics.active).not.toContain(id);
	});
});

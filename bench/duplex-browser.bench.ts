// @benchmark optional
/**
 * Measure a real browser's completed authority round trips to a container.
 * Setup is outside timings. Mitata includes Playwright RPC, browser scheduling,
 * Fetch/CORS, container networking, validation and joined provider cleanup.
 * These costs are not a network-only measurement or a production threshold.
 * @module
 */
import { deepStrictEqual, strictEqual } from 'node:assert';
import process from 'node:process';
import { bench, do_not_optimize, group } from 'mitata';
import * as fixture from '../tests/fixtures/duplex/browser.ts';
import type { BrowserName } from '../tests/fixtures/duplex/browser.ts';
import { run } from '#tools/bench/run.ts';

const name = process.env.UTILS_DUPLEX_BROWSER ?? 'chromium';
if (!['chromium', 'firefox', 'webkit'].includes(name)) throw new Error('Select chromium, firefox or webkit.');
await using environment = await fixture.open();
await using engine = await environment.browser(name as BrowserName);
const page = await engine.page();
const pid = (await environment.host.metrics()).pid;
let sequence = 0;

/** Check original browser receipts; the untimed final metrics check separately inspects host cleanup. */
async function cycle(calls: number): Promise<number> {
	const id = `browser-bench:${++sequence}`;
	const result = await fixture.run(page, {
		url: environment.host.url,
		token: environment.host.token,
		input: { id, mode: 'authority', cleanup: 'automatic', calls },
	});
	strictEqual(result.type, 'success', result.reason ?? 'Browser authority did not complete.');
	deepStrictEqual(result.value, { id, pid });
	deepStrictEqual(result.heartbeats, Array.from({ length: calls }, (_, index) => ({ id, index })));
	deepStrictEqual(result.permissions, [id]);
	deepStrictEqual(result.effects, [{ id }]);
	return result.milliseconds;
}

/** Include an actual cancel POST and completion after automatic provider cleanup. */
async function cancel(): Promise<string> {
	const id = `browser-cancel:${++sequence}`;
	await page.evaluate(async (options) => {
		const path = '/duplex.mjs';
		(await import(path)).start(options);
	}, {
		url: environment.host.url,
		token: environment.host.token,
		input: { id, mode: 'wait', cleanup: 'automatic' },
	});
	// Provider entry proves this is cancellation of dispatched work. It does not
	// prove receipt of the first reverse call. Polling is included in this timing.
	await fixture.until(
		async () => (await environment.host.metrics()).active.includes(id),
		'No active cancellation attempt.',
	);
	const result = await page.evaluate(async (id) => {
		const path = '/duplex.mjs';
		const module = await import(path);
		module.cancel(id);
		return await module.join(id);
	}, id);
	strictEqual(result.type, 'cancelled', result.reason ?? 'Browser cancellation did not join.');
	return result.type;
}

for (const calls of [1, 8, 32]) {
	await cycle(calls);
	group(`${name}: ${calls} original heartbeat acknowledgements, permission and effect`, () => {
		bench('browser through container; includes Playwright RPC', async () => do_not_optimize(await cycle(calls)));
	});
}
await cancel();
group(`${name}: active cancellation through joined container cleanup`, () => {
	bench('browser start, active-state check, cancel and join', async () => do_not_optimize(await cancel()));
});
await run();
const metrics = await environment.host.metrics();
strictEqual(metrics.active.length, 0);
strictEqual(metrics.started.length, metrics.closed.length);
await fixture.report(`${name}-benchmark.json`, {
	engine: name,
	version: engine.browser.version(),
	image: environment.host.image,
	metrics,
	interpretation:
		'Setup excluded. Timings include Playwright RPC and native browser/container work. No TLS, production proxy or durable business writes.',
});

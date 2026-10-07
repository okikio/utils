/** Warm dispatch of the exact independently tested API, gateway policy and scaled route fixtures. @module */
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import { deepStrictEqual } from 'node:assert';
import { bench, do_not_optimize, group } from 'mitata';
import { cases, gatewayCases, observe, request, routingCases } from '../tests/fixtures/http-parity/corpus.ts';
import type { CaseType, ParityApiType } from '../tests/fixtures/http-parity/corpus.ts';
import { createHonoApi, createHonoGateway, createHonoRouting } from '../tests/fixtures/http-parity/hono.ts';
import { createUtilsApi, createUtilsGateway, createUtilsRouting } from '../tests/fixtures/http-parity/utils.ts';
import { run } from './run.ts';

/** One trial consumes every response; creation/warmup/disposal stay outside warm dispatch timing for both candidates. */
async function batch(app: ParityApiType, values: readonly CaseType[], origin?: string): Promise<readonly unknown[]> {
	const output: unknown[] = [];
	for (const value of values) output.push(await observe(await app.fetch(request(value, origin)), value));
	return output;
}

const owners: ParityApiType[] = [];
/** Verify each side against literal expectations before timing the same requests and consumed response projection. */
async function register(
	id: string,
	label: string,
	utils: ParityApiType,
	hono: ParityApiType,
	values: readonly CaseType[],
	origin?: string,
): Promise<void> {
	owners.push(utils, hono);
	for (const app of [utils, hono]) {
		deepStrictEqual(
			await batch(app, values, origin),
			values.map((value) => value.expected),
		);
	}
	const candidates = [['Utils', utils], ['Hono', hono]] as const;
	group(label, () => {
		for (const [name, app] of Deno.args.includes('--reverse') ? [...candidates].reverse() : candidates) {
			bench(`${name}: ${id}`, async () => do_not_optimize(await batch(app, values, origin))).gc('once');
		}
	});
}

try {
	await register('api', 'complete API request corpus', createUtilsApi(), createHonoApi(), cases);
	await register(
		'gateway',
		'forwarded gateway policy',
		createUtilsGateway(),
		createHonoGateway(),
		gatewayCases,
		'https://gateway.invalid',
	);
	for (const count of [16, 256, 4096]) {
		await register(
			`routes-${count}`,
			`${count} routes: first/middle/late/miss`,
			createUtilsRouting(count),
			createHonoRouting(count),
			routingCases(count),
		);
	}
	await run();
} finally {
	for (const owner of owners.reverse()) await owner.close();
}

/** Run independent Hono and Utils candidates against an authored application contract. @module */
import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';
import { cases, gatewayCases, observe, request, routingCases } from './fixtures/http-parity/corpus.ts';
import { createHonoApi, createHonoGateway, createHonoRouting } from './fixtures/http-parity/hono.ts';
import { createUtilsApi, createUtilsGateway, createUtilsRouting } from './fixtures/http-parity/utils.ts';

describe('independent HTTP API parity', () => {
	for (const [name, create] of [['Hono', createHonoApi], ['Utils', createUtilsApi]] as const) {
		it(`${name} satisfies the complete explicit request/output corpus`, async () => {
			const app = create();
			try {
				for (const value of cases) {
					deepStrictEqual(await observe(await app.fetch(request(value)), value), value.expected, value.id);
				}
			} finally {
				await app.close();
			}
		});
		it(`${name} preserves its declared precedence when the parameter route is registered first`, async () => {
			const app = create();
			try {
				const result = await app.fetch(new Request('https://api.invalid/priority/current'));
				deepStrictEqual(await result.json(), { selected: name === 'Hono' ? 'parameter' : 'static' });
			} finally {
				await app.close();
			}
		});
		it(`${name} keeps request state isolated under concurrent dispatch`, async () => {
			const app = create();
			try {
				const actors = [
					{ id: 'owned-state-and-onion', actor: 'ada' },
					{ id: 'state-isolation', actor: 'grace' },
				] as const;
				const stateCases = actors.map(({ id, actor }) => {
					const value = cases.find((entry) => entry.id === id);
					if (value === undefined) throw new Error(`Missing authored concurrent state case ${id}.`);
					deepStrictEqual(value.headers?.['x-actor'], actor);
					deepStrictEqual(value.expected.body, { actor });
					return value;
				});
				const values = await Promise.allSettled(
					stateCases.map(async (value) => await observe(await app.fetch(request(value)), value)),
				);
				// Join both requests before asserting or releasing the application owner.
				for (const [index, result] of values.entries()) {
					if (result.status === 'rejected') throw result.reason;
					deepStrictEqual(result.value, stateCases[index]!.expected, stateCases[index]!.id);
				}
			} finally {
				await app.close();
			}
		});
	}
	for (const [name, create] of [['Hono', createHonoGateway], ['Utils', createUtilsGateway]] as const) {
		it(`${name} independently enforces the selected gateway forwarding policy`, async () => {
			const app = create();
			try {
				for (const value of gatewayCases) {
					deepStrictEqual(
						await observe(await app.fetch(request(value, 'https://gateway.invalid')), value),
						value.expected,
					);
				}
			} finally {
				await app.close();
			}
		});
	}
	for (const count of [16, 256, 4096]) {
		for (const [name, create] of [['Hono', createHonoRouting], ['Utils', createUtilsRouting]] as const) {
			it(`${name} selects first, middle, late and missing routes in a ${count}-route table`, async () => {
				const app = create(count);
				try {
					for (const value of routingCases(count)) {
						deepStrictEqual(await observe(await app.fetch(request(value)), value), value.expected, value.id);
					}
				} finally {
					await app.close();
				}
			});
		}
	}
});

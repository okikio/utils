/** Qualify the independent compiled Vixeny challenger against authored wire outcomes. @module */
import { deepStrictEqual, rejects } from 'node:assert';
import { describe, it } from 'node:test';
import { cases, observe, request, routingCases } from './fixtures/http-parity/corpus.ts';
import { createVixenyApi, createVixenyRouting } from './fixtures/http-parity/vixeny.ts';

describe('independent Vixeny HTTP challenger', () => {
	it('satisfies the complete authored API corpus with its declared application adapters', async () => {
		const app = await createVixenyApi();
		try {
			for (const value of cases) {
				deepStrictEqual(await observe(await app.fetch(request(value)), value), value.expected, value.id);
			}
		} finally {
			await app.close();
		}
	});
	it('keeps actor and middleware state isolated under concurrent native dispatch', async () => {
		const app = await createVixenyApi();
		try {
			const values = ['owned-state-and-onion', 'state-isolation'].map((id) => {
				const value = cases.find((entry) => entry.id === id);
				if (value === undefined) throw new Error(`Missing authored concurrent case ${id}.`);
				return value;
			});
			const results = await Promise.allSettled(
				values.map(async (value) => await observe(await app.fetch(request(value)), value)),
			);
			for (const [index, result] of results.entries()) {
				if (result.status === 'rejected') throw result.reason;
				deepStrictEqual(result.value, values[index]!.expected, values[index]!.id);
			}
		} finally {
			await app.close();
		}
	});
	it('retains native registration precedence when the parameter route precedes the static route', async () => {
		const app = await createVixenyApi();
		try {
			deepStrictEqual(await (await app.fetch(new Request('https://api.invalid/priority/current'))).json(), {
				selected: 'parameter',
			});
		} finally {
			await app.close();
		}
	});
	for (const count of [16, 256, 4096]) {
		it(`selects first, middle, late and missing routes in the native ${count}-route table`, async () => {
			const app = await createVixenyRouting(count);
			try {
				for (const value of routingCases(count)) {
					deepStrictEqual(await observe(await app.fetch(request(value)), value), value.expected, value.id);
				}
			} finally {
				await app.close();
			}
		});
	}
	it('rejects invalid route table sizes before compilation', async () => {
		for (const count of [0, 1, 3, -2, 2.5, NaN, Infinity]) {
			await rejects(createVixenyRouting(count), {
				name: 'TypeError',
				message: 'Route count must be a positive even table size.',
			});
		}
	});
});

/** Qualify independently compiled Elysia Fetch fixtures before measuring them. @module */
import { deepStrictEqual } from 'node:assert';
import { describe, it } from 'node:test';
import { cases, observe, request, routingCases } from './fixtures/http-parity/corpus.ts';
import { createElysiaApi, createElysiaRouting } from './fixtures/http-parity/elysia.ts';

// Each observation uses a fresh real application. The neutral corpus owns the
// literals; failed challenger cases cannot be silently omitted from profiling.
describe('independent Elysia application contract', () => {
	it('decodes literal percent escapes once through native route parameters', async () => {
		const app = createElysiaApi();
		try {
			for (const [encoded, decoded] of [['%25', '%'], ['%252F', '%2F']]) {
				const response = await app.fetch(new Request(`https://api.invalid/items/${encoded}`));
				deepStrictEqual(response.status, 200);
				deepStrictEqual(await response.json(), { id: decoded, kind: 'dynamic', tags: [] });
			}
		} finally {
			await app.close();
		}
	});
	for (const value of cases) {
		it(`matches the authored ${value.id} observation`, async () => {
			const app = createElysiaApi();
			try {
				deepStrictEqual(await observe(await app.fetch(request(value)), value), value.expected);
			} finally {
				await app.close();
			}
		});
	}
	it('keeps derived actors and lifecycle observations local to concurrent requests', async () => {
		const app = createElysiaApi();
		try {
			const values = ['owned-state-and-onion', 'state-isolation'].map((id) => {
				const value = cases.find((candidate) => candidate.id === id);
				if (value === undefined) throw new Error(`Missing authored concurrent request ${id}.`);
				return value;
			});
			const results = await Promise.allSettled(
				values.map(async (value) => await observe(await app.fetch(request(value)), value)),
			);
			for (const [index, result] of results.entries()) {
				if (result.status === 'rejected') throw result.reason;
				deepStrictEqual(result.value, values[index]!.expected);
			}
		} finally {
			await app.close();
		}
	});
	it('lets Elysia select static specificity when a parameter route was registered first', async () => {
		const app = createElysiaApi();
		try {
			const response = await app.fetch(new Request('https://api.invalid/priority/current'));
			deepStrictEqual(response.status, 200);
			deepStrictEqual(await response.json(), { selected: 'static' });
		} finally {
			await app.close();
		}
	});
	for (const count of [16, 256, 4096]) {
		it(`selects first, middle, late and absent routes in the native ${count}-route table`, async () => {
			const app = createElysiaRouting(count);
			try {
				for (const value of routingCases(count)) {
					deepStrictEqual(await observe(await app.fetch(request(value)), value), value.expected, value.id);
				}
			} finally {
				await app.close();
			}
		});
	}
});

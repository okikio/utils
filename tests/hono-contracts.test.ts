/** Compare pinned upstream observations with real APIs and explicit capability differences. @module */
import { deepStrictEqual, equal } from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applicationCases } from './fixtures/hono-contracts/applications.ts';
import { createHono, matchHono, readHono, respondHono } from './fixtures/hono-contracts/hono.ts';
import { requestCases } from './fixtures/hono-contracts/requests.ts';
import { responseCases } from './fixtures/hono-contracts/responses.ts';
import { routerCases } from './fixtures/hono-contracts/routes.ts';
import { observe } from './fixtures/hono-contracts/types.ts';
import { createUtils, matchUtils, readUtils, respondUtils } from './fixtures/hono-contracts/utils.ts';

describe('pinned Hono upstream HTTP observations', () => {
	for (const value of routerCases) {
		it(value.id, () => {
			deepStrictEqual(matchHono(value), value.expected, `${value.id}: upstream TrieRouter`);
			deepStrictEqual(matchUtils(value), value.utilsExpected ?? value.expected, `${value.id}: Utils route owner`);
		});
	}
	for (const value of requestCases) {
		it(value.id, async () => {
			deepStrictEqual(await readHono(value), value.expected, `${value.id}: upstream HonoRequest`);
			deepStrictEqual(
				await readUtils(value),
				value.utilsExpected ?? value.expected,
				`${value.id}: Utils request parser/composition`,
			);
		});
	}
	for (const value of responseCases) {
		it(value.id, async () => {
			deepStrictEqual(
				await observe(await respondHono(value), value.expected),
				value.expected,
				`${value.id}: upstream Context`,
			);
			deepStrictEqual(
				await observe(await respondUtils(value), value.expected),
				value.expected,
				`${value.id}: explicit Utils response assembly`,
			);
		});
	}
	for (const value of applicationCases) {
		it(value.id, async () => {
			const request = () =>
				new Request(new URL(value.path, 'http://localhost'), { method: value.method, headers: value.headers });
			deepStrictEqual(
				await observe(await createHono(value.application).fetch(request()), value.expected),
				value.expected,
				`${value.id}: upstream Hono app`,
			);
			const expected = value.utilsExpected ?? value.expected;
			deepStrictEqual(
				await observe(await createUtils(value.application).fetch(request()), expected),
				expected,
				`${value.id}: Utils Fetch app`,
			);
		});
	}
	it('every mapped vector states its source and every divergence has a reason', () => {
		const seen = new Set<string>();
		for (const value of [...routerCases, ...requestCases, ...responseCases, ...applicationCases]) {
			equal(seen.has(value.id), false, `Duplicate vector identity: ${value.id}`);
			seen.add(value.id);
			equal(Number.isSafeInteger(value.source.line) && value.source.line > 0, true, value.id);
			equal(value.source.path.startsWith('src/'), true, value.id);
			equal(value.source.title.length > 0, true, value.id);
			if ('utilsExpected' in value) {
				equal(
					'difference' in value && typeof value.difference === 'string' && value.difference.length > 0,
					true,
					value.id,
				);
			}
		}
	});
});

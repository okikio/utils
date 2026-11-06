/** Secret configuration diagnostics and unexpected validator defects remain distinct. @module */
import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import * as env from './standard.ts';

function validator(
	validate: StandardSchemaV1<unknown, string>['~standard']['validate'],
): StandardSchemaV1<unknown, string> {
	return { '~standard': { version: 1, vendor: 'fixture', validate } };
}

describe('environment diagnostic ownership', () => {
	it('redacts secret messages and paths in both synchronous and asynchronous results', async () => {
		const privateValue = 'secret-credential';
		const bad = validator(() => ({ issues: [{ message: privateValue, path: [privateValue] }] }));
		const definition = env.define({ TOKEN: env.secret(bad, { description: 'Access token.' }) });
		for (
			const result of [
				definition.safeParseSync({ TOKEN: privateValue }),
				await definition.safeParse({ TOKEN: privateValue }),
			]
		) {
			expect(result.success).toBe(false);
			expect(JSON.stringify(result)).not.toContain(privateValue);
		}
		expect(() => definition.parseSync({ TOKEN: privateValue })).toThrow('Invalid secret value.');
	});

	for (const method of ['parseSync', 'safeParseSync', 'parse'] as const) {
		it(`preserves the unexpected variable validator cause through ${method}`, async () => {
			const original = new TypeError('validator defect');
			const bad = validator(() => {
				throw original;
			});
			const definition = env.define({ VALUE: env.variable(bad, { description: 'A value.' }) });
			// Admit synchronous throws into the same awaited rejection assertion.
			const parsing = Promise.resolve().then(() => definition[method]({ VALUE: 'x' }));
			await expect(parsing).rejects.toBeInstanceOf(env.EnvironmentValidatorError);
			await expect(parsing).rejects.toMatchObject({ cause: original });
		});
	}

	it('redacts unexpected secret validator causes', async () => {
		const bad = validator(() => {
			throw new TypeError('private-credential');
		});
		const definition = env.define({ TOKEN: env.secret(bad, { description: 'Access token.' }) });
		const parsing = definition.parse({ TOKEN: 'x' });
		await expect(parsing).rejects.toBeInstanceOf(env.EnvironmentValidatorError);
		await expect(parsing).rejects.not.toHaveProperty('cause');
		await expect(parsing).rejects.not.toThrow('private-credential');
	});

	it('observes rejected asynchronous validation attempted through the synchronous API', async () => {
		const rejected = validator(async () => {
			throw new Error('late rejection');
		});
		const definition = env.define({ VALUE: env.variable(rejected, { description: 'A value.' }) });
		const result = definition.safeParseSync({ VALUE: 'x' });
		expect(result.success).toBe(false);
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
});

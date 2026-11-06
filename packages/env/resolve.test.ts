import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as schema from '@okikio/schema';
import * as env from './mod.ts';
import { EnvironmentSourceError, inspect, resolve } from './resolve.ts';

const limits = { maximumKeys: 8, maximumSources: 4 };
const Definition = env.define({
	PORT: env.variable(schema.coerce.number(), {
		description: 'Listener port',
		deprecated: true,
		replacement: 'HTTP_PORT',
	}),
	TOKEN: env.secret(schema.string(), { description: 'Credential' }),
});
describe('explicit configuration provenance', () => {
	it('reads each declared key once per source and reports sparse precedence without values', async () => {
		let reads = 0;
		const result = await resolve(Definition, [
			{ name: 'base', source: { PORT: '80', TOKEN: 'hidden' } },
			{
				name: 'override',
				source: {
					get(key) {
						reads++;
						return key === 'PORT' ? '443' : undefined;
					},
				},
			},
		], limits);
		expect(result.values.PORT).toBe(443);
		expect(result.values.TOKEN).toBe('hidden');
		expect(reads).toBe(2);
		expect(result.provenance[0]?.shadowed).toEqual([0]);
		expect(result.provenance[0]?.sourceIndex).toBe(1);
		expect(JSON.stringify(result.provenance).includes('hidden')).toBe(false);
	});
	it('does not infer default provenance or treat source failure as missing', async () => {
		const Defaults = env.define({
			VALUE: env.variable(schema.defaults(schema.optional(schema.string()), () => 'default'), {
				description: 'Optional default',
			}),
		});
		expect((await resolve(Defaults, [], limits)).provenance[0]?.selected).toBe('schema');
		let failure: unknown;
		try {
			await resolve(Definition, [{
				name: 'denied',
				source: {
					get() {
						throw new Error('permission secret-value');
					},
				},
			}], limits);
		} catch (error) {
			failure = error;
		}
		expect(failure).toBeInstanceOf(EnvironmentSourceError);
		expect(JSON.stringify(failure).includes('secret-value')).toBe(false);
		expect((failure as Error).cause).toBeUndefined();
	});
	it('reports unknown/deprecated keys and refuses unknown-key rejection without inventory', async () => {
		const sources = [{ name: 'supplied', source: { PORT: '80', TOKEN: 'hidden', OTHER: 'never report' } }];
		const report = await inspect(Definition, sources, { ...limits, unknownKeys: 'reject' });
		expect(report.valid).toBe(false);
		expect(report.unknown).toEqual(['OTHER']);
		expect(report.provenance[0]?.deprecated).toBe(true);
		expect(JSON.stringify(report).includes('hidden')).toBe(false);
		const pull = [{ name: 'pull', source: { get: (key: string) => sources[0]!.source[key as 'PORT'] } }];
		expect((await inspect(Definition, pull, { ...limits, unknownKeys: 'report' })).inventoryComplete).toBe(false);
		await expect(inspect(Definition, pull, { ...limits, unknownKeys: 'reject' })).rejects.toThrow(TypeError);
		await expect(resolve(Definition, sources, { ...limits, maximumKeys: 1 })).rejects.toThrow(RangeError);
	});
});

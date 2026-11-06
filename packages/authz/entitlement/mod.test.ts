import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import * as entitlement from '@okikio/authz/entitlement';
import * as context from '@okikio/context';

describe('@okikio/authz/entitlement', () => {
	it('defines stable metadata and reuses one requirement object per definition', () => {
		const definition = entitlement.define({ id: 'example', description: 'Example.' });
		expect(definition.kind).toBe('entitlement');
		expect(entitlement.is(definition)).toBe(true);
		expect(entitlement.is({ kind: 'entitlement', id: definition.id })).toBe(false);
		expect(entitlement.require(definition)).toBe(entitlement.require(definition));
		expect(entitlement.require(definition)).toMatchObject({ family: 'entitlement', action: 'require', definition });
	});

	it('derives identifiers and complete requirement catalogs from canonical entitlements', () => {
		const first = entitlement.define({ id: 'first' });
		const second = entitlement.define({ id: 'second' });
		const definitions = entitlement.catalog('plan', { First: first, Second: second });
		const ids = entitlement.ids(definitions);
		const requirements = entitlement.requirements(definitions);

		expect(ids).toEqual({ First: 'first', Second: 'second' });
		expect(requirements.First).toBe(entitlement.require(first));
		expect(requirements.Second).toBe(entitlement.require(second));
		expect(entitlement.has(definitions, first)).toBe(true);
		expect(entitlement.get(definitions, second.id)).toBe(second);
		expect(entitlement.get(definitions, 'missing')).toBeUndefined();
		const selected = entitlement.select(definitions, ['Second'] as const);
		expect(entitlement.ids(selected)).toEqual({ Second: 'second' });
		expect(entitlement.requirements(selected).Second).toBe(requirements.Second);
	});
});

it('interprets required entitlements as one ordered checker batch', async () => {
	const first = entitlement.define({ id: 'first' });
	const second = entitlement.define({ id: 'second' });
	const seen: string[][] = [];
	const interpreter = entitlement.interpreter({
		async check(_ctx, definitions) {
			seen.push(definitions.map((definition) => definition.id));
			return definitions.map(() => Object.freeze({ allowed: true as const }));
		},
	});
	await interpreter.apply({} as never, [entitlement.require(first), entitlement.require(second)]);
	expect(seen).toEqual([['first', 'second']]);
});

it('reports explicit entitlement denial without hiding checker faults', async () => {
	const definition = entitlement.define({ id: 'denied' });
	const interpreter = entitlement.interpreter({
		async check() {
			return [Object.freeze({ allowed: false as const, reason: 'Plan does not include this capability.' })];
		},
	});
	await expect(interpreter.apply({} as never, [entitlement.require(definition)]))
		.rejects.toBeInstanceOf(entitlement.EntitlementDeniedError);
});

describe('entitlement checker boundaries', () => {
	it('rejects forged definitions and enforces limits before calling policy', async () => {
		const Feature = entitlement.define({ id: 'feature' });
		expect(() => entitlement.require({ kind: 'entitlement', id: 'feature' } as never)).toThrow(TypeError);
		let called = false;
		const interpreter = entitlement.interpreter({
			maximumChecks: 1,
			async check() {
				called = true;
				return [];
			},
		});
		await using ctx = context.create({ id: 'entitlement' });
		await expect(interpreter.apply(ctx, [entitlement.require(Feature), entitlement.require(Feature)]))
			.rejects.toBeInstanceOf(entitlement.EntitlementCheckLimitError);
		expect(called).toBe(false);
	});
	it('rejects malformed batches without invoking getters and preserves checker errors', async () => {
		const Feature = entitlement.define({ id: 'feature' });
		const input = [entitlement.require(Feature)];
		await using ctx = context.create({ id: 'entitlement' });
		let reads = 0;
		const getter = {
			get allowed() {
				reads++;
				return true;
			},
		};
		for (
			const batch of [[], [null], [{}], [{ allowed: 'yes' }], [getter], new Array(1), [{
				allowed: true,
				error: 'conflict',
			}]]
		) {
			const interpreter = entitlement.interpreter({
				async check() {
					return batch as never;
				},
			});
			await expect(interpreter.apply(ctx, input)).rejects.toBeInstanceOf(entitlement.EntitlementDecisionError);
		}
		expect(reads).toBe(0);
		const error = new Error('Policy unavailable.');
		const interpreter = entitlement.interpreter({
			async check() {
				return [{ error }];
			},
		});
		await expect(interpreter.apply(ctx, input)).rejects.toBe(error);
	});
});

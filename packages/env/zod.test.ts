import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import { z } from 'zod';

import * as env from './zod.ts';

describe('environment adapter authoring records', () => {
	it('rejects hidden adapter inputs instead of widening the inferred field map', () => {
		const VisibleSchema = z.string().describe('VisibleSchema value.');
		const HiddenSchema = z.string().describe('HiddenSchema value.');
		const inputs = { VISIBLE: VisibleSchema } as { VISIBLE: typeof VisibleSchema; HIDDEN: typeof HiddenSchema };
		Object.defineProperty(inputs, 'HIDDEN', { value: HiddenSchema, enumerable: false });
		expect(() => env.define(inputs)).toThrow('enumerable data property');
	});
});

describe('Zod environment authoring', () => {
	it('accepts a bare schema as a variable and reads native metadata', () => {
		const PortSchema = z.coerce.number().int().positive().default(8787).meta({
			title: 'HTTP port',
			description: 'PortSchema used by the service listener.',
			examples: ['8787'],
		});
		const definition = env.define({ PORT: PortSchema });

		expect(definition.parseSync({ PORT: '4321' })).toEqual({ PORT: 4321 });
		expect(env.manifest(definition).variables).toEqual([{
			key: 'PORT',
			kind: 'variable',
			title: 'HTTP port',
			description: 'PortSchema used by the service listener.',
			example: '8787',
		}]);
	});

	it('reads descriptions added through Zod describe()', () => {
		const definition = env.environment({
			MODE: z.enum(['development', 'production']).describe('Service runtime mode.'),
		});

		expect(env.manifest(definition).variables[0]?.description).toBe('Service runtime mode.');
	});

	it('lets explicit environment metadata override schema metadata', () => {
		const PortSchema = z.string().meta({
			title: 'Generic port',
			description: 'Generic schema description.',
			examples: ['8787'],
		});
		const definition = env.define({
			PORT: env.variable(PortSchema, {
				description: 'Public listener port for this service.',
				example: '4321',
			}),
		});

		expect(env.manifest(definition).variables[0]).toEqual({
			key: 'PORT',
			kind: 'variable',
			title: 'Generic port',
			description: 'Public listener port for this service.',
			example: '4321',
		});
	});

	it('keeps secret classification explicit and suppresses schema examples', () => {
		const TokenSchema = z.string().min(1).meta({
			description: 'Provider API token.',
			examples: ['schema-example-that-must-not-be-projected'],
		});
		const definition = env.define({ TOKEN: env.secret(TokenSchema) });

		expect(env.manifest(definition).secrets).toEqual([{
			key: 'TOKEN',
			kind: 'secret',
			description: 'Provider API token.',
		}]);
		expect(env.example(definition)).toContain('TOKEN=<secret>');
		expect(env.example(definition)).not.toContain('schema-example-that-must-not-be-projected');
	});

	it('reuses one canonical field for a repeated bare schema object', () => {
		const RegionSchema = z.string().describe('Deployment region.');
		const first = env.define({ REGION: RegionSchema });
		const second = env.define({ REGION: RegionSchema });

		expect(env.compose(first, second).fields.REGION).toBe(first.fields.REGION);
	});

	it('rejects bare schemas that do not explain their environment meaning', () => {
		expect(() => env.define({ OPAQUE: z.string() })).toThrow(/requires a description/);
	});
});

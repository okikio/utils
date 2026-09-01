import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import type { StandardSchemaV1 } from '@standard-schema/spec';

import * as problem from './mod.ts';
import * as problemTesting from './testing/mod.ts';

describe('HTTP problem', () => {
	it('creates RFC 9457 tuples and prevents canonical extension overrides', () => {
		const NotFound = problem.define({
			id: 'widgets:not-found',
			type: 'https://api.example.invalid/problems/widget-not-found',
			status: 404,
			title: 'Widget not found',
			description: 'The requested widget does not exist.',
		});
		const result = problem.create(NotFound, { detail: 'Missing widget.', extensions: { widget_id: 'widget_1' } });
		expect(result[0]).toEqual({
			type: NotFound.type,
			title: NotFound.title,
			status: 404,
			detail: 'Missing widget.',
			widget_id: 'widget_1',
		});
		expect(problem.is(result, NotFound)).toBe(true);
		expect(() => problem.create(NotFound, { extensions: { status: 500 } })).toThrow(TypeError);
	});

	it('preserves caller-authored extension metadata while snapshotting the contract', () => {
		const extensionSchema = {
			'~standard': {
				version: 1,
				vendor: 'test',
				validate(value: unknown) {
					return { value };
				},
			},
		} satisfies StandardSchemaV1;
		const extensions = {
			schema: extensionSchema,
			description: 'Widget problem extension fields.',
			documentationKey: 'widget',
		} as const;
		const definition = problem.define({
			id: 'widgets:extension-contract',
			type: 'https://api.example.invalid/problems/widget-extension-contract',
			status: 400,
			title: 'Widget extension contract',
			description: 'A problem used to verify extension contract snapshots.',
			extensions,
		});
		const definitionExtensions = definition.extensions;
		if (definitionExtensions === undefined) throw new Error('Problem definition dropped its extension contract.');
		const documentationKey: 'widget' = definitionExtensions.documentationKey;

		expect(definitionExtensions).toEqual(extensions);
		expect(definitionExtensions).not.toBe(extensions);
		expect(Object.isFrozen(definitionExtensions)).toBe(true);
		expect(documentationKey).toBe('widget');
	});

	it('keeps occurrence identity private and rejects lookalike tuples', () => {
		const NotFound = problem.define({
			id: 'widgets:not-found-private',
			type: 'https://problems.example.invalid/not-found-private',
			status: 404,
			title: 'Not found',
			description: 'The widget does not exist.',
		});
		const cause = new Error('database miss');
		const result = problem.create(NotFound, { cause });
		expect(problem.is(result)).toBe(true);
		expect(problem.is([result[0], 404, result[2]])).toBe(false);
		expect(problem.definitionOf(result)).toBe(NotFound);
		expect(problem.causeOf(result)).toBe(cause);
	});

	it('requires exhaustive problem behavior registrations before invoking them', () => {
		const Problems = problem.catalog('coverage', {
			First: problem.define({
				id: 'coverage:first', type: 'https://api.example.invalid/problems/coverage-first', status: 400,
				title: 'First coverage problem', description: 'First problem used by the coverage test.',
			}),
			Second: problem.define({
				id: 'coverage:second', type: 'https://api.example.invalid/problems/coverage-second', status: 409,
				title: 'Second coverage problem', description: 'Second problem used by the coverage test.',
			}),
		});
		const registered: string[] = [];
		const report = problemTesting.coverage(Problems, {
			First: () => registered.push('First'),
			Second: () => registered.push('Second'),
		});
		expect(report).toEqual({ declared: 2, covered: 2, missing: [], extra: [] });
		expect(registered).toEqual(['First', 'Second']);
		expect(() => problemTesting.coverage(Problems, { First: () => registered.push('unexpected') } as never))
			.toThrow(problemTesting.ProblemCoverageError);
		expect(registered).toEqual(['First', 'Second']);
	});

	it('rejects invalid definitions and canonical extension collisions', () => {
		expect(() => problem.define({
			id: 'invalid', type: '/relative', status: 400, title: 'Invalid', description: 'Invalid URI.',
		})).toThrow(TypeError);
		expect(() => problem.define({
			id: 'invalid', type: 'https://api.example.invalid/problems/invalid', status: 200,
			title: 'Invalid', description: 'Invalid status.',
		})).toThrow(TypeError);
	});
	it('resolves stable problem URLs below a caller-owned namespace', () => {
		expect(problem.url('https://problems.example.invalid/v1', 'widget-not-found'))
			.toBe('https://problems.example.invalid/v1/widget-not-found');
	});
	it('creates a reusable problem namespace resolver', () => {
		const types = problem.namespace('https://problems.example.invalid/v1');
		expect(types('not-found')).toBe('https://problems.example.invalid/v1/not-found');
		expect(types('/invalid-input')).toBe('https://problems.example.invalid/v1/invalid-input');
	});

});

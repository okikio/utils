import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import * as catalog from '@okikio/collection/catalog';
import * as requirement from './mod.ts';

const Network = Object.freeze({ kind: 'permission', id: 'network', description: 'Network access.' });

describe('@okikio/capability/requirement', () => {
	it('projects canonical catalogs into key-preserving memoized requirements', () => {
		const Audit = Object.freeze({ kind: 'permission', id: 'audit', description: 'Audit access.' });
		const definitions = catalog.create('permission.test', { Network, Audit });
		const selected = catalog.select(definitions, ['Audit'] as const);
		const requirements = requirement.catalog(definitions, { family: 'permission', action: 'require' });
		const selectedRequirements = requirement.catalog(selected, { family: 'permission', action: 'require' });

		expect(requirements.Network).toBe(
			requirement.define({ family: 'permission', action: 'require', definition: Network }),
		);
		expect(requirements.Audit.definition).toBe(Audit);
		expect(selectedRequirements.Audit).toBe(requirements.Audit);
		expect(Object.keys(selectedRequirements)).toEqual(['Audit']);
	});
});

it('keeps delimiter-containing requirement identities distinct', () => {
	const definition = Object.freeze({ kind: 'permission', id: 'shared:definition' });
	const first = requirement.define({ family: 'a:b', action: 'c', definition });
	const second = requirement.define({ family: 'a', action: 'b:c', definition });
	expect(first).not.toBe(second);
	expect(first.id).not.toBe(second.id);
	expect(second.family).toBe('a');
	expect(second.action).toBe('b:c');
	expect(requirement.define({ family: 'a:b', action: 'c', definition })).toBe(first);
});

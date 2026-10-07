import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import * as catalog from '@okikio/catalog';
import * as requirement from './mod.ts';

const Network = Object.freeze({ kind: 'permission', id: 'network', description: 'Network access.' });

describe('@okikio/requirement', () => {
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

import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import * as requirement from './mod.ts';

const Network = Object.freeze({ kind: 'permission', id: 'network', description: 'Network access.' });

describe('@okikio/requirement', () => {
	it('defines and documents provider-neutral requirement metadata', () => {
		const value = requirement.define({ family: 'permission', action: 'require', definition: Network });
		expect(requirement.define({ family: 'permission', action: 'require', definition: Network })).toBe(value);
		expect(value.id).toBe('permission:require:network');
		expect(requirement.document(value)).toEqual([{
			id: 'permission:require:network',
			family: 'permission',
			action: 'require',
			definition: 'network',
			definitionKind: 'permission',
		}]);
	});

	it('projects one semantic family without interpreting it', () => {
		const permission = requirement.define({ family: 'permission', action: 'require', definition: Network });
		const meter = requirement.define({ family: 'meter', action: 'record', definition: { kind: 'meter', id: 'bytes' } });
		expect(requirement.family([permission, meter], 'permission')).toEqual([permission]);
	});
});

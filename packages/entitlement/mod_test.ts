import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import * as entitlement from './mod.ts';

describe('@okikio/entitlement', () => {
	it('defines stable metadata and reuses one requirement object per definition', () => {
		const definition = entitlement.define({ id: 'example', description: 'Example.' });
		expect(definition.kind).toBe('entitlement');
		expect(entitlement.require(definition)).toBe(entitlement.require(definition));
		expect(entitlement.require(definition)).toMatchObject({ family: 'entitlement', action: 'require', definition });
	});
});

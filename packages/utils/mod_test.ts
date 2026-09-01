import { expect } from '@std/expect';
import { describe, it } from 'node:test';

import { packages } from './mod.ts';

describe('@okikio/utils package inventory', () => {
	it('contains every focused utility exactly once', () => {
		expect(new Set(packages).size).toBe(packages.length);
		expect(packages).toContain('@okikio/queue');
		expect(packages).toContain('@okikio/workflow');
	});
});

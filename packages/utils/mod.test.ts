import { expect } from '@std/expect';
import { describe, it } from 'node:test';

import { packages } from './mod.ts';

describe('@okikio/utils package inventory', () => {
	it('contains focused utilities exactly once without removed packages', () => {
		expect(new Set(packages).size).toBe(packages.length);
		expect(packages).toContain('@okikio/queue');
		expect(packages).toContain('@okikio/workflow');
		expect(packages).toContain('@okikio/telemetry');
		expect(packages).not.toContain('@okikio/hash');
	});
});

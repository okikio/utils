import { expect } from '@std/expect';
import { describe, it } from 'node:test';

import { packages } from './mod.ts';
import * as forwarded from './duration.ts';
import * as duration from '@okikio/duration';
import * as forwardedResult from './result.ts';
import * as result from '@okikio/result';

describe('@okikio/utils package inventory', () => {
	it('contains focused utilities exactly once', () => {
		expect(new Set(packages).size).toBe(packages.length);
		expect(packages).toContain('@okikio/scheduler');
		expect(packages).toContain('@okikio/workflow');
		expect(packages).toContain('@okikio/telemetry');
		for (const name of ['hash', 'input', 'authz']) expect(packages).toContain(`@okikio/${name}`);
	});
});

describe('focused facade contracts', () => {
	it('forwards the same implementation and preserves duration units and expected failures', () => {
		expect(forwarded.elapsed).toBe(duration.elapsed);
		expect(forwarded.elapsed(forwarded.sec(1.5))).toBe(1500);
		expect(forwardedResult.all).toBe(result.all);
		const missing = result.fail('missing');
		expect(forwardedResult.all([result.ok(1), missing])).toBe(missing);
	});
});

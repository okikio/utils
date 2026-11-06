import { it } from 'node:test';
import { expect } from '@std/expect';
import { Budget } from './_budget.ts';
const policy = { maximumMessageBytes: 600, maximumInFlightBytes: 1000, maximumNodes: 100 };
it('charges UTF-8 and binary backing stores once per message, keeps detached liabilities and replaces representations', () => {
	const buffer = new ArrayBuffer(512), view = new Uint8Array(buffer, 1, 2);
	const owner = new Budget(policy);
	const held = owner.hold({ a: buffer, b: view }, [buffer, buffer]);
	held.replace({ a: buffer, b: view }, [buffer]);
	structuredClone(buffer, { transfer: [buffer] });
	expect(buffer.byteLength).toBe(0);
	expect(() => owner.hold(new ArrayBuffer(500))).toThrow(RangeError);
	held.close();
	held.close();
	const next = owner.hold(new ArrayBuffer(500));
	next.close();
	expect(() => owner.hold('🙂'.repeat(151))).toThrow(RangeError);
});
it('rejects accessors, unsupported host types, large bigints and deeply nested graphs without invoking callbacks', () => {
	const owner = new Budget({ ...policy, maximumDepth: 2 });
	let read = false;
	expect(() =>
		owner.hold({
			get secret() {
				read = true;
				return 'secret';
			},
		})
	).toThrow(TypeError);
	expect(read).toBe(false);
	expect(() => owner.hold({ a: { b: { c: 'x' } } })).toThrow(RangeError);
	expect(() => owner.hold(1n << 100n)).toThrow(RangeError);
	expect(() => owner.hold(new URL('https://local.invalid'))).toThrow(TypeError);
	const cycle: { self?: unknown } = {};
	cycle.self = cycle;
	const lease = owner.hold(cycle);
	lease.close();
});

it('uses native collection and binary accessors without calling overrides', () => {
	const owner = new Budget(policy);
	const map = new Map([['key', 'value']]);
	Object.defineProperty(map, Symbol.iterator, {
		value: () => {
			throw new Error('custom iterator');
		},
	});
	const buffer = new ArrayBuffer(512);
	Object.defineProperty(buffer, 'byteLength', {
		get: () => {
			throw new Error('custom getter');
		},
	});
	const view = new Uint8Array(buffer);
	Object.defineProperty(view, 'buffer', {
		get: () => {
			throw new Error('custom getter');
		},
	});
	const lease = owner.hold({ map, view });
	lease.close();
});

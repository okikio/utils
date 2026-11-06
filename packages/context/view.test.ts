import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as context from './mod.ts';
import { noop } from '@okikio/telemetry/instrument';

describe('context views retain source capabilities', () => {
	it('borrows instrumentation across local children and restores it explicitly', async () => {
		await using parent = context.create({ id: 'instrumented-context', instrument: noop });
		await using child = context.child(parent);
		const view = context.view(child, { label: 'observed' });
		expect(parent.instrument).toBe(noop);
		expect(child.instrument).toBe(noop);
		expect(view.instrument).toBe(noop);
		const saved = context.snapshot(view);
		expect(Object.hasOwn(saved, 'instrument')).toBe(false);
		await using restored = context.restore(saved);
		await using observed = context.restore(saved, { instrument: noop });
		expect(restored.instrument).toBe(undefined);
		expect(observed.instrument).toBe(noop);
	});

	it('delegates inherited getters, private-field methods, non-enumerable data and symbols', async () => {
		await using owned = context.create({ id: 'class-view' });
		const symbol = Symbol('capability');
		class Capability {
			#value = 3;
			get amount() {
				return this.#value;
			}
			increment() {
				return ++this.#value;
			}
		}
		const base = Object.assign(new Capability(), owned);
		Object.defineProperty(base, 'hidden', { value: 'present', enumerable: false });
		Object.defineProperty(base, symbol, { value: 7 });
		const view = context.view(base, { label: 'read' as const });
		expect(view.amount).toBe(3);
		expect(view.increment()).toBe(4);
		expect(view.amount).toBe(4);
		expect(Reflect.get(view, 'hidden')).toBe('present');
		expect(Reflect.get(view, symbol)).toBe(7);
		expect(view.increment).toBe(view.increment);
		expect(Object.isFrozen(view)).toBe(true);
		expect(Object.keys(view)).not.toContain('hidden');
	});

	it('delegates extension getters and supports explicit shallow capability overrides', async () => {
		await using owned = context.create({ id: 'extension-view' });
		let reads = 0;
		const extension = {
			get value() {
				reads++;
				return reads;
			},
		};
		const view = context.view(owned, extension);
		expect(reads).toBe(0);
		expect(view.value).toBe(1);
		expect(view.value).toBe(2);
		const replaced = context.view(view, { value: 'replacement' });
		expect(replaced.value).toBe('replacement');
		const text: string = replaced.value;
		void text;
		const nested = context.view(view, { other: true });
		expect(nested.value).toBe(3);
		context.cancel(nested, 'finished');
		expect(owned.signal.aborted).toBe(true);
	});
});

import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { SuppressedError } from '@okikio/dispose';
import { gestures, keys, pointer } from './mod.ts';
import type { BindingHandle, ListenerOptions, ListenerTarget } from './types.ts';

/** A host can run callbacks while it registers a listener, unlike an ordinary DOM EventTarget. */
class Target implements ListenerTarget {
	readonly listeners = new Map<string, Set<(event: unknown) => void>>();
	readonly removed: string[] = [];
	before?: () => void;
	after?: () => void;
	cleanup?: () => void;
	addEventListener(type: string, listener: (event: unknown) => void): void {
		this.before?.();
		const listeners = this.listeners.get(type) ?? new Set();
		listeners.add(listener);
		this.listeners.set(type, listeners);
		this.after?.();
	}
	removeEventListener(type: string, listener: (event: unknown) => void, options?: boolean | ListenerOptions): void {
		this.listeners.get(type)?.delete(listener);
		this.removed.push(`${type}:${typeof options === 'boolean' ? options : options?.capture ?? false}`);
		this.cleanup?.();
	}
	get size(): number {
		return [...this.listeners.values()].reduce((size, listeners) => size + listeners.size, 0);
	}
}

/** Each public input capability must honor the same owner without requiring browser constructors. */
const bindings: Readonly<Record<string, (target: ListenerTarget, signal: AbortSignal) => BindingHandle>> = {
	keys: (target, signal) => keys.listen(target, [], { signal }),
	pointer: (target, signal) => pointer.listen(target, { signal }),
	swipe: (target, signal) => gestures.swipe(target, () => {}, { signal }),
};

describe('input registration lifetime on small hosts', () => {
	for (const [name, bind] of Object.entries(bindings)) {
		for (const timing of ['before', 'after'] as const) {
			it(`${name} releases a listener when registration aborts ${timing} retaining it`, () => {
				const target = new Target();
				const owner = new AbortController();
				target[timing] = () => owner.abort();
				const stop = bind(target, owner.signal);
				expect(stop.closed).toBe(true);
				expect(target.size).toBe(0);
				expect(target.removed).toHaveLength(1);
				stop();
				expect(target.removed).toHaveLength(1);
			});
		}
	}

	it('unwinds retained listeners when registration throws', () => {
		const target = new Target();
		const failure = new Error('registration failed after retaining the listener');
		target.after = () => {
			throw failure;
		};
		expect(() => keys.listen(target, [], { capture: true })).toThrow(failure);
		expect(target.size).toBe(0);
		expect(target.removed).toEqual(['keydown:true']);
	});

	it('retains setup and cleanup failures if a mock aborts and then throws', () => {
		const target = new Target();
		const owner = new AbortController();
		const setup = new Error('setup');
		const cleanup = new Error('cleanup');
		target.before = () => owner.abort();
		target.after = () => {
			throw setup;
		};
		target.cleanup = () => {
			throw cleanup;
		};
		let failure: unknown;
		try {
			keys.listen(target, [], { signal: owner.signal });
		} catch (error) {
			failure = error;
		}
		expect(failure).toBeInstanceOf(SuppressedError);
		expect((failure as SuppressedError).error).toBe(cleanup);
		expect((failure as SuppressedError).suppressed).toBe(setup);
		expect(target.size).toBe(0);
	});
});

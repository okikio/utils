import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { listen } from './keys.ts';
import * as commands from './commands.ts';
import type { KeyEvent, ListenerTarget } from './types.ts';

/** Tiny host deliberately has no Window, document, Element, or signal-aware listener options. */
class Surface implements ListenerTarget {
	readonly listeners = new Map<string, Set<(event: unknown) => void>>();
	addEventListener(type: string, listener: (event: unknown) => void): void {
		let values = this.listeners.get(type);
		if (values === undefined) {
			values = new Set();
			this.listeners.set(type, values);
		}
		values.add(listener);
	}
	removeEventListener(type: string, listener: (event: unknown) => void): void {
		this.listeners.get(type)?.delete(listener);
	}
	emit(type: string, event: unknown): void {
		for (const listener of this.listeners.get(type) ?? []) listener(event);
	}
	press(key: string, extra: Partial<KeyEvent> = {}): boolean {
		const event = {
			key,
			defaultPrevented: false,
			preventDefault() {
				this.defaultPrevented = true;
			},
			...extra,
		};
		this.emit('keydown', event);
		return event.defaultPrevented;
	}
}

describe('portable scoped keyboard ownership', () => {
	it('uses small hosts without casts, snapshots bindings and disposes idempotently', () => {
		const surface = new Surface();
		let calls = 0;
		const command = commands.define({
			id: 'next',
			label: 'Next',
			invoke: () => {
				calls++;
			},
		});
		const bindings = [{ run: () => command.invoke(), key: 'J' }];
		const stop = listen(surface, bindings);
		bindings[0]!.key = 'x';
		expect(surface.press('j')).toBe(true);
		expect(surface.press('j', { repeat: true })).toBe(false);
		stop();
		stop();
		expect(stop.closed).toBe(true);
		expect(surface.press('j')).toBe(false);
		expect(calls).toBe(1);
		expect([...surface.listeners.values()].every((values) => values.size === 0)).toBe(true);
	});

	it('preserves key/code distinction and exact modifier ownership', () => {
		const surface = new Surface();
		const called: string[] = [];
		const action = (id: string) =>
			commands.define({
				id,
				label: id,
				invoke: () => {
					called.push(id);
				},
			});
		using _stop = listen(surface, [
			{ run: () => action('physical').invoke(), code: 'KeyQ', shift: true },
			{ run: () => action('logical').invoke(), key: 'q', mod: true },
		]);
		expect(surface.press('a', { code: 'KeyQ', shiftKey: true })).toBe(true);
		expect(surface.press('q', { ctrlKey: true })).toBe(true);
		expect(surface.press('q', { metaKey: true })).toBe(true);
		expect(surface.press('q', { metaKey: true, altKey: true })).toBe(false);
		expect(surface.press('q', { metaKey: true, shiftKey: true })).toBe(false);
		expect(called).toEqual(['physical', 'logical', 'logical']);
	});

	it('honors scopes, priorities, enabled commands and sequence ownership', () => {
		const surface = new Surface();
		let scopes = ['modal', 'global'];
		let enabled = true;
		const calls: string[] = [];
		const action = (id: string) =>
			commands.define({
				id,
				label: id,
				invoke: () => {
					calls.push(id);
				},
			});
		using _stop = listen(surface, [
			{ run: () => action('global').invoke(), key: 'j', priority: 1000 },
			{ run: () => action('modal').invoke(), key: 'j', scope: 'modal' },
			{
				enabled: () => enabled,
				run: () => {
					calls.push('sequence');
				},
				key: 'g g g',
			},
		], { scopes: () => scopes });
		surface.press('j');
		scopes = ['global'];
		surface.press('j');
		surface.press('g');
		surface.press('g');
		surface.press('g');
		enabled = false;
		expect(surface.press('g')).toBe(false);
		expect(calls).toEqual(['modal', 'global', 'sequence']);
	});

	it('clears a sequence on composition, focus changes, timeout and owner cancellation', async () => {
		const surface = new Surface();
		const controller = new AbortController();
		let calls = 0;
		const command = commands.define({
			id: 'home',
			label: 'Home',
			invoke: () => {
				calls++;
			},
		});
		const stop = listen(surface, [{ run: () => command.invoke(), key: 'g g' }], {
			signal: controller.signal,
			sequenceMs: 5,
		});
		surface.press('g');
		surface.emit('compositionstart', {});
		surface.press('g');
		expect(calls).toBe(0);
		surface.emit('blur', {});
		surface.press('g');
		await new Promise((resolve) => setTimeout(resolve, 15));
		surface.press('g');
		expect(calls).toBe(0);
		controller.abort();
		expect(stop.closed).toBe(true);
		expect(surface.press('g')).toBe(false);
	});

	it('detects editable mock and shadow paths and allows an explicit editing shortcut', () => {
		const surface = new Surface();
		let calls = 0;
		const command = commands.define({
			id: 'edit',
			label: 'Edit',
			invoke: () => {
				calls++;
			},
		});
		using _stop = listen(surface, [{ run: () => command.invoke(), key: 'j' }, {
			run: () => command.invoke(),
			key: 's',
			mod: true,
			editable: true,
		}]);
		const editor = { getAttribute: (name: string) => name === 'contenteditable' ? 'plaintext-only' : null };
		expect(surface.press('j', { target: editor })).toBe(false);
		expect(surface.press('j', { target: {}, composedPath: () => [editor, {}] })).toBe(false);
		expect(surface.press('s', { target: editor, ctrlKey: true })).toBe(true);
		expect(surface.press('s', { isComposing: true, ctrlKey: true })).toBe(false);
		expect(calls).toBe(1);
	});

	it('rejects colliding prefixes and invalid configuration before attaching a host listener', () => {
		const surface = new Surface();
		const command = commands.define({ id: 'test', label: 'Test', invoke() {} });
		expect(() =>
			listen(surface, [{ run: () => command.invoke(), key: 'g' }, { run: () => command.invoke(), key: 'g g' }])
		).toThrow(TypeError);
		expect(() =>
			listen(surface, [{ run: () => command.invoke(), key: 'g', mod: false }, {
				run: () => command.invoke(),
				key: 'g',
			}])
		).toThrow(TypeError);
		expect(() =>
			listen(surface, [{ run: () => command.invoke(), key: 'g', mod: true }, {
				run: () => command.invoke(),
				key: 'g',
				control: true,
			}])
		).toThrow(
			TypeError,
		);
		expect(() => listen(surface, [{ run: () => command.invoke(), key: '' }])).toThrow(TypeError);
		expect(() => listen(surface, [], { sequenceMs: 0 })).toThrow(RangeError);
		expect(surface.listeners.size).toBe(0);
	});

	it('unwinds partial listener setup without requiring mock AbortSignal support', () => {
		const surface = new Surface();
		const original = surface.addEventListener.bind(surface);
		surface.addEventListener = (type, listener) => {
			original(type, listener);
			if (type === 'blur') throw new Error('host failure');
		};
		expect(() => listen(surface, [])).toThrow('host failure');
		expect([...surface.listeners.values()].every((values) => values.size === 0)).toBe(true);
	});
});

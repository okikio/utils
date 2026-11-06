import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { listen } from './pointer.ts';
import type { PointerInput, PointerTarget } from './types.ts';

/** Structural surface records capture and requires no browser globals. */
class Surface implements PointerTarget {
	readonly listeners = new Map<string, Set<(event: unknown) => void>>();
	readonly captures: string[] = [];
	addEventListener(type: string, listener: (event: unknown) => void): void {
		let group = this.listeners.get(type);
		if (group === undefined) {
			group = new Set();
			this.listeners.set(type, group);
		}
		group.add(listener);
	}
	removeEventListener(type: string, listener: (event: unknown) => void): void {
		this.listeners.get(type)?.delete(listener);
	}
	setPointerCapture(id: number): void {
		this.captures.push(`take:${id}`);
	}
	releasePointerCapture(id: number): void {
		this.captures.push(`release:${id}`);
	}
	emit(type: string, extra: Partial<PointerInput> = {}): boolean {
		const event = {
			pointerId: 1,
			clientX: 10,
			clientY: 20,
			defaultPrevented: false,
			preventDefault() {
				this.defaultPrevented = true;
			},
			...extra,
		};
		for (const listener of this.listeners.get(type) ?? []) listener(event);
		return event.defaultPrevented;
	}
}

describe('pointer session ownership', () => {
	it('preserves native default by default and releases capture before normal completion', () => {
		const surface = new Surface();
		let time = 0;
		const events: string[] = [];
		using _stop = listen(surface, {
			capture: true,
			now: () => time,
			move: ({ x, elapsed }) => events.push(`${x}:${elapsed}`),
			end: ({ x }) => events.push(`end:${x}:${surface.captures.at(-1)}`),
		});
		expect(surface.emit('pointerdown')).toBe(false);
		time = 20;
		expect(surface.emit('pointermove', { clientX: 40 })).toBe(false);
		surface.emit('pointerup', { clientX: 50 });
		expect(events).toEqual(['30:20', 'end:40:release:1']);
		expect(surface.captures).toEqual(['take:1', 'release:1']);
	});

	it('cancels on lost capture, host cancellation, extra pointers and disposal', () => {
		const surface = new Surface();
		const reasons: string[] = [];
		const stop = listen(surface, { capture: true, cancel: (_, reason) => reasons.push(reason) });
		surface.emit('pointerdown');
		surface.emit('lostpointercapture');
		surface.emit('pointerdown');
		surface.emit('pointercancel');
		surface.emit('pointerdown');
		surface.emit('pointerdown', { pointerId: 2 });
		surface.emit('pointerup');
		surface.emit('pointerup', { pointerId: 2 });
		surface.emit('pointerdown');
		stop();
		stop();
		expect(reasons).toEqual(['lostcapture', 'pointercancel', 'multiple-pointers', 'disposed']);
		expect([...surface.listeners.values()].every((group) => group.size === 0)).toBe(true);
	});

	it('acquires nothing for rejected starts or pre-aborted owners', () => {
		const surface = new Surface();
		using _rejected = listen(surface, { capture: true, preventDefault: true, start: () => false });
		expect(surface.emit('pointerdown')).toBe(false);
		expect(surface.captures).toEqual([]);
		const signal = AbortSignal.abort();
		const stopped = listen(new Surface(), { signal });
		expect(stopped.closed).toBe(true);
	});

	it('requires selected capture capabilities and cancels defaults only after explicit acceptance', () => {
		const surface = new Surface();
		using _stop = listen(surface, { preventDefault: true });
		expect(surface.emit('pointerdown')).toBe(true);
		expect(surface.emit('pointermove')).toBe(true);
		const mock = { addEventListener() {}, removeEventListener() {} };
		expect(() => listen(mock, { capture: true })).toThrow(TypeError);
	});
});

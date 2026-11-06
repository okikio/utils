import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as gamepad from './gamepad.ts';

/** A deterministic scheduler proves one outstanding frame and exact cancellation without a browser timer. */
class Frames implements gamepad.Frames {
	readonly queued = new Map<number, (time: number) => void>();
	id = 0;
	requestAnimationFrame(callback: (time: number) => void): number {
		const id = ++this.id;
		this.queued.set(id, callback);
		return id;
	}
	cancelAnimationFrame(id: number): void {
		this.queued.delete(id);
	}
	tick(): void {
		const callbacks = [...this.queued.values()];
		this.queued.clear();
		for (const callback of callbacks) callback(0);
	}
}

describe('gamepad values and polling ownership', () => {
	it('detaches snapshots, applies a deadzone and ignores timestamp-only changes', () => {
		const device = {
			id: 'controller',
			index: 0,
			connected: true,
			timestamp: 0,
			axes: [0.05, 0.55],
			buttons: [{ value: 0, pressed: false }],
		};
		const host = { getGamepads: () => [device, null] };
		const frames = new Frames();
		const seen: (readonly gamepad.Snapshot[])[] = [];
		const stop = gamepad.watch(host, frames, (value) => seen.push(value));
		expect(seen[0]?.[0]?.axes[0]).toBe(0);
		expect(seen[0]?.[0]?.axes[1]).toBeCloseTo(0.5);
		expect(frames.queued.size).toBe(1);
		device.timestamp++;
		frames.tick();
		expect(seen).toHaveLength(1);
		device.buttons[0]!.pressed = true;
		frames.tick();
		expect(seen).toHaveLength(2);
		expect(seen[0]?.[0]?.buttons[0]?.pressed).toBe(false);
		device.connected = false;
		frames.tick();
		expect(seen.at(-1)).toEqual([]);
		stop();
		expect(frames.queued.size).toBe(0);
	});

	it('completes an Observable on source abort and acquires nothing for pre-aborted watchers', () => {
		const frames = new Frames();
		const screen = new AbortController();
		let reads = 0, completed = false;
		const host = {
			getGamepads() {
				reads++;
				return [];
			},
		};
		using subscription = gamepad.observe(host, frames, { signal: screen.signal }).subscribe({
			complete: () => {
				completed = true;
			},
		});
		screen.abort();
		expect(completed).toBe(true);
		expect(frames.queued.size).toBe(0);
		const prior = reads;
		const stop = gamepad.watch(host, frames, () => {}, { signal: screen.signal });
		expect(stop.closed).toBe(true);
		expect(reads).toBe(prior);
		void subscription;
	});

	it('rejects unsupported sources and bounded control violations explicitly', () => {
		expect(() => gamepad.read({})).toThrow('does not provide');
		expect(() => gamepad.read({ getGamepads: () => [] }, { deadzone: 1 })).toThrow(RangeError);
		expect(() => gamepad.read({ getGamepads: () => [null, null] }, { maxDevices: 1 })).toThrow(RangeError);
	});

	it('releases a frame registered by a host that aborts during requestAnimationFrame', () => {
		const screen = new AbortController();
		const frames = new Frames();
		const schedule = frames.requestAnimationFrame.bind(frames);
		frames.requestAnimationFrame = (callback) => {
			screen.abort();
			return schedule(callback);
		};
		const stop = gamepad.watch({ getGamepads: () => [] }, frames, () => {}, { signal: screen.signal });
		expect(stop.closed).toBe(true);
		expect(frames.queued.size).toBe(0);
	});
});

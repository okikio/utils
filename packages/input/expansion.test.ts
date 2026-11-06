import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { clipboard, files, gamepad, pointer, text } from './mod.ts';

describe('pointer normalization', () => {
	it('retains native units or converts explicit line/page geometry', () => {
		const event = { deltaX: 2, deltaY: -3, deltaZ: 1, deltaMode: 1 };
		expect(pointer.wheel(event, { unit: 'native' })).toEqual({ x: 2, y: -3, z: 1, unit: 'lines' });
		const policy = { unit: 'pixels' as const, lineHeight: 20, pageWidth: 800, pageHeight: 600 };
		expect(pointer.wheel(event, policy).y).toBe(-60);
		expect(pointer.wheel({ ...event, deltaMode: 2 }, policy).x).toBe(1600);
		expect(pointer.wheel({ ...event, deltaMode: 0 }, policy).y).toBe(-3);
		expect(() => pointer.wheel({ ...event, deltaMode: 3 }, policy)).toThrow();
	});
	it('preserves coalesced order, equal timestamps and exact velocity units with bounded scans', () => {
		const event = {
			clientX: 1,
			clientY: 2,
			timeStamp: 0,
			getCoalescedEvents: () => [{ clientX: 1, clientY: 2, timeStamp: 1 }, { clientX: 1, clientY: 2, timeStamp: 1 }, {
				clientX: 11,
				clientY: 22,
				timeStamp: 11,
			}],
		};
		const samples = pointer.samples(event, { maximumSamples: 3 });
		expect(pointer.velocity(samples, { maximumSamples: 3 })).toEqual({ x: 1, y: 2, elapsed: 10 });
		expect(pointer.velocity(samples.slice(0, 2), { maximumSamples: 2 }).x).toBe(0);
		expect(() => pointer.samples(event, { maximumSamples: 2 })).toThrow(RangeError);
		expect(() => pointer.velocity([...samples].reverse(), { maximumSamples: 3 })).toThrow(RangeError);
		let closed = false;
		function* source() {
			try {
				yield* samples;
			} finally {
				closed = true;
			}
		}
		expect(() => pointer.velocity(source(), { maximumSamples: 1 })).toThrow();
		expect(closed).toBe(true);
	});
});

describe('native text edit contract', () => {
	it('blocks composition/readonly, reports unsupported and rejects split surrogate boundaries before mutation', () => {
		let calls = 0;
		const target = {
			value: 'a😀b',
			setRangeText() {
				calls++;
			},
		};
		const options = { composing: false, selection: 'end' as const, maximumLength: 10 };
		expect(text.edit(target, { start: 1, end: 3 }, 'x', options).status).toBe('edited');
		expect(() => text.edit(target, { start: 2, end: 3 }, 'x', options)).toThrow(RangeError);
		expect(text.edit(target, { start: 0, end: 1 }, '', { ...options, composing: true }).status).toBe('blocked');
		expect(text.edit({ ...target, readOnly: true }, { start: 0, end: 1 }, '', options).status).toBe('blocked');
		expect(text.edit({ value: '' }, { start: 0, end: 0 }, '', options).status).toBe('unsupported');
		expect(() => text.edit(target, { start: 0, end: 0 }, 'long', { ...options, maximumLength: 4 })).toThrow();
		expect(calls).toBe(1);
	});
});

interface Entry extends files.EntryType {
	children?: Entry[];
	size?: number;
}
const walkLimits = { maximumDepth: 4, maximumEntries: 10, maximumFiles: 5, maximumBytes: 100 };
const adapter: files.EntryAdapterType<Entry, { name: string; type: string; size: number }> = {
	children: (entry) => entry.children ?? [],
	async file(entry) {
		return { name: entry.name, type: '', size: entry.size ?? 1 };
	},
};
describe('lazy bounded directory traversal', () => {
	it('retains authored DFS paths and borrowed metadata, with no eager file calls', async () => {
		let calls = 0;
		const borrowed = { name: 'a', type: '', size: 2 };
		const source = files.walk([{
			name: 'dir',
			kind: 'directory',
			children: [{ name: 'a', kind: 'file' }, { name: 'b', kind: 'file' }],
		}], {
			...adapter,
			async file() {
				calls++;
				return borrowed;
			},
		}, walkLimits);
		expect(calls).toBe(0);
		const first = await source.next();
		expect(first.value?.path).toBe('dir/a');
		expect(first.value?.file).toBe(borrowed);
		expect(calls).toBe(1);
		await source.return?.(undefined);
		expect(calls).toBe(1);
	});
	it('rejects traversal paths, collisions, cycles and every explicit bound', async () => {
		const file: Entry = { name: 'a', kind: 'file', size: 2 };
		const dir: Entry = { name: 'd', kind: 'directory', children: [file] };
		for (const name of ['..', '.', 'a/b', 'a\\b', '\0']) {
			await expect(Array.fromAsync(files.walk([{ ...file, name }], adapter, walkLimits))).rejects.toThrow();
		}
		await expect(Array.fromAsync(files.walk([file, file], adapter, walkLimits))).rejects.toThrow();
		const cyclic: Entry = { name: 'cycle', kind: 'directory' };
		cyclic.children = [cyclic];
		await expect(Array.fromAsync(files.walk([cyclic], adapter, walkLimits))).rejects.toThrow();
		for (const policy of [{ maximumDepth: 0 }, { maximumEntries: 0 }, { maximumFiles: 0 }, { maximumBytes: 1 }]) {
			await expect(Array.fromAsync(files.walk([dir], adapter, { ...walkLimits, ...policy }))).rejects.toThrow();
		}
	});
	it('cancels pending enumeration, observes late settlement and exposes actual iterator release', async () => {
		const controller = new AbortController();
		let release!: (value: IteratorResult<Entry>) => void;
		let returned = 0;
		let cleanup: Promise<void> | undefined;
		const roots: AsyncIterable<Entry> = {
			[Symbol.asyncIterator]() {
				return {
					next: () =>
						new Promise((resolve) => {
							release = resolve;
						}),
					async return() {
						returned++;
						return { done: true as const, value: undefined };
					},
				};
			},
		};
		const walker = files.walk(roots, adapter, {
			...walkLimits,
			signal: controller.signal,
			onCleanup: (value) => {
				cleanup = value;
			},
		});
		const next = walker.next();
		for (let index = 0; index < 20 && release === undefined; index++) await Promise.resolve();
		controller.abort(null);
		await expect(next).rejects.toBe(null);
		expect(returned).toBe(0);
		release({ done: false, value: { name: 'late', kind: 'file' } });
		await cleanup;
		expect(returned).toBe(1);
	});
});

describe('clipboard selection and explicit access outcomes', () => {
	it('selects by preference without Blob reads, bounds offers, and retains borrowed item identity', () => {
		let reads = 0;
		const item = {
			types: ['text/plain', 'text/html'],
			async getType() {
				reads++;
				return new Blob();
			},
		};
		const options = { preferredTypes: ['text/html', 'text/plain'], maximumItems: 2, maximumTypes: 2 };
		const selected = clipboard.select([item], options);
		expect(selected[0]?.item).toBe(item);
		expect(selected[0]?.type).toBe('text/html');
		expect(reads).toBe(0);
		expect(clipboard.select([item], { ...options, preferredTypes: ['image/png'] })).toEqual([]);
		expect(() => clipboard.select([item], { ...options, maximumTypes: 1 })).toThrow();
	});
	it('does not retry denied access and distinguishes unsupported, failure and abort', async () => {
		expect(await clipboard.attempt({}, { maximumItems: 1 })).toEqual({ status: 'unsupported' });
		let calls = 0;
		const denied = new DOMException('denied', 'NotAllowedError');
		expect(
			await clipboard.attempt({
				async read() {
					calls++;
					throw denied;
				},
			}, { maximumItems: 1 }),
		).toEqual({ status: 'denied', error: denied });
		expect(calls).toBe(1);
		expect(
			await clipboard.attempt({
				async read() {
					throw undefined;
				},
			}, { maximumItems: 1 }),
		).toEqual({ status: 'failed', error: undefined });
		const controller = new AbortController();
		controller.abort(null);
		await expect(clipboard.attempt({}, { signal: controller.signal, maximumItems: 1 })).rejects.toBe(null);
		const item = {
			types: ['text/plain'],
			async getType() {
				return new Blob();
			},
		};
		expect(
			(await clipboard.attempt({
				async read() {
					return [item, item];
				},
			}, { maximumItems: 1 })).status,
		).toBe('failed');
	});
});

describe('gamepad calibration and mapped observation', () => {
	it('calibrates asymmetry, inversion and deadzones; mapping rejects missing and duplicate controls', () => {
		const snapshot: gamepad.Snapshot = {
			id: 'fake',
			index: 0,
			mapping: '',
			axes: [0.6],
			buttons: [{ value: 0.5, pressed: false, touched: false }],
		};
		const calibrated = gamepad.calibrate(snapshot, [{
			minimum: -1,
			center: 0.2,
			maximum: 1,
			deadzone: 0,
			invert: true,
		}], { maximumControls: 2 });
		expect(calibrated.axes[0]).toBeCloseTo(-0.5);
		expect(snapshot.axes[0]).toBe(0.6);
		const bindings: gamepad.MappingType[] = [{ name: 'move', kind: 'axis', index: 0 }, {
			name: '__proto__',
			kind: 'button',
			index: 0,
			scale: 2,
		}];
		const options = { maximumBindings: 2, missing: 'reject' as const };
		expect(gamepad.map(calibrated, bindings, options).__proto__).toBe(1);
		expect(() => gamepad.map(snapshot, [bindings[0]!, bindings[0]!], options)).toThrow();
		expect(() => gamepad.map(snapshot, [{ name: 'missing', kind: 'axis', index: 3 }], options)).toThrow();
		expect(gamepad.deadzone(0.1, 0.1)).toBe(0);
		expect(gamepad.deadzone(2, 0.1)).toBe(1);
	});
	it('uses the existing cold Observable and releases its polling frame on unsubscribe', () => {
		let reads = 0;
		let cancelled = 0;
		const host = {
			getGamepads() {
				reads++;
				return [{ id: 'fake', index: 0, connected: true, axes: [0.5], buttons: [] }];
			},
		};
		const frames = {
			requestAnimationFrame() {
				return 1;
			},
			cancelAnimationFrame() {
				cancelled++;
			},
		};
		const source = gamepad.observeMapped(host, frames, [{ name: 'move', kind: 'axis', index: 0 }], {
			maximumBindings: 1,
			missing: 'reject',
			deadzone: 0,
		});
		expect(reads).toBe(0);
		const values: unknown[] = [];
		const subscription = source.subscribe((value) => values.push(value));
		expect(values).toHaveLength(1);
		subscription.unsubscribe();
		expect(cancelled).toBe(1);
	});
});

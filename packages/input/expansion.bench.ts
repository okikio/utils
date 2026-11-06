/** Pure transforms and injected host costs; this does not measure native DOM rendering or permission dialogs. @module */
import { deepStrictEqual, strictEqual } from 'node:assert';
import { bench, do_not_optimize, group } from 'mitata';
import { run } from './fixtures/bench.ts';
import { clipboard, files, gamepad, pointer, text } from './mod.ts';

const wheel = { deltaX: 1, deltaY: 2, deltaZ: 0, deltaMode: 1 };
const pixels = { unit: 'pixels' as const, lineHeight: 20, pageWidth: 800, pageHeight: 600 };
strictEqual(pointer.wheel(wheel, pixels).y, 40);
group('explicit line wheel conversion', () => {
	bench('validated detached wheel', () => do_not_optimize(pointer.wheel(wheel, pixels)));
	bench('trusted arithmetic alone', () => do_not_optimize(wheel.deltaY * pixels.lineHeight));
});
for (const count of [64, 1024]) {
	const positions = Array.from({ length: count }, (_, at) => ({ x: at * 2, y: at, at }));
	strictEqual(pointer.velocity(positions, { maximumSamples: count }).x, 2);
	const entries = Array.from({ length: count }, (_, index) => ({ name: String(index), kind: 'file' as const }));
	const adapter = {
		children: () => [],
		async file(entry: files.EntryType) {
			return { name: entry.name, type: '', size: 1 };
		},
	};
	const walk = async function (verify = false): Promise<number> {
		let total = 0;
		const names: string[] | undefined = verify ? [] : undefined;
		for await (
			const value of files.walk(entries, adapter, {
				maximumDepth: 0,
				maximumEntries: count,
				maximumFiles: count,
				maximumBytes: count,
			})
		) {
			total += value.file.size;
			names?.push(value.file.name);
		}
		if (verify) deepStrictEqual(names, entries.map((entry) => entry.name));
		return total;
	};
	strictEqual(await walk(true), count);
	group(`pointer and file metadata ${count} values`, () => {
		bench('bounded velocity scan', () => do_not_optimize(pointer.velocity(positions, { maximumSamples: count })));
		bench(
			'trusted velocity endpoint arithmetic',
			() => do_not_optimize((positions[count - 1]!.x - positions[0]!.x) / (count - 1)),
		);
		bench('lazy bounded directory metadata', async () => do_not_optimize(await walk()));
		bench('direct file metadata calls; no traversal policy', async () => {
			for (const entry of entries) do_not_optimize(await adapter.file(entry));
		});
	});
}
for (const length of [1024, 1024 * 1024]) {
	const original = 'a'.repeat(length);
	const target = {
		value: original,
		setRangeText(replacement: string, start: number, end: number) {
			this.value = this.value.slice(0, start) + replacement + this.value.slice(end);
		},
	};
	const options = { composing: false, selection: 'end' as const, maximumLength: length };
	strictEqual(text.edit(target, { start: 0, end: 1 }, 'b', options).status, 'edited');
	strictEqual(target.value, 'b' + original.slice(1));
	group(`structural text capability ${length} code units; no DOM`, () => {
		bench('bounded native-capability edit policy', () => {
			target.value = original;
			do_not_optimize(text.edit(target, { start: 0, end: 1 }, 'b', options));
		});
		bench('direct capability mutation; no bounds', () => {
			target.value = original;
			target.setRangeText('b', 0, 1);
			do_not_optimize(target.value);
		});
	});
}
const item = {
	types: ['text/plain', 'text/html'],
	async getType() {
		throw new Error('Selection must not read blobs.');
	},
};
const selection = { preferredTypes: ['text/html', 'text/plain'], maximumItems: 64, maximumTypes: 2 };
const items = Array.from({ length: 64 }, () => item);
strictEqual(clipboard.select(items, selection)[0]?.type, 'text/html');
const snapshot: gamepad.Snapshot = { id: 'bench', index: 0, mapping: '', axes: [0.5], buttons: [] };
const profile = [{ minimum: -1, center: 0, maximum: 1, deadzone: 0.1 }];
const bindings: gamepad.MappingType[] = [{ name: 'move', kind: 'axis', index: 0 }];
const mapping = { maximumBindings: 1, missing: 'reject' as const };
strictEqual(gamepad.map(snapshot, bindings, mapping).move, 0.5);
group('clipboard preference and gamepad transforms', () => {
	bench('bounded MIME selection 64 items; zero blob reads', () => do_not_optimize(clipboard.select(items, selection)));
	bench(
		'trusted first preference scan; no bounds or detached entries',
		() => do_not_optimize(items.map((value) => selection.preferredTypes.find((type) => value.types.includes(type)))),
	);
	bench(
		'calibrate and map one axis',
		() => do_not_optimize(gamepad.map(gamepad.calibrate(snapshot, profile, { maximumControls: 1 }), bindings, mapping)),
	);
	bench('map prepared axis without calibration', () => do_not_optimize(gamepad.map(snapshot, bindings, mapping)));
});
await run();

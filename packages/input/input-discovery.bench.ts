/** Explicit form comparison and callback-free command discovery, without DOM emulation. */
import { bench, do_not_optimize, group } from 'mitata';
import { deepStrictEqual } from 'node:assert';
import { run } from './fixtures/bench.ts';
import * as forms from '@okikio/input/forms';
import * as commands from '@okikio/input/commands';
import * as keys from '@okikio/input/keys';
for (const count of [1, 100, 1000]) {
	const entries = Array.from({ length: count }, (_, index) => [`field-${index % 10}`, String(index)] as const);
	// Saved and newly captured entries are distinct snapshots, even when values agree.
	const saved = entries.map(([name, value]) => [name, value] as const);
	const changed = saved.map(([name, value], index) => [name, index === count - 1 ? 'changed' : value] as const);
	const policy = { maximumEntries: count, order: 'per-field' as const, equal: Object.is };
	if (forms.dirty(entries, saved, policy).dirty || !forms.dirty(changed, saved, policy).dirty) {
		throw new Error('Form comparison oracle failed.');
	}
	const source = Array.from(
		{ length: count },
		(_, index) =>
			commands.define({
				id: `command-${index}`,
				label: `Command ${index}`,
				invoke() {
					throw new Error('Discovery invoked command');
				},
			}),
	);
	const bounds = { maximumItems: count, maximumTextCodeUnits: 128 };
	const metadata = commands.inspect(source, bounds);
	const options = { ...bounds, maximumResults: count, maximumQueryCodeUnits: 32, includeDisabled: false };
	deepStrictEqual(metadata.map((entry) => entry.id), source.map((entry) => entry.id));
	// Search ranking can differ from declaration order; preserve exact membership and multiplicity.
	deepStrictEqual(
		commands.search(metadata, 'Command', options).map((entry) => entry.id).sort(),
		source.map((entry) => entry.id).sort(),
	);
	group(`input evidence ${count} entries`, () => {
		bench('equal repeated-field snapshots', () => do_not_optimize(forms.dirty(entries, saved, policy)));
		bench('one changed value at the end', () => do_not_optimize(forms.dirty(changed, saved, policy)));
		bench('metadata without command invocation', () => do_not_optimize(commands.inspect(source, bounds)));
		bench('literal command search', () => do_not_optimize(commands.search(metadata, 'Command', options)));
	});
}
for (const count of [1, 10, 100]) {
	const bindings = Array.from({ length: count }, (_, index) => ({ code: `Key${index}`, run() {} }));
	const bounds = { maximumBindings: count, maximumConflicts: 1, maximumComparisons: count * (count - 1) / 2 };
	if (keys.conflicts(bindings, bounds).capped) throw new Error('Conflict comparison oracle failed.');
	group(`shortcut comparison ${count} declarations`, () => {
		bench('complete bounded pair scan', () => do_not_optimize(keys.conflicts(bindings, bounds)));
	});
}
await run();

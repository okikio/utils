import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as commands from './commands.ts';
import * as codec from '@okikio/schema/codec';
import * as keys from './keys.ts';

describe('command discovery and shortcut evidence', () => {
	it('projects callbacks out of metadata without evaluating typed command predicates', () => {
		let calls = 0;
		const save = commands.define({
			id: 'save',
			label: 'Save File',
			enabled: () => {
				calls++;
				return true;
			},
			invoke: () => {
				calls++;
			},
		});
		const open = commands.define({ id: 'open', label: 'Open File', invoke: () => {} });
		const catalog = commands.catalog('editor', { save, open });
		const report = commands.inspect(commands.values(catalog), { maximumItems: 2, maximumTextCodeUnits: 1024 });
		expect(report.map((entry) => entry.availability)).toEqual(['unknown', 'enabled']);
		expect(calls).toBe(0);
		expect(JSON.stringify(report)).not.toContain('invoke');
		expect(report.some((entry) => Object.hasOwn(entry, 'enabled'))).toBe(false);
		const disabled = commands.inspect([save, open], {
			maximumItems: 2,
			maximumTextCodeUnits: 1024,
			availability: (id) => id !== 'save',
		});
		const options = {
			maximumItems: 2,
			maximumTextCodeUnits: 1024,
			maximumResults: 1,
			maximumQueryCodeUnits: 20,
			includeDisabled: false,
		};
		expect(commands.search(disabled, 'FILE', options).map((entry) => entry.id)).toEqual(['open']);
		expect(commands.search(disabled, 'save file', { ...options, includeDisabled: true }).map((entry) => entry.id))
			.toEqual(['save']);
		expect(() => commands.inspect([save], { maximumItems: 0, maximumTextCodeUnits: 1024 })).toThrow(RangeError);
	});
	it('uses exact sequence/scope/priority/modifier rules and marks layout uncertainty', () => {
		const run = () => {
			throw new Error('No callbacks during inspection');
		};
		const bindings: keys.Binding[] = [{ key: 'g', run }, { key: 'G g', run }, { key: 'g', scope: 'dialog', run }, {
			key: 'g',
			priority: 1,
			run,
		}, { code: 'KeyG', run }];
		const report = keys.conflicts(bindings, { maximumBindings: 5, maximumConflicts: 10, maximumComparisons: 10 });
		expect(report.capped).toBe(false);
		expect(report.comparisons).toBe(10);
		expect(report.conflicts.map(({ left, right, kind }) => [left, right, kind])).toEqual([[0, 1, 'prefix'], [
			0,
			4,
			'layout',
		], [1, 4, 'layout']]);
		expect(keys.conflicts(bindings, { maximumBindings: 5, maximumConflicts: 10, maximumComparisons: 0 }).capped).toBe(
			true,
		);
		expect(
			keys.conflicts([{ key: 'k', mod: true, run }, { key: 'K', control: true, run }], {
				maximumBindings: 2,
				maximumConflicts: 1,
				maximumComparisons: 1,
			}).conflicts[0]?.kind,
		).toBe('equal');
	});
});

it('round trips callback-free remappings and rejects unknown commands, ambiguous sequences and private callbacks', async () => {
	const contract = keys.remapping(['open', 'save'], {
		maximumCommands: 2,
		maximumBindings: 3,
		maximumTextCodeUnits: 64,
		maximumComparisons: 3,
	});
	const document = {
		version: 1 as const,
		bindings: [{ command: 'open', sequence: [{ key: 'k', mod: true }] }, {
			command: 'save',
			sequence: [{ code: 'KeyS', control: true }],
		}],
	};
	expect(await codec.read(contract, await codec.write(contract, document))).toEqual(document);
	for (
		const bindings of [
			[{ command: 'missing', sequence: [{ key: 'x' }] }],
			[{ command: 'open', sequence: [{ key: 'g' }] }, { command: 'save', sequence: [{ key: 'G g' }] }],
			[{ command: 'open', sequence: [{ key: 'k', mod: true, control: true }] }],
			[{ command: 'open', sequence: [{ key: 'x' }], run() {} }],
		]
	) await expect(codec.read(contract, { version: 1, bindings })).rejects.toThrow();
	await expect(
		codec.read(
			keys.remapping(['open', 'save'], {
				maximumCommands: 2,
				maximumBindings: 3,
				maximumTextCodeUnits: 64,
				maximumComparisons: 0,
			}),
			document,
		),
	).rejects.toThrow();
});

import { it } from 'node:test';
import { expect } from '@std/expect';
import { catalog, record } from './mod.ts';

it('narrows a deployment selection without recovering omitted definitions', () => {
	const Read = { id: 'read', kind: 'permission' } as const;
	const Write = { id: 'write', kind: 'permission' } as const;
	const root = catalog.create('assets', { Read, Write });
	const selected = catalog.select(root, ['Read']);
	const nested = catalog.select(selected, ['Read']);
	const info = catalog.metadata(nested);
	if (info.type !== 'selection') throw new Error('Expected selection metadata.');
	expect(info.source).toBe(root);
	expect(nested.Read).toBe(Read);
	expect(catalog.values(nested)).toEqual([Read]);
	expect(() => catalog.select(selected, ['Write'] as unknown as ['Read'])).toThrow(catalog.CatalogSelectionError);
	const before = record.json.copy({ title: 'Draft' });
	const after = { title: 'Published' };
	expect(record.change.patch(before, record.change.diff(before, after))).toEqual(after);
});

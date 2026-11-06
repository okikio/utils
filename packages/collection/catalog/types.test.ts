import * as catalog from './mod.ts';

const Read = { id: 'read', kind: 'permission', operation: 'read' } as const;
const Write = { id: 'write', kind: 'permission', operation: 'write' } as const;
const Root = catalog.create('permissions', { Read, Write });
const Selected = catalog.select(Root, ['Read']);
const selected: catalog.DefinitionEntry<typeof Selected> = Read;
void selected;
// @ts-expect-error Selecting Read must remove Write from the hidden entry union.
const rejected: catalog.DefinitionEntry<typeof Selected> = Write;
void rejected;
const first: typeof Read | undefined = catalog.values(Selected)[0];
void first;
const narrowed = catalog.select(Selected, ['Read']);
const stillRead: catalog.DefinitionEntry<typeof narrowed> = Read;
void stillRead;
// @ts-expect-error The second selection cannot recover a key omitted by the first.
catalog.select(Selected, ['Write']);

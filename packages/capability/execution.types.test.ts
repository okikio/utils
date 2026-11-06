import * as context from '@okikio/context';
import * as capability from './mod.ts';
import * as session from './resource/session/mod.ts';
import type { ResourceCollection } from './resource/types.ts';

const Store = capability.resource.define<string>()({ id: 'store', description: 'A textual store.' });
const Hidden = capability.resource.define<number>()({ id: 'hidden', description: 'Not declared.' });

async function use(owner: context.Owned, clients: ResourceCollection): Promise<void> {
	const base = context.view(owner, { accountId: 'account-1' as const });
	const ctx = capability.scope(base, { resources: { collection: clients, allowed: [Store] } });
	const value: string = await ctx.get(Store);
	const accountId: 'account-1' = ctx.accountId;
	ctx.defer(() => {});
	void value;
	void accountId;
	// @ts-expect-error An undeclared definition cannot be borrowed from this view.
	await ctx.get(Hidden);
	const empty = capability.scope(ctx);
	// @ts-expect-error Resource access must be declared when creating another view.
	await empty.get(Store);
}
void use;

/** Keep owned resource/session values and per-instance input exact in both source and installed types. */
async function opening(): Promise<void> {
	const binding = capability.resource.implement(Store, { create: () => 'saved' });
	await using stores = await capability.resource.open(binding);
	const text: string = await stores.get(Store);
	void text;
	// @ts-expect-error A typed resource is not widened to any by the owned facade.
	const number: number = await stores.get(Store);
	void number;
	await using drafts = await session.open(binding, {
		configure: (input: { name: string }) => ({ source: { NAME: input.name } }),
	});
	const ref = await drafts.create({ input: { name: 'Notes' } });
	const saved: string = await drafts.use(ref, (value) => value);
	void saved;
	// @ts-expect-error Required creation settings do not become an optional untyped bag.
	await drafts.create();
	// @ts-expect-error Per-session settings keep their inferred field types.
	await drafts.create({ input: { name: 3 } });
	// @ts-expect-error A retained value still has the resource's declared type.
	const count: number = await drafts.use(ref, (value) => value);
	void count;
}
void opening;

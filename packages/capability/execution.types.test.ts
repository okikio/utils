import * as context from '@okikio/context';
import * as capability from './mod.ts';
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

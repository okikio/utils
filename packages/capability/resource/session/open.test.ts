/** Retained-resource consumers use ordinary bindings without rebuilding their acquisition lifetime. @module */
import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as context from '@okikio/context';
import * as env from '@okikio/env';
import * as schema from '@okikio/schema';
import * as placement from '@okikio/workflow';
import * as resource from '../mod.ts';
import * as session from './mod.ts';

describe('session resource composition', () => {
	it('retains separate note drafts and closes all resource cleanup through one scope', async () => {
		let closed = 0;
		const Draft = resource.define<{ text: string }>()({ id: 'draft', description: 'Edit one open draft.' });
		const binding = resource.implement(Draft, {
			create({ ctx }) {
				ctx.defer(() => {
					closed++;
				});
				return { text: '' };
			},
		});
		const drafts = await session.open(binding);
		const first = await drafts.create();
		const second = await drafts.create();
		await drafts.use(first, (draft) => {
			draft.text = 'Hello';
		});
		expect(await drafts.use(first, (draft) => draft.text)).toBe('Hello');
		expect(await drafts.use(second, (draft) => draft.text)).toBe('');
		await drafts.close(first);
		expect(closed).toBe(1);
		await drafts[Symbol.asyncDispose]();
		await drafts[Symbol.asyncDispose]();
		expect(closed).toBe(2);
	});

	it('maps typed creation input into schema-checked construction settings', async () => {
		const settings = env.define({
			NAME: env.variable(schema.string({ minLength: 1 }), { description: 'Draft name.' }),
		});
		const Draft = resource.define<{ name: string }>()({
			id: 'named-draft',
			description: 'Open a named draft.',
			environment: env.requirement('draft.settings', settings, { NAME: 'Choose the draft name.' }),
		});
		const binding = resource.implement(Draft, { create: ({ environment }) => ({ name: environment.NAME! }) });
		await using drafts = await session.open(binding, {
			configure: (input: { name: string }) => ({ source: { NAME: input.name } }),
		});

		const ref = await drafts.create({ input: { name: 'Notes' } });
		expect(await drafts.use(ref, (draft) => draft.name)).toBe('Notes');
		await expect(drafts.create({ input: { name: '' } })).rejects.toThrow();
		expect(drafts.stats().sessions).toBe(1);
	});

	it('carries the complete pooled route and rejects a reference with a substituted host', async () => {
		const Value = resource.define<number>()({ id: 'routed', description: 'A host-owned value.' });
		await using values = await session.open(resource.implement(Value, { create: () => 7 }), {
			owner: { id: 'threads', generation: 3 },
		});
		const host = { pool: 'pool-one', id: 'host-one' };
		const reference = await values.create({ host });
		const saved = session.ReferenceSchema.parse(JSON.parse(JSON.stringify(reference)));
		expect(placement.placement.session(saved)).toEqual(placement.placement.host(saved.owner, host));
		await expect(values.use({ ...saved, host: { ...host, id: 'host-two' } }, (value) => value))
			.rejects.toMatchObject({ code: 'lost' });
		expect(await values.use(saved, (value) => value)).toBe(7);
	});

	it('keeps local terminal history bounded without exhausting successive lifetimes', async () => {
		const Value = resource.define<number>()({ id: 'churn', description: 'One short-lived instance.' });
		await using values = await session.open(resource.implement(Value, { create: () => 7 }), { maximum: 1 });
		let old: session.ReferenceType | undefined;
		for (let index = 0; index < 140; index++) {
			const ref = await values.create();
			old ??= ref;
			await values.close(ref);
		}
		expect(values.stats()).toEqual({ sessions: 0, borrows: 0 });
		await expect(values.use(old!, (value) => value)).rejects.toMatchObject({ code: 'lost' });
	});

	it('requires deployment identity for injected authority and keeps a supplied parent borrowed', async () => {
		const Value = resource.define<number>()({ id: 'shared', description: 'A configured value.' });
		const binding = resource.implement(Value, { create: () => 1 });
		const registry = session.registry(session.memory());
		await expect(session.open(binding, { registry })).rejects.toThrow('registered executor');
		await using parent = context.create({ id: 'application' });
		const values = await session.open(binding, { ctx: parent, registry, owner: { id: 'one', generation: 1 } });
		const ref = await values.create();
		await values[Symbol.asyncDispose]();
		expect(parent.signal.aborted).toBe(false);
		expect((await registry.inspect(ref.id))?.state).toBe('closed');
	});

	it('joins reentrant disposal and retains a resource cleanup failure', async () => {
		const Value = resource.define<number>()({ id: 'cleanup', description: 'Expose failed cleanup.' });
		const failure = new Error('Failed to close.');
		let reentered: Promise<void> | undefined;
		await using parent = context.create({ id: 'owner' });
		const values = await session.open(
			resource.implement(Value, {
				create({ ctx }) {
					ctx.defer(() => {
						reentered = values[Symbol.asyncDispose]();
						throw failure;
					});
					return 1;
				},
			}),
			{ ctx: parent },
		);
		await values.create();
		const closing = values[Symbol.asyncDispose]();
		await expect(closing).rejects.toBeInstanceOf(AggregateError);
		expect(values[Symbol.asyncDispose]()).toBe(closing);
		expect(reentered).toBe(closing);
		expect(parent.signal.aborted).toBe(false);
	});
});

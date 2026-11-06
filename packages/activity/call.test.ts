import '@okikio/dispose/polyfill';
import '@okikio/duration/polyfill';
import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as context from '@okikio/context';
import * as resource from '@okikio/capability/resource';
import * as schema from '@okikio/schema';
import * as permission from '@okikio/authz/permission';
import * as activity from './mod.ts';
import * as engine from './engine.ts';

describe('checked local activity calls', () => {
	it('infers input and result, validates both boundaries and defaults to the current process', async () => {
		const Upper = activity.define({ id: 'call.upper', version: '1', input: schema.string(), result: schema.string() });
		let calls = 0;
		const live = activity.implement(Upper, {
			run(ctx) {
				calls++;
				expect(ctx.engine).toBe(engine.local);
				expect(ctx.attempt).toBe(1);
				return ctx.input.toUpperCase();
			},
		});
		const result: string = await activity.call(live, 'hello');

		expect(result).toBe('HELLO');
		await expect(activity.call(live, 1 as unknown as string)).rejects.toThrow();
		expect(calls).toBe(1);
		const broken = activity.implement(Upper, { run: () => 1 as unknown as string });
		await expect(activity.call(broken, 'hello')).rejects.toThrow();
	});

	it('closes acquired bindings and attempt cleanup before resolving without closing the caller', async () => {
		const events: string[] = [];
		const Store = resource.define<{ value: string }>()({ id: 'call.store', description: 'Supply one stored value.' });
		const liveStore = resource.implement(Store, {
			create({ ctx }) {
				ctx.defer(() => {
					events.push('resource closed');
				});
				return { value: 'saved' };
			},
		});
		const Read = activity.define({
			id: 'call.read',
			version: '1',
			input: schema.string(),
			result: schema.string(),
			resources: [Store],
		});
		const live = activity.implement(Read, {
			async run(ctx) {
				ctx.defer(() => {
					events.push('attempt closed');
				});
				return (await ctx.get(Store)).value;
			},
		});
		await using caller = context.create({ id: 'caller' });
		expect(await activity.call(live, '', { ctx: caller, resources: liveStore })).toBe('saved');
		expect(events).toEqual(['attempt closed', 'resource closed']);
		expect(caller.signal.aborted).toBe(false);
	});

	it('borrows collections, and rejects custom placement rather than silently running remote work', async () => {
		const Remote = engine.define({ id: 'remote' });
		const RemoteOnly = activity.define({
			id: 'call.remote',
			version: '1',
			input: schema.string(),
			result: schema.string(),
			placement: engine.require(Remote),
		});
		let calls = 0;
		const live = activity.implement(RemoteOnly, {
			run: (ctx) => {
				calls++;
				return ctx.input;
			},
		});
		await using stores = await resource.open([]);
		await expect(activity.call(live, 'hello', { resources: stores.collection })).rejects.toThrow(
			activity.InvalidEngineError,
		);
		expect(calls).toBe(0);
		expect(await activity.call(live, 'hello', { engine: Remote, resources: stores.collection })).toBe('hello');
		// The borrowed collection can still be used by a second call.
		expect(await activity.call(live, 'again', { engine: Remote, resources: stores.collection })).toBe('again');
	});

	it('keeps permission authority explicit even on the convenient local path', async () => {
		const Write = permission.define({ id: 'call.write', description: 'Write a title.', target: schema.string() });
		const Save = activity.define({
			id: 'call.save',
			version: '1',
			input: schema.string(),
			result: schema.string(),
			requirements: [permission.require(Write)],
		});
		const live = activity.implement(Save, {
			async run(ctx) {
				await permission.assert(ctx, Write, ctx.input);
				return ctx.input;
			},
		});
		await expect(activity.call(live, 'private')).rejects.toBeInstanceOf(permission.MissingPermissionCheckerError);
	});
});

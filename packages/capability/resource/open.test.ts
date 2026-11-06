/** Consumer ownership: simple setup must retain the same acquisition and cleanup guarantees. @module */
import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as context from '@okikio/context';
import * as resource from './mod.ts';
import * as requirement from '../requirement/mod.ts';

describe('owned resource opening', () => {
	it('infers a bound value, shares lazy acquisition and joins disposal once', async () => {
		let opened = 0;
		let closed = 0;
		const Notes = resource.define<Map<string, string>>()({ id: 'notes', description: 'Retain notes.' });
		const binding = resource.implement(Notes, {
			create({ ctx }) {
				opened++;
				ctx.defer(() => {
					closed++;
				});
				return new Map<string, string>();
			},
		});
		const notes = await resource.open(binding);
		expect(opened).toBe(0);
		const first = await notes.get(Notes);
		first.set('one', 'Hello');
		expect(await notes.get(Notes)).toBe(first);
		expect(opened).toBe(1);
		await notes[Symbol.asyncDispose]();
		await notes[Symbol.asyncDispose]();
		expect(closed).toBe(1);
		await expect(notes.get(Notes)).rejects.toBeInstanceOf(resource.CollectionDisposedError);
	});

	it('borrows the supplied parent and honors cancellation of a particular caller', async () => {
		await using parent = context.create({ id: 'parent' });
		const Value = resource.define<number>()({ id: 'value', description: 'One value.' });
		const values = await resource.open([resource.implement(Value, { create: () => 7 })], { ctx: parent });
		const cancelled = new AbortController();
		await using caller = context.child(parent, { signal: cancelled.signal });
		cancelled.abort(new Error('Stop this request.'));
		await expect(values.get(Value, caller)).rejects.toMatchObject({ name: 'ContextCancelledError' });
		expect(await values.get(Value)).toBe(7);
		await values[Symbol.asyncDispose]();
		expect(parent.signal.aborted).toBe(false);
	});

	it('checks caller authority again for a cached value without granting access by default', async () => {
		const Rule = { kind: 'access', id: 'notes.read' };
		const CanRead = requirement.define({ family: 'access', action: 'require', definition: Rule });
		const Notes = resource.define<number>()({
			id: 'protected',
			description: 'A protected shared value.',
			requirements: [CanRead],
		});
		let created = 0;
		await using notes = await resource.open(resource.implement(Notes, { create: () => ++created }));
		// Owning the collection is not an account permission. No interpreter means rejection.
		await expect(notes.get(Notes)).rejects.toBeInstanceOf(requirement.UnsupportedRequirementError);
		await using alice = context.create({ id: 'alice' });
		await using bob = context.create({ id: 'bob' });
		const denied = new Error('This account cannot read notes.');
		const checked: string[] = [];
		const policy = {
			interpreters: {
				access: {
					async apply(ctx: context.Context) {
						checked.push(ctx.id);
						if (ctx.id !== 'alice') throw denied;
					},
				},
			},
		};
		expect(await notes.get(Notes, requirement.scope(alice, policy))).toBe(1);
		await expect(notes.get(Notes, requirement.scope(bob, policy))).rejects.toBe(denied);
		expect(created).toBe(1);
		expect(checked).toEqual(['alice', 'bob']);
	});

	it('closes construction scope on a missing dependency before running a provider', async () => {
		const Missing = resource.define<number>()({ id: 'missing', description: 'A missing dependency.' });
		const Value = resource.define({
			id: 'dependent',
			description: 'Read dependency.',
			dependencies: { missing: Missing },
		});
		let opened = false;
		const binding = resource.implement(Value, {
			create() {
				opened = true;
				return 1;
			},
		});
		await expect(resource.open(binding)).rejects.toBeInstanceOf(resource.MissingImplementationError);
		expect(opened).toBe(false);
	});
});

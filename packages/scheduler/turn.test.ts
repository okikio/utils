import { it } from 'node:test';
import { expect } from '@std/expect';
import * as scheduler from './mod.ts';

it('lets another host event run between bounded CPU chunks', async () => {
	const trace: string[] = [];
	const ready = new Promise<void>((resolve) =>
		setTimeout(() => {
			trace.push('other');
			resolve();
		}, 0)
	);
	trace.push('first chunk');
	await scheduler.yield();
	trace.push('second chunk');
	await ready;
	expect(trace).toEqual(['first chunk', 'other', 'second chunk']);
});

it('rejects cancellation before and during a turn without retaining its timer', async () => {
	const before = new AbortController();
	before.abort('before');
	await expect(scheduler.yield(before.signal)).rejects.toBe('before');
	const during = new AbortController();
	const pending = scheduler.yield(during.signal);
	during.abort('during');
	await expect(pending).rejects.toBe('during');
});

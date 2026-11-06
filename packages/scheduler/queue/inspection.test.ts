import { it } from 'node:test';
import { expect } from '@std/expect';
import * as context from '@okikio/context';
import * as queue from './mod.ts';

it('paginates through bounded scans with provider/filter binding and a finite admission watermark', async () => {
	await using ctx = context.create({ id: 'queue-inspection' });
	await using jobs = queue.memory<string, string>();
	const refs = [];
	for (let i = 0; i < 5; i++) refs.push(await jobs.add(ctx, `private-${i}`));
	await jobs.cancel(ctx, refs[3]!);
	const options = { state: 'cancelled' as const, limit: 1, maximumScanned: 2 };
	const first = await jobs.inspect(options);
	expect(first.entries).toEqual([]);
	expect(first.scanned).toBe(2);
	expect(first.cursor).toBeDefined();
	await jobs.cancel(ctx, await jobs.add(ctx, 'later'));
	const next = await jobs.inspect({ ...options, cursor: first.cursor! });
	expect(next.entries.map((entry) => entry.id)).toEqual([refs[3]!.id]);
	const last = await jobs.inspect({ ...options, cursor: next.cursor! });
	expect(last.cursor).toBeUndefined();
	expect(last.entries).toEqual([]);
	expect(JSON.stringify(next)).not.toContain('private-');
	await expect(jobs.inspect({ ...options, state: 'queued', cursor: first.cursor! })).rejects.toThrow(TypeError);
	await using other = queue.memory();
	await expect(other.inspect({ ...options, cursor: first.cursor! })).rejects.toThrow(TypeError);
	await expect(jobs.inspect({ limit: 2, maximumScanned: 1 })).rejects.toThrow(RangeError);
});

it('deduplicates concurrent redrive copies, preserves terminal source and fences old claims', async () => {
	await using ctx = context.create({ id: 'redrive' });
	await using jobs = queue.memory<string, string>({ capacity: 2 });
	const source = await jobs.add(ctx, 'original', { priority: 7 });
	const [old] = await jobs.claim(ctx);
	await jobs.cancel(ctx, source);
	const copies = await Promise.all(Array.from({ length: 20 }, () => jobs.redrive(ctx, source, { key: 'retry-1' })));
	expect(new Set(copies.map((ref) => ref.id)).size).toBe(1);
	expect(copies[0]!.id).not.toBe(source.id);
	const [claim] = await jobs.claim(ctx);
	expect(claim?.attempt).toBe(1);
	expect(claim?.value).toBe('original');
	await expect(jobs.complete(ctx, old!, 'late')).rejects.toThrow(queue.StaleClaimError);
	const page = await jobs.inspect({ limit: 10, maximumScanned: 10 });
	expect(page.entries.map(({ state, attempt, priority, redrivenFrom }) => ({ state, attempt, priority, redrivenFrom })))
		.toEqual([
			{ state: 'cancelled', attempt: 1, priority: 7, redrivenFrom: undefined },
			{ state: 'claimed', attempt: 1, priority: 7, redrivenFrom: source.id },
		]);
	await expect(jobs.redrive(ctx, copies[0]!, { key: 'retry-2' })).rejects.toThrow(TypeError);
	await jobs.cancel(ctx, copies[0]!);
	await expect(jobs.redrive(ctx, copies[0]!, { key: 'retry-1' })).rejects.toThrow(TypeError);
	await jobs.close();
	await expect(jobs.inspect({ limit: 1, maximumScanned: 1 })).rejects.toThrow(queue.QueueClosedError);
});

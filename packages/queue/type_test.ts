import type { Context } from '@okikio/context';
import * as queue from './mod.ts';

/** Borrowed consumer Context used only to exercise the queue type surface. */
declare const ctx: Context;

/** Compile-time consumer examples prove queue input, claim, and result types stay linked. */
async function queueTypes(): Promise<void> {
	await using jobs = queue.memory<Readonly<{ path: string }>, Readonly<{ stored: true }>>();
	const ref = await jobs.add(ctx, { path: '/input.bin' });
	const [claim] = await jobs.claim(ctx, { owner: 'consumer', limit: 1 });
	if (claim === undefined) return;

	const path: string = claim.value.path;
	void path;
	await jobs.complete(ctx, claim, { stored: true });
	const result: Readonly<{ stored: true }> = await jobs.result(ctx, ref);
	void result;

	// @ts-expect-error Queue input is the exact declared input type.
	await jobs.add(ctx, { url: 'https://service.invalid/input' });
	// @ts-expect-error Queue completion must use the exact declared output type.
	await jobs.complete(ctx, claim, { stored: false });
}

void queueTypes;

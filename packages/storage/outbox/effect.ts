/** Bind effect acceptance to the business transaction, then deliver through the same persistent outbox. @module */
import type { TransactionSql } from 'postgres';
import * as effects from '@okikio/capability/effect';
import type { EffectEmitter, EffectHandler } from '@okikio/capability/effect';
import { check } from '@okikio/context';
import type { Context } from '@okikio/context';
import type { Outbox } from './postgres.ts';

/**
 * Borrow a transaction for producer emission. emit() stages acceptance; only the
 * enclosing transaction's successful commit makes it durable. Do not retain this
 * emitter after that transaction or configure it as an application-wide owner.
 */
export function emitter(box: Outbox, tx: TransactionSql): EffectEmitter {
	return Object.freeze({
		async emit(ctx: Context, occurrence: effects.EffectOccurrence) {
			check(ctx);
			await box.append(tx, await effects.encode(occurrence));
			check(ctx);
		},
	});
}
/**
 * Deliver one bounded batch through exact trusted handlers. Acceptance precedes
 * acknowledgement, so sink handlers must deduplicate by definition ID and key.
 * Cancellation leaves its claim to expire. Retry/lease budgets belong to box;
 * actions longer than leaseMs can be redelivered and need sink-side fencing.
 * The returned accepted count includes acknowledged claims. retried counts
 * failed deliveries passed to the retry policy, including exhausted attempts
 * that the outbox retains as failed instead of making them available again.
 */
export async function dispatch(
	ctx: Context,
	box: Outbox,
	handlers: readonly EffectHandler[],
	options: { readonly limit?: number; readonly leaseMs?: number; readonly delayMs?: number } = {},
): Promise<{ accepted: number; retried: number }> {
	check(ctx);
	const table = new Map(handlers.map((handler) => [handler.definition.id, handler]));
	if (table.size !== handlers.length) throw new TypeError('Each effect ID requires one handler.');
	const claims = await box.claim(options);
	let accepted = 0, retried = 0;
	for (const claim of claims) {
		check(ctx);
		try {
			const handler = table.get(claim.id);
			if (!handler) throw new TypeError('No trusted handler for outbox effect.');
			const occurrence = await effects.decode(claim, [handler.definition]);
			await handler.accept(ctx, occurrence);
			check(ctx);
			await box.complete(claim);
			accepted++;
		} catch (error) {
			check(ctx);
			try {
				await box.retry(claim, options.delayMs);
			} catch (cleanup) {
				throw new AggregateError([error, cleanup], 'Effect acceptance or acknowledgement failed.');
			}
			retried++;
		}
	}
	return { accepted, retried };
}

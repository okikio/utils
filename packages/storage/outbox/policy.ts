/**
 * Raise a namespace's retained-message capacity without stopping its writers.
 *
 * Every view of a namespace must open with the same `maximum`, `maximumBytes` and `maximumAttempts`, and
 * `append()` rejects a view whose settings differ from the stored policy. That keeps two deployments from
 * disagreeing about capacity, but it also means a plain config change cannot raise the limit. `resize()` is
 * the reviewed step: it changes the stored `maximum` from the value you expect to the value you want, under
 * the same namespace lock `append()` takes. Deploy every writer with the new `maximum` right after it commits;
 * a writer still on the old value fails its policy check instead of using a stale limit.
 *
 * ```ts ignore
 * await database.begin((tx) =>
 * 	resize(tx, {
 * 		namespace: 'orders',
 * 		from: { maximum: 10000, bytes: 1048576, attempts: 8 },
 * 		to: { maximum: 20000, bytes: 1048576, attempts: 8 },
 * 	})
 * );
 * ```
 *
 * @module
 */
import type { TransactionSql } from 'postgres';
import { OutboxError } from './error.ts';

/** A namespace's stored admission policy. */
export interface PolicyType {
	/** Retained messages, terminal ones included, from 1 to 1,000,000. */
	readonly maximum: number;
	/** Canonical JSON payload limit in bytes, from 1 to 16 MiB. */
	readonly bytes: number;
	/** Delivery attempts before a message fails, from 1 to 10,000. */
	readonly attempts: number;
}

/** Reject a policy outside the bounds that `open()` accepts. */
function check(policy: PolicyType): PolicyType {
	const within = (value: number, top: number) => Number.isSafeInteger(value) && value >= 1 && value <= top;
	if (!within(policy.maximum, 1000000) || !within(policy.bytes, 16777216) || !within(policy.attempts, 10000)) {
		throw new RangeError('Invalid outbox policy.');
	}
	return policy;
}

/**
 * Raise `maximum` from `from` to `to` inside the caller's transaction. Only `maximum` may change, and only
 * upward; `bytes` and `attempts` must match. Returns `'resized'`, or `'replayed'` when the stored policy already
 * equals `to`, so a retried migration is safe. Throws `OutboxError` with code `policy` when the stored policy
 * is missing or differs from `from`: someone else changed it, and the change needs another review.
 */
export async function resize(
	tx: TransactionSql,
	input: { readonly namespace: string; readonly from: PolicyType; readonly to: PolicyType },
): Promise<'resized' | 'replayed'> {
	const from = check(input.from), to = check(input.to);
	if (to.maximum < from.maximum || to.bytes !== from.bytes || to.attempts !== from.attempts) {
		throw new RangeError('An outbox resize may only raise maximum.');
	}
	await tx`select pg_advisory_xact_lock(hashtextextended(${`outbox:${input.namespace}`},0))`;
	const row = (await tx`select maximum,bytes,attempts from utils_outbox.policies
		where namespace=${input.namespace} for update`)[0];
	const same = (policy: PolicyType) =>
		row?.maximum === policy.maximum && row.bytes === policy.bytes && row.attempts === policy.attempts;
	if (same(to)) return 'replayed';
	if (!same(from)) throw new OutboxError('policy');
	await tx`update utils_outbox.policies set maximum=${to.maximum} where namespace=${input.namespace}`;
	return 'resized';
}

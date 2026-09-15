/**
 * Input guards for durable workflow control state.
 *
 * These bounds apply to identifiers, admission counts, and temporary leases in
 * both Scheduler and dispatch owners. Keeping them here prevents local hosts
 * from accepting state that a durable adapter would need to reject later.
 *
 * @module
 */

/**
 * Reject an empty or unbounded identifier before it becomes durable state.
 *
 * @internal
 */
export function id(value: string, label: string): void {
	if (typeof value !== 'string' || value.trim().length === 0 || value.length > 512) {
		throw new TypeError(`${label} id must contain 1 to 512 characters.`);
	}
}

/**
 * Return one positive safe integer used for capacity or protocol policy.
 *
 * @internal
 */
export function positive(value: number, label: string): number {
	if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${label} must be a positive safe integer.`);
	return value;
}

/**
 * Return one strictly positive duration used for temporary ownership.
 *
 * @internal
 */
export function duration(value: Temporal.Duration | Temporal.DurationLike | string, label: string): Temporal.Duration {
	const result = Temporal.Duration.from(value);
	if (result.sign <= 0) throw new TypeError(`${label} must be greater than zero.`);
	return result;
}

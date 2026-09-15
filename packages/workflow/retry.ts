/** Deterministic values used by retry policy evaluation. @module */

/**
 * Derive one replay-stable unit interval value from durable instruction identity.
 *
 * @internal
 */
export function unit(value: string): number {
	let hash = 2166136261;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0) / 0xffff_ffff;
}

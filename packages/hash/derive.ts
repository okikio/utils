/** Stable tuple identifiers, independent from random identifier generation. @module */
import { sha256 } from './digest.ts';
/**
 * Derive the original prefix plus 128-bit truncated SHA-256 of a JSON string tuple.
 * Order and embedded separators are preserved. This is a correlation key, not
 * authorization or a uniqueness guarantee. Use a database constraint to detect collisions.
 */
export async function derive(prefix: string, parts: readonly string[]): Promise<string> {
	return `${prefix}-${(await sha256(JSON.stringify(parts))).slice(0, 32)}`;
}

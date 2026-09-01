import { createHash } from 'node:crypto';

/** Hash a small text identity synchronously with SHA-256. */
export function sha256TextHex(value: string): string {
	return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Create a compact 128-bit identity from stable text parts. */
export function stableTextId(prefix: string, parts: readonly string[]): string {
	return `${prefix}_${sha256TextHex(parts.join('\u0000')).slice(0, 32)}`;
}

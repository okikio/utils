/** Secure compact random IDs and stable tuple-derived IDs. @module */
import { bytes } from './random.ts';
import { size } from './_size.ts';
export { derive } from './derive.ts';
/** URL-safe 64-symbol alphabet; 21 characters carry 126 random bits. */
const ALPHABET = '_-0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** A validated reusable random identifier policy. */
export interface OptionsType {
	/** Unique printable ASCII symbols. Two to 94 symbols are supported. */
	readonly alphabet?: string;
	/** Output characters; defaults to 21. Must be between 1 and 1,048,576. */
	readonly length?: number;
}
/**
 * Create an ID function with a fixed alphabet and length. Rejection sampling
 * keeps every symbol equally likely. Randomness always comes from Web Crypto;
 * there is no weak fallback. IDs still require a unique constraint when stored.
 */
export function create(options: OptionsType = {}): () => string {
	const alphabet = options.alphabet ?? ALPHABET;
	const length = options.length ?? 21;
	size(length, 1048576);
	if (length === 0) throw new RangeError('ID length must be positive.');
	if (
		alphabet.length < 2 || alphabet.length > 94 || !/^[\x21-\x7e]+$/.test(alphabet) ||
		new Set(alphabet).size !== alphabet.length
	) throw new TypeError('Alphabet must contain unique printable ASCII symbols.');
	// Reject the tail of the byte domain instead of favoring early symbols.
	const limit = 256 - 256 % alphabet.length;
	return () => {
		const result: string[] = [];
		while (result.length < length) {
			const chunk = bytes(Math.min(4096, Math.ceil((length - result.length) * 256 / limit)));
			for (const value of chunk) {
				if (value < limit) result.push(alphabet[value % alphabet.length]!);
				if (result.length === length) break;
			}
		}
		return result.join('');
	};
}
/** Create a secure URL-safe ID. Length defaults to 21 characters. */
export function random(length: number = 21): string {
	return create({ length })();
}

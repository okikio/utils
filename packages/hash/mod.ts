/**
 * Calculate a content digest or derive a compact identifier from explicit input.
 *
 * Use SHA-2 digests to compare content. Use id() to correlate an ordered tuple of values. These answer
 * different questions: a compact identifier is not a replacement for a full integrity digest. Select a
 * focused subpath for incremental hashing or other algorithm families.
 *
 * @module
 */
export { sha256, sha384, sha512 } from './digest.ts';
export { hex } from './encoding.ts';
export { derive as id } from './derive.ts';
export type { InputType } from './_bytes.ts';

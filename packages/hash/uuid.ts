/** Native UUIDv4 and STD UUID validation, conversion and time-ordered UUIDv7. @module */
import { validate, version as detect } from '@std/uuid/common';
import { extractTimestamp, generate } from '@std/uuid/v7';
import { hex, unhex } from './encoding.ts';
/** All-zero sentinel, accepted by is(), parse() and format(); its version is zero. */
export const NIL = '00000000-0000-0000-0000-000000000000';
/** Create an independently random RFC UUIDv4 with native Web Crypto. */
export function v4(): string {
	return crypto.randomUUID();
}
/**
 * Create a UUIDv7 using STD. Timestamp defaults to Unix milliseconds now.
 * Equal timestamps have random order. Clock rollback can produce smaller IDs;
 * there is no process-global monotonic state or ordering across machines.
 */
export function v7(timestamp?: number): string {
	return generate(timestamp);
}
/** Read the Unix millisecond timestamp of a valid UUIDv7; reject other versions. */
export function timestamp(value: string): number {
	return extractTimestamp(value);
}
/** Accept RFC variant UUID versions 1 through 7 and nil, case-insensitively. */
export function is(value: string): boolean {
	return validate(value);
}
/** Return the validated version, or zero for nil. Unsupported or malformed UUIDs throw. */
export function version(value: string): number {
	return detect(value);
}
/** Decode a validated hyphenated UUID into 16 owned bytes. */
export function parse(value: string): Uint8Array {
	if (!is(value)) throw new TypeError('Expected a UUID version 1 through 7, or nil.');
	return unhex(value.toLowerCase().replaceAll('-', ''));
}
/** Format exactly 16 bytes as a lower-case UUID; reject unsupported versions and variants. */
export function format(value: Uint8Array): string {
	if (value.byteLength !== 16) throw new RangeError('UUID storage must contain exactly 16 bytes.');
	const text = hex(value);
	const result = `${text.slice(0, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}-${text.slice(16, 20)}-${
		text.slice(20)
	}`;
	if (!is(result)) throw new TypeError('Unsupported UUID version or variant.');
	return result;
}

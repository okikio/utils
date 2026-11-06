/** Plan validators after ordinary authentication/routing/existence checks; never apply writes or read a body. @module */
import { date } from '../_date.ts';
/** Metadata belongs to the selected representation, not an untrusted incoming request. */
export interface RepresentationType {
	/** Whether a current representation exists, independently of whether an ETag is available. */
	readonly exists: boolean;
	/** One valid quoted entity tag, including an optional W/ prefix. */
	readonly etag?: string;
	/** Last-Modified HTTP date. Invalid metadata is a programmer error. */
	readonly lastModified?: string;
	/** Explicit proof that Last-Modified can be used as a strong If-Range validator. Defaults to false. */
	readonly strongDate?: boolean;
	/** Epoch milliseconds used to interpret obsolete two-digit years. */
	readonly now: number;
}
/** Continue does not promise that a range is satisfiable. Existing byteRange() owns range syntax and limits. */
export type PreconditionsType =
	| Readonly<{ readonly kind: 'continue'; readonly range: boolean }>
	| Readonly<{ readonly kind: 'not-modified'; readonly status: 304 }>
	| Readonly<{ readonly kind: 'failed'; readonly status: 412 }>
	| Readonly<{ readonly kind: 'invalid'; readonly status: 400; readonly field: 'if-match' | 'if-none-match' }>;
/** RFC etagc deliberately permits commas inside quotes. STD's comma split cannot preserve those opaque tags. */
const Tag = /^(?:W\/)?"[\x21\x23-\x7e\x80-\xff]*"$/;
/** Scan once without allocating a list. undefined means malformed syntax, distinct from a valid nonmatch. */
export function matches(input: string, etag: string | undefined, weak: boolean): boolean | undefined {
	const token = /(?:W\/)?"[\x21\x23-\x7e\x80-\xff]*"/y;
	let offset = 0;
	let matched = false;
	let count = 0;
	while (offset < input.length) {
		while (input[offset] === ' ' || input[offset] === '\t' || input[offset] === ',') offset++;
		if (offset === input.length) break;
		token.lastIndex = offset;
		const found = token.exec(input);
		if (!found) return undefined;
		count++;
		const value = found[0];
		matched ||= etag !== undefined &&
			(weak
				? value.replace(/^W\//, '') === etag.replace(/^W\//, '')
				: !value.startsWith('W/') && !etag.startsWith('W/') && value === etag);
		offset = token.lastIndex;
		while (input[offset] === ' ' || input[offset] === '\t') offset++;
		if (offset < input.length && input[offset] !== ',') return undefined;
	}
	return count > 0 ? matched : undefined;
}
/**
 * Decide whether the selected representation satisfies request conditions.
 *
 * Run authentication, routing and existence checks first. Then this function
 * chooses continue, 304, 412 or malformed entity-list 400 without reading a body
 * or applying a write. CONNECT, OPTIONS and TRACE ignore conditions.
 *
 * If-Match uses strong ETag comparison; If-None-Match uses weak comparison.
 * Entity tags take precedence over their date alternatives. Invalid request
 * dates are ignored, while invalid host-provided validators throw.
 * For continue with range=true, use byteRange() to check range syntax and bounds.
 * With range=false, ignore the Range field and continue normal response handling.
 * Repeated writes are not automatically treated as successful duplicates.
 */
export function preconditions(request: Request, representation: RepresentationType): PreconditionsType {
	const { exists, etag, now } = representation;
	if (
		!Number.isSafeInteger(now) || Math.abs(now) > 8_640_000_000_000_000 || typeof exists !== 'boolean' ||
		(etag !== undefined && !Tag.test(etag))
	) throw new TypeError('Invalid representation validators or clock.');
	const modified = date(representation.lastModified, now);
	if (representation.lastModified !== undefined && modified === undefined) {
		throw new TypeError('Invalid representation Last-Modified.');
	}
	const method = request.method;
	if (['CONNECT', 'OPTIONS', 'TRACE'].includes(method)) return Object.freeze({ kind: 'continue', range: false });
	const safe = method === 'GET' || method === 'HEAD';
	// A supplied entity condition suppresses its older date alternative even
	// when it does not match; do not combine both as independent checks.
	const match = request.headers.get('if-match');
	if (match !== null) {
		const accepted = match.trim() === '*' ? exists : matches(match, exists ? etag : undefined, false);
		if (accepted === undefined) return Object.freeze({ kind: 'invalid', status: 400, field: 'if-match' });
		if (!accepted) return Object.freeze({ kind: 'failed', status: 412 });
	} else {
		const unmodified = date(request.headers.get('if-unmodified-since'), now);
		if (exists && modified !== undefined && unmodified !== undefined && modified > unmodified) {
			return Object.freeze({ kind: 'failed', status: 412 });
		}
	}
	const none = request.headers.get('if-none-match');
	if (none !== null) {
		const matched = none.trim() === '*' ? exists : matches(none, exists ? etag : undefined, true);
		if (matched === undefined) return Object.freeze({ kind: 'invalid', status: 400, field: 'if-none-match' });
		if (matched) {
			return safe
				? Object.freeze({ kind: 'not-modified', status: 304 })
				: Object.freeze({ kind: 'failed', status: 412 });
		}
	} else if (safe) {
		const since = date(request.headers.get('if-modified-since'), now);
		if (exists && modified !== undefined && since !== undefined && modified <= since) {
			return Object.freeze({ kind: 'not-modified', status: 304 });
		}
	}
	let range = method === 'GET' && exists && request.headers.has('range');
	const ifRange = request.headers.get('if-range');
	if (range && ifRange !== null) {
		const value = ifRange.trim();
		range = Tag.test(value)
			? exists && !value.startsWith('W/') && value === etag && !etag?.startsWith('W/')
			: representation.strongDate === true && modified !== undefined && date(value, now) === modified;
	}
	return Object.freeze({ kind: 'continue', range });
}

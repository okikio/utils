/** Lossless values for collection URL filters; field schemas own the accepted types. */
const prefix = '~json:';

export function isTagged(value: unknown): value is `~json:${string}` {
	return typeof value === 'string' && value.startsWith(prefix);
}

export function encodeValue(value: unknown): string {
	return prefix + JSON.stringify(payload(value));
}

export function decodeValue(value: unknown, maximumLength: number, maximumValues: number): unknown {
	if (!isTagged(value)) return value;
	if (value.length > maximumValues * (maximumLength * 6 + 64) + prefix.length + 2) {
		throw new TypeError('Encoded filter value is too long.');
	}
	return decoded(JSON.parse(value.slice(prefix.length)), maximumLength, maximumValues);
}

/** Keep deployed scalar/comma encodings when they are unambiguous. */
export function encodeLegacyValue(value: unknown): string {
	if (Array.isArray(value)) {
		if (value.length > 0 && value.every((entry) => typeof entry === 'string' && safeString(entry, true))) {
			return value.join(',');
		}
		return encodeValue(value);
	}
	if (typeof value === 'string' && safeString(value, false)) return value;
	return encodeValue(value);
}

function safeString(value: string, list: boolean): boolean {
	return value.isWellFormed() && !isTagged(value) && value !== 'null' && value !== 'not_null' &&
		(!list || (value.length > 0 && value.trim() === value && !value.includes(',')));
}

function payload(value: unknown): unknown {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
	if (typeof value === 'number' && Number.isFinite(value)) {
		return Object.is(value, -0) ? { $number: '-0' } : value;
	}
	if (typeof value === 'bigint') return { $bigint: String(value) };
	if (value instanceof Date && Number.isFinite(value.getTime())) return { $date: value.toISOString() };
	if (Array.isArray(value)) {
		return value.map((entry) => {
			if (Array.isArray(entry)) throw new TypeError('Nested filter value arrays are not supported.');
			return payload(entry);
		});
	}
	throw new TypeError('Query wire values must be scalar values, valid Dates, bigints, or scalar lists.');
}

function decoded(value: unknown, maximumLength: number, maximumValues: number): unknown {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (Array.isArray(value)) {
		if (value.length > maximumValues) throw new TypeError('Too many typed filter values.');
		return value.map((entry) => {
			if (Array.isArray(entry)) throw new TypeError('Nested filter value arrays are not supported.');
			return decoded(entry, maximumLength, 1);
		});
	}
	if (typeof value === 'object' && value !== null && Object.keys(value).length === 1) {
		const tag = value as Record<string, unknown>;
		if (
			typeof tag.$bigint === 'string' && tag.$bigint.length <= maximumLength && /^-?(?:0|[1-9]\d*)$/.test(tag.$bigint)
		) return BigInt(tag.$bigint);
		if (typeof tag.$date === 'string') {
			const date = new Date(tag.$date);
			if (Number.isFinite(date.getTime()) && date.toISOString() === tag.$date) return date;
		}
		if (tag.$number === '-0') return -0;
	}
	throw new TypeError('Malformed typed filter value.');
}

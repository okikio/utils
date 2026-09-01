/** Normalize one environment value by treating blank strings as missing. */
export function blank(value: unknown): unknown {
	if (typeof value !== 'string') return value
	const trimmed = value.trim()
	return trimmed === '' ? undefined : trimmed
}

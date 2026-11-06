/** Allocation admission shared by random operations. @module */
/** Validate resource sizes before allocation or mutation. */
export function size(length: number, maximum: number): void {
	if (!Number.isSafeInteger(length) || length < 0 || length > maximum) {
		throw new RangeError(`Length must be an integer between 0 and ${maximum}.`);
	}
}

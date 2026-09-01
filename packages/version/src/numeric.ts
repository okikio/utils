import type { ParsedVersion, VersionOrder, VersionScheme } from '#/types.ts';

const NUMERIC_DOTTED_PATTERN = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\.(\d+))?(?:[-+]([0-9A-Za-z.-]+))?$/u;

/** Generic dotted-numeric scheme for products that do not claim SemVer. */
export const numericDottedVersionScheme: VersionScheme = Object.freeze({
	id: 'numeric-dotted',
	description: 'One to four ordered numeric components with an optional opaque qualifier.',
	parse(value: string): ParsedVersion | undefined {
		const rawValue = value.trim();
		if (!rawValue || rawValue.length > 96) return undefined;
		const match = rawValue.match(NUMERIC_DOTTED_PATTERN);
		if (!match) return undefined;
		const release = match.slice(1, 5).filter((part): part is string => part !== undefined).map(Number);
		if (release.some((part) => !Number.isSafeInteger(part) || part < 0 || part > 999_999)) return undefined;
		const qualifier = match[5];
		const normalizedValue = `${release.join('.')}${qualifier ? `-${qualifier}` : ''}`;
		return {
			schemeId: 'numeric-dotted',
			rawValue,
			normalizedValue,
			precision: precisionFromRelease(release.length, Boolean(qualifier)),
			release,
			...(qualifier ? { qualifier } : {}),
		};
	},
	isEquivalent(left: ParsedVersion, right: ParsedVersion) {
		return sameScheme(left, right) && left.normalizedValue === right.normalizedValue;
	},
	isRefinement(candidate: ParsedVersion, coarse: ParsedVersion) {
		if (!sameScheme(candidate, coarse) || candidate.release.length < coarse.release.length) return false;
		if (!coarse.release.every((part, index) => candidate.release[index] === part)) return false;
		if (coarse.qualifier && candidate.qualifier !== coarse.qualifier) return false;
		return candidate.normalizedValue === coarse.normalizedValue ||
			candidate.release.length > coarse.release.length ||
			Boolean(candidate.qualifier && !coarse.qualifier);
	},
	compareReleaseOrder(left: ParsedVersion, right: ParsedVersion) {
		if (!sameScheme(left, right) || left.release.length !== right.release.length) return undefined;
		const releaseOrder = compareNumericParts(left.release, right.release);
		if (releaseOrder !== 0) return releaseOrder;
		if (left.qualifier === right.qualifier) return 0;
		if (!left.qualifier || !right.qualifier) return undefined;
		return compareText(left.qualifier, right.qualifier);
	},
});

/** Compare dotted numeric components, treating missing trailing components as zero. */
export function compareNumericParts(left: readonly number[], right: readonly number[]): VersionOrder {
	const length = Math.max(left.length, right.length);
	for (let index = 0; index < length; index += 1) {
		const leftPart = left[index] ?? 0;
		const rightPart = right[index] ?? 0;
		if (leftPart < rightPart) return -1;
		if (leftPart > rightPart) return 1;
	}
	return 0;
}

function precisionFromRelease(length: number, hasQualifier: boolean): ParsedVersion['precision'] {
	if (hasQualifier || length >= 3) return 'exact';
	if (length === 2) return 'release_line';
	if (length === 1) return 'major';
	return 'unknown';
}

function sameScheme(left: ParsedVersion, right: ParsedVersion): boolean {
	return left.schemeId === numericDottedVersionScheme.id && right.schemeId === numericDottedVersionScheme.id;
}

function compareText(left: string, right: string): VersionOrder {
	const comparison = left.localeCompare(right, undefined, { numeric: true });
	return comparison < 0 ? -1 : comparison > 0 ? 1 : 0;
}

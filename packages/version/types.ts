/** Precision represented by one parsed version observation. */
export type VersionPrecision =
	| 'exact'
	| 'vendor_patch'
	| 'release_line'
	| 'major'
	| 'family'
	| 'unknown';

/** Relative release order returned only when two versions are comparable. */
export type VersionOrder = -1 | 0 | 1;

/**
 * Version value normalized by one declared scheme.
 *
 * `release` contains only ordered numeric release components. Scheme-specific
 * qualifiers remain explicit so Adobe `-pN` patches are not misread as SemVer
 * prereleases.
 */
export interface ParsedVersion {
	readonly schemeId: string;
	readonly rawValue: string;
	readonly normalizedValue: string;
	readonly precision: VersionPrecision;
	readonly release: readonly number[];
	readonly prerelease?: readonly (string | number)[];
	readonly build?: readonly string[];
	readonly vendorPatch?: number;
	readonly qualifier?: string;
}

/** One parser and comparator for a concrete version convention. */
export interface VersionScheme {
	readonly id: string;
	readonly description: string;
	parse(value: string): ParsedVersion | undefined;
	isEquivalent(left: ParsedVersion, right: ParsedVersion): boolean;
	isRefinement(candidate: ParsedVersion, coarse: ParsedVersion): boolean;
	compareReleaseOrder(left: ParsedVersion, right: ParsedVersion): VersionOrder | undefined;
}

/** Read-only lookup used by analysis without a mutable global registry. */
export interface VersionSchemeCatalog {
	readonly schemes: readonly VersionScheme[];
	readonly schemesById: ReadonlyMap<string, VersionScheme>;
	get(id: string): VersionScheme;
}

/** Unresolved version evidence supplied by a detector or extractor. */
export interface VersionCandidate {
	readonly value: string;
	readonly schemeId: string;
	readonly source: string;
	readonly sourcePriority: number;
	readonly confidence?: number;
	readonly evidenceId?: string;
}

/** Candidate after scheme-specific parsing and normalization. */
export interface ParsedVersionCandidate extends VersionCandidate {
	readonly parsed: ParsedVersion;
}

/** One incompatible candidate retained rather than silently discarded. */
export interface VersionConflict {
	readonly selected: ParsedVersionCandidate;
	readonly competing: ParsedVersionCandidate;
	readonly reason: 'different_release' | 'different_vendor_patch' | 'different_qualifier' | 'different_scheme';
}

/** Final evidence-aware resolution for one technology component. */
export interface VersionResolution {
	readonly status: 'resolved' | 'refined' | 'conflicted' | 'insufficient_evidence';
	readonly selected?: ParsedVersionCandidate;
	readonly candidates: readonly ParsedVersionCandidate[];
	readonly rejectedValues: readonly string[];
	readonly conflicts: readonly VersionConflict[];
}

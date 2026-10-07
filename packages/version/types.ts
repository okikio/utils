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
	/** Stable identity of the selected interpretation scheme. */
	readonly schemeId: string;
	/** Original source value retained before normalization or interpretation. */
	readonly rawValue: string;
	/** Canonical interpreted value while retaining the separate original source value. */
	readonly normalizedValue: string;
	/** Granularity represented by the interpreted value. */
	readonly precision: VersionPrecision;
	/** Numeric release components retained in source order, such as [2, 4, 1]. */
	readonly release: readonly number[];
	/** Prerelease components retained by the version scheme. */
	readonly prerelease?: readonly (string | number)[];
	/** Build metadata preserved by the version scheme. */
	readonly build?: readonly string[];
	/** Vendor-specific patch metadata retained by the interpretation scheme. */
	readonly vendorPatch?: number;
	/** Additional qualifier preserved by the selected interpretation. */
	readonly qualifier?: string;
}

/** One parser and comparator for a concrete version convention. */
export interface VersionScheme {
	/** Stable identity used to correlate this contract or occurrence. */
	readonly id: string;
	/** Caller-authored purpose used in documentation and diagnostics. */
	readonly description: string;
	/** Interpret source data while retaining structured evidence or rejection details. */
	parse(value: string): ParsedVersion | undefined;
	/** Compare interpreted values under this scheme rather than raw source spelling. */
	isEquivalent(left: ParsedVersion, right: ParsedVersion): boolean;
	/** Whether one interpreted value adds precision while remaining compatible with the other. */
	isRefinement(candidate: ParsedVersion, coarse: ParsedVersion): boolean;
	/** Compare releases under this version scheme, independently of source spelling. */
	compareReleaseOrder(left: ParsedVersion, right: ParsedVersion): VersionOrder | undefined;
}

/** Read-only lookup used by analysis without a mutable global registry. */
export interface VersionSchemeCatalog {
	/** Available interpretation schemes selected by the caller. */
	readonly schemes: readonly VersionScheme[];
	/** Interpretation schemes indexed by their stable IDs. */
	readonly schemesById: ReadonlyMap<string, VersionScheme>;
	/** Find the exact registered scheme by ID; an unknown ID throws. */
	get(id: string): VersionScheme;
}

/** Unresolved version evidence supplied by a detector or extractor. */
export interface VersionCandidate {
	/** Value carried by this contract; its schema and owner define the accepted shape. */
	readonly value: string;
	/** Stable identity of the selected interpretation scheme. */
	readonly schemeId: string;
	/** Source representation or provenance retained alongside the interpreted value. */
	readonly source: string;
	/** Priority assigned to the source when interpretations compete. */
	readonly sourcePriority: number;
	/** Evidence confidence under this classifier; it is not a guarantee of external truth. */
	readonly confidence?: number;
	/** Stable identity of the source observation supporting the classification. */
	readonly evidenceId?: string;
}

/** Candidate after scheme-specific parsing and normalization. */
export interface ParsedVersionCandidate extends VersionCandidate {
	/** Interpreted structure retained after successful parsing. */
	readonly parsed: ParsedVersion;
}

/** One incompatible candidate retained rather than silently discarded. */
export interface VersionConflict {
	/** Selected interpretation, if the evidence permits one. */
	readonly selected: ParsedVersionCandidate;
	/** Competing interpretations retained when the evidence is ambiguous. */
	readonly competing: ParsedVersionCandidate;
	/** Scheme-specific reason that two parsed candidates cannot be treated as the same release. */
	readonly reason: 'different_release' | 'different_vendor_patch' | 'different_qualifier' | 'different_scheme';
}

/** Final evidence-aware resolution for one technology component. */
export interface VersionResolution {
	/** Resolution branch that distinguishes agreement, refinement, conflict and missing evidence. */
	readonly status: 'resolved' | 'refined' | 'conflicted' | 'insufficient_evidence';
	/** Selected interpretation, if the evidence permits one. */
	readonly selected?: ParsedVersionCandidate;
	/** Candidate interpretations retained before selecting one interpretation. */
	readonly candidates: readonly ParsedVersionCandidate[];
	/** Values rejected by interpretation rather than silently discarded. */
	readonly rejectedValues: readonly string[];
	/** Incompatible observations retained for explicit resolution. */
	readonly conflicts: readonly VersionConflict[];
}

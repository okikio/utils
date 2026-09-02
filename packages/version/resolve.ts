import type {
	ParsedVersion,
	ParsedVersionCandidate,
	VersionCandidate,
	VersionConflict,
	VersionPrecision,
	VersionResolution,
	VersionSchemeCatalog,
} from '#/types.ts';

const PRECISION_SCORES: Record<VersionPrecision, number> = {
	vendor_patch: 5_000_000,
	exact: 4_000_000,
	release_line: 3_000_000,
	major: 2_000_000,
	family: 1_000_000,
	unknown: 0,
};

/** Parse, rank, and reconcile version evidence without hiding incompatible exact candidates. */
export function resolveVersionCandidates(
	candidates: readonly VersionCandidate[],
	catalog: VersionSchemeCatalog,
): VersionResolution {
	const parsed: ParsedVersionCandidate[] = [];
	const rejectedValues: string[] = [];
	for (const candidate of candidates) {
		const scheme = catalog.schemesById.get(candidate.schemeId);
		const value = scheme?.parse(candidate.value);
		if (!value) {
			rejectedValues.push(candidate.value);
			continue;
		}
		parsed.push({ ...candidate, value: value.normalizedValue, parsed: value });
	}
	const uniqueCandidates = deduplicateCandidates(parsed).sort(compareCandidates);
	const selected = uniqueCandidates[0];
	if (!selected) {
		return {
			status: 'insufficient_evidence',
			candidates: [],
			rejectedValues: uniqueStrings(rejectedValues),
			conflicts: [],
		};
	}

	const conflicts = uniqueCandidates.slice(1)
		.map((candidate) => createConflict(selected, candidate, catalog))
		.filter((conflict): conflict is VersionConflict => conflict !== undefined);
	const hasRefinement = uniqueCandidates.some((candidate) =>
		candidate !== selected &&
		candidate.parsed.normalizedValue !== selected.parsed.normalizedValue &&
		isCompatibleRefinement(selected, candidate, catalog)
	);
	return {
		status: conflicts.length > 0 ? 'conflicted' : hasRefinement ? 'refined' : 'resolved',
		selected,
		candidates: uniqueCandidates,
		rejectedValues: uniqueStrings(rejectedValues),
		conflicts,
	};
}

/** Score candidate specificity and evidence strength without comparing release age. */
export function versionCandidateScore(candidate: ParsedVersionCandidate): number {
	const confidence = Math.round(Math.max(0, Math.min(100, candidate.confidence ?? 0)));
	const sourcePriority = Math.round(Math.max(0, Math.min(9_999, candidate.sourcePriority)));
	return PRECISION_SCORES[candidate.parsed.precision] + sourcePriority + confidence;
}

function compareCandidates(left: ParsedVersionCandidate, right: ParsedVersionCandidate): number {
	return versionCandidateScore(right) - versionCandidateScore(left) ||
		right.parsed.release.length - left.parsed.release.length ||
		left.parsed.normalizedValue.localeCompare(right.parsed.normalizedValue, undefined, { numeric: true }) ||
		(left.evidenceId ?? '').localeCompare(right.evidenceId ?? '');
}

function deduplicateCandidates(candidates: readonly ParsedVersionCandidate[]): ParsedVersionCandidate[] {
	const unique = new Map<string, ParsedVersionCandidate>();
	for (const candidate of candidates) {
		const key = [candidate.schemeId, candidate.parsed.normalizedValue, candidate.source, candidate.evidenceId ?? '']
			.join('\u0000');
		if (!unique.has(key)) unique.set(key, candidate);
	}
	return [...unique.values()];
}

function createConflict(
	selected: ParsedVersionCandidate,
	competing: ParsedVersionCandidate,
	catalog: VersionSchemeCatalog,
): VersionConflict | undefined {
	if (selected.schemeId !== competing.schemeId) {
		return { selected, competing, reason: 'different_scheme' };
	}
	const scheme = catalog.get(selected.schemeId);
	if (scheme.isEquivalent(selected.parsed, competing.parsed)) return undefined;
	if (isCompatibleRefinement(selected, competing, catalog) || isCompatibleRefinement(competing, selected, catalog)) {
		return undefined;
	}
	if (selected.parsed.normalizedValue === competing.parsed.normalizedValue) return undefined;
	const sameRelease = sameNumericRelease(selected.parsed, competing.parsed);
	const hasVendorPatch = selected.parsed.vendorPatch !== undefined || competing.parsed.vendorPatch !== undefined;
	return {
		selected,
		competing,
		reason: !sameRelease ? 'different_release' : hasVendorPatch ? 'different_vendor_patch' : 'different_qualifier',
	};
}

function isCompatibleRefinement(
	candidate: ParsedVersionCandidate,
	coarse: ParsedVersionCandidate,
	catalog: VersionSchemeCatalog,
): boolean {
	if (candidate.schemeId !== coarse.schemeId) return false;
	return catalog.get(candidate.schemeId).isRefinement(candidate.parsed, coarse.parsed);
}

function sameNumericRelease(left: ParsedVersion, right: ParsedVersion): boolean {
	return left.release.length === right.release.length &&
		left.release.every((part, index) => part === right.release[index]);
}

function uniqueStrings(values: readonly string[]): readonly string[] {
	return [...new Set(values)];
}

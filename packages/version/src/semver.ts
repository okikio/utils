import { compare, format, type SemVer, tryParse } from '@std/semver';

import type { ParsedVersion, VersionOrder, VersionScheme } from '#/types.ts';

const PARTIAL_SEMVER_PATTERN = /^v?(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?$/u;

/** Strict Semantic Versioning with explicit support for coarse major/minor observations. */
export const semanticVersionScheme: VersionScheme = Object.freeze({
	id: 'semver',
	description: 'Semantic Versioning 2.0.0; major and major.minor observations are retained as coarse families.',
	parse(value: string): ParsedVersion | undefined {
		const rawValue = value.trim();
		if (!rawValue || rawValue.length > 96) return undefined;
		const semverValue = rawValue.replace(/^v(?=\d)/iu, '');
		const semver = tryParse(semverValue);
		if (semver) return parsedSemVer(rawValue, semver);
		const partial = rawValue.match(PARTIAL_SEMVER_PATTERN);
		if (!partial) return undefined;
		const release = partial.slice(1, 3).filter((part): part is string => part !== undefined).map(Number);
		return {
			schemeId: 'semver',
			rawValue,
			normalizedValue: release.join('.'),
			precision: release.length === 1 ? 'major' : 'release_line',
			release,
		};
	},
	isEquivalent(left: ParsedVersion, right: ParsedVersion) {
		if (!sameScheme(left, right)) return false;
		const leftSemVer = toSemVer(left);
		const rightSemVer = toSemVer(right);
		if (leftSemVer && rightSemVer) return compare(leftSemVer, rightSemVer) === 0;
		return left.normalizedValue === right.normalizedValue;
	},
	isRefinement(candidate: ParsedVersion, coarse: ParsedVersion) {
		if (!sameScheme(candidate, coarse) || candidate.release.length < coarse.release.length) return false;
		if (!coarse.release.every((part, index) => candidate.release[index] === part)) return false;
		if (candidate.normalizedValue === coarse.normalizedValue) return true;
		return candidate.release.length > coarse.release.length;
	},
	compareReleaseOrder(left: ParsedVersion, right: ParsedVersion) {
		if (!sameScheme(left, right)) return undefined;
		const leftSemVer = toSemVer(left);
		const rightSemVer = toSemVer(right);
		if (!leftSemVer || !rightSemVer) return undefined;
		return compare(leftSemVer, rightSemVer) as VersionOrder;
	},
});

function parsedSemVer(rawValue: string, semver: SemVer): ParsedVersion {
	const prerelease = semver.prerelease && semver.prerelease.length > 0 ? [...semver.prerelease] : [];
	const build = semver.build && semver.build.length > 0 ? [...semver.build] : undefined;
	return {
		schemeId: 'semver',
		rawValue,
		normalizedValue: format(semver),
		precision: 'exact',
		release: [semver.major, semver.minor, semver.patch],
		prerelease,
		build,
	};
}

function toSemVer(version: ParsedVersion): SemVer | undefined {
	if (version.release.length !== 3) return undefined;
	const [major, minor, patch] = version.release;
	if (major === undefined || minor === undefined || patch === undefined) return undefined;
	return {
		major,
		minor,
		patch,
		prerelease: [...(version.prerelease ?? [])],
		build: [...(version.build ?? [])],
	};
}

function sameScheme(left: ParsedVersion, right: ParsedVersion): boolean {
	return left.schemeId === semanticVersionScheme.id && right.schemeId === semanticVersionScheme.id;
}

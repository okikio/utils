import { expect } from '@std/expect';
import { describe, it } from 'node:test';

import {
	createVersionSchemeCatalog,
	numericDottedVersionScheme,
	resolveVersionCandidates,
	semanticVersionScheme,
} from '#/index.ts';

describe('semantic version scheme', () => {
	it('uses @std/semver for exact validation and retains partial families', () => {
		expect(semanticVersionScheme.parse('2')?.precision).toBe('major');
		expect(semanticVersionScheme.parse('2.4')?.precision).toBe('release_line');
		expect(semanticVersionScheme.parse('2.4.6')?.normalizedValue).toBe('2.4.6');
		expect(semanticVersionScheme.parse('v2.4.6')?.normalizedValue).toBe('2.4.6');
		expect(semanticVersionScheme.parse('2.04.6')).toBeUndefined();
	});
});

describe('numeric dotted version scheme', () => {
	it('accepts four-part product releases without claiming Semantic Versioning', () => {
		const parsed = numericDottedVersionScheme.parse('2.11.16.1');

		expect(parsed?.normalizedValue).toBe('2.11.16.1');
		expect(parsed?.precision).toBe('exact');
		expect(parsed?.release).toEqual([2, 11, 16, 1]);
	});
});

describe('version resolution', () => {
	it('selects an exact refinement over a major-family observation', () => {
		const catalog = createVersionSchemeCatalog([semanticVersionScheme, numericDottedVersionScheme]);
		const resolution = resolveVersionCandidates([
			{ value: '2', schemeId: 'semver', source: 'detector', sourcePriority: 60 },
			{ value: '2.4.6', schemeId: 'semver', source: 'asset', sourcePriority: 30 },
		], catalog);
		expect(resolution.status).toBe('refined');
		expect(resolution.selected?.value).toBe('2.4.6');
		expect(resolution.conflicts).toEqual([]);
	});

	it('treats SemVer build metadata as equivalent release evidence', () => {
		const catalog = createVersionSchemeCatalog([semanticVersionScheme]);
		const resolution = resolveVersionCandidates([
			{ value: '2.4.6+build.1', schemeId: 'semver', source: 'asset-a', sourcePriority: 60 },
			{ value: '2.4.6+build.2', schemeId: 'semver', source: 'asset-b', sourcePriority: 50 },
		], catalog);

		expect(resolution.status).toBe('resolved');
		expect(resolution.conflicts).toEqual([]);
		expect(resolution.candidates).toHaveLength(2);
	});

	it('retains incompatible exact candidates as a conflict', () => {
		const catalog = createVersionSchemeCatalog([semanticVersionScheme]);
		const resolution = resolveVersionCandidates([
			{ value: '2.4.6', schemeId: 'semver', source: 'asset-a', sourcePriority: 60 },
			{ value: '2.4.7', schemeId: 'semver', source: 'asset-b', sourcePriority: 50 },
		], catalog);
		expect(resolution.status).toBe('conflicted');
		expect(resolution.conflicts).toHaveLength(1);
	});

	it('distinguishes SemVer qualifier conflicts from vendor-patch conflicts', () => {
		const catalog = createVersionSchemeCatalog([semanticVersionScheme]);
		const resolution = resolveVersionCandidates([
			{ value: '2.4.6', schemeId: 'semver', source: 'asset-a', sourcePriority: 60 },
			{ value: '2.4.6-rc.1', schemeId: 'semver', source: 'asset-b', sourcePriority: 50 },
		], catalog);

		expect(resolution.status).toBe('conflicted');
		expect(resolution.conflicts[0]?.reason).toBe('different_qualifier');
	});

	it('never lets source priority make a coarse version outrank a more precise compatible version', () => {
		const catalog = createVersionSchemeCatalog([semanticVersionScheme]);
		const resolution = resolveVersionCandidates([
			{ value: '2', schemeId: 'semver', source: 'coarse-direct', sourcePriority: 9_999, confidence: 100 },
			{ value: '2.4', schemeId: 'semver', source: 'release-line', sourcePriority: 9_999, confidence: 100 },
			{ value: '2.4.6', schemeId: 'semver', source: 'exact-asset', sourcePriority: 0, confidence: 0 },
		], catalog);

		expect(resolution.selected?.parsed.normalizedValue).toBe('2.4.6');
		expect(resolution.status).toBe('refined');
	});

	it('treats corroborating identical versions as resolved rather than refined', () => {
		const catalog = createVersionSchemeCatalog([semanticVersionScheme]);
		const resolution = resolveVersionCandidates([
			{ value: '2.4.6', schemeId: 'semver', source: 'declaration', sourcePriority: 60 },
			{ value: '2.4.6', schemeId: 'semver', source: 'asset', sourcePriority: 30 },
		], catalog);

		expect(resolution.selected?.parsed.normalizedValue).toBe('2.4.6');
		expect(resolution.status).toBe('resolved');
		expect(resolution.conflicts).toEqual([]);
	});
});

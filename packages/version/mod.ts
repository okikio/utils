/**
 * Resolve release evidence by scheme and precision instead of trusting lexical order or whichever detector has the highest priority. A coarse version observation should not erase a compatible exact release.
 *
 * Start with SemVer evidence, add numeric dotted schemes for vendor formats, and retain conflicting exact candidates for review. Compatible refinement takes precedence over source priority. A scheme describes version ordering and compatibility; it does not discover the software or establish that an observed version is trustworthy.
 *
 * @example
 * ```ts
 * import { createVersionSchemeCatalog, resolveVersionCandidates, semanticVersionScheme } from '@okikio/version';
 * const schemes = createVersionSchemeCatalog([semanticVersionScheme]);
 * const value = resolveVersionCandidates([
 *   { value: '2', schemeId: 'semver', source: 'header', sourcePriority: 100 },
 *   { value: '2.4.6', schemeId: 'semver', source: 'asset', sourcePriority: 20 },
 * ], schemes);
 * console.log(value.status, value.selected?.value);
 * ```
 *
 * @module
 */
export { catalog as createVersionSchemeCatalog } from './catalog.ts';
export { numericDottedVersionScheme } from './numeric.ts';
export { resolveVersionCandidates, versionCandidateScore } from './resolve.ts';
export { semanticVersionScheme } from './semver.ts';
export type {
	ParsedVersion,
	ParsedVersionCandidate,
	VersionCandidate,
	VersionConflict,
	VersionOrder,
	VersionPrecision,
	VersionResolution,
	VersionScheme,
	VersionSchemeCatalog,
} from './types.ts';

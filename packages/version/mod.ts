export { createVersionSchemeCatalog } from './catalog.ts';
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

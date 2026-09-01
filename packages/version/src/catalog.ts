import type { VersionScheme, VersionSchemeCatalog } from '#/types.ts';

/** Create an immutable catalog and reject duplicate scheme identities. */
export function createVersionSchemeCatalog(schemes: readonly VersionScheme[]): VersionSchemeCatalog {
	const schemesById = new Map<string, VersionScheme>();
	for (const scheme of schemes) {
		if (schemesById.has(scheme.id)) throw new TypeError(`Duplicate version scheme id: ${scheme.id}`);
		schemesById.set(scheme.id, scheme);
	}
	return Object.freeze({
		schemes: Object.freeze([...schemes]),
		schemesById,
		get(id: string): VersionScheme {
			const scheme = schemesById.get(id);
			if (!scheme) throw new TypeError(`Unknown version scheme id: ${id}`);
			return scheme;
		},
	});
}

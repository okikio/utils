/** PGlite: PostgreSQL compiled to WebAssembly, in this process. @module */
import type { StartedType, TargetType } from './types.ts';

/** PGlite in this process. Only the PGlite client can reach it. */
const inProcess: TargetType = {
	name: 'pglite',
	about: 'PGlite 0.6 in this process (PostgreSQL 17 in WebAssembly).',
	kind: 'embedded',
	reach: 'embedded',
	start(): Promise<StartedType> {
		return Promise.resolve({
			version: 'PGlite in process',
			embedded: true,
			stop: () => Promise.resolve(),
		});
	},
};

/**
 * PGlite's socket server is left out: it runs one connection at a time on one PGlite, so pooled clients see dropped
 * connections at random, which would make the suite fail without a change to the package.
 */
export const embedded: readonly TargetType[] = [inProcess];

/**
 * Installation-level entry point for the Okikio utility suite.
 *
 * Installing `@okikio/utils` installs every focused utility package. Import a
 * focused subpath such as `@okikio/utils/queue` for ordinary use, or opt into
 * `@okikio/utils/all` when one application intentionally needs the full graph.
 * The root stays dependency-light and import-safe across runtimes.
 *
 * @module
 */

/** Package names included by the umbrella installation. */
export const packages = Object.freeze([
	'@okikio/activity',
	'@okikio/capacity',
	'@okikio/catalog',
	'@okikio/codec',
	'@okikio/concurrency',
	'@okikio/context',
	'@okikio/css',
	'@okikio/csv',
	'@okikio/deno',
	'@okikio/dispose',
	'@okikio/duration',
	'@okikio/effect',
	'@okikio/email',
	'@okikio/entitlement',
	'@okikio/env',
	'@okikio/failure',
	'@okikio/fault',
	'@okikio/hash',
	'@okikio/hono',
	'@okikio/html',
	'@okikio/http',
	'@okikio/meter',
	'@okikio/permission',
	'@okikio/pool',
	'@okikio/process',
	'@okikio/query',
	'@okikio/queue',
	'@okikio/record',
	'@okikio/requirement',
	'@okikio/resilience',
	'@okikio/resource',
	'@okikio/result',
	'@okikio/robots',
	'@okikio/schema',
	'@okikio/server',
	'@okikio/sitemap',
	'@okikio/streams',
	'@okikio/task',
	'@okikio/version',
	'@okikio/worker',
	'@okikio/workflow',
] as const);

/** Package name included by the umbrella installation. */
export type PackageName = typeof packages[number];

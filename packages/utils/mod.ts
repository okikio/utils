/**
 * Install the suite once while importing only the focused surface a consumer needs. An eager namespace import can otherwise pull parsers, adapters and server implementations into a small program.
 *
 * Use @okikio/utils/<package> for one-install convenience or install @okikio/<package> independently. Deep subpaths preserve each focused export, including explicit polyfills and runtime adapters. The root inventory is lightweight; the all facade is a deliberate eager choice. All packages are currently version 0.0.0 and experimental, so validate the exact export and contract when upgrading.
 *
 * @example
 * ```ts
 * import * as result from '@okikio/utils/result';
 * import * as record from '@okikio/utils/record';
 * const value = result.ok({ id: 'asset-1' });
 * console.log(record.keys(result.unwrap(value)).join(','));
 * ```
 *
 * @module
 */
/** Package names included by the umbrella installation. */
export const packages = Object.freeze(
	[
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
		'@okikio/telemetry',
		'@okikio/version',
		'@okikio/worker',
		'@okikio/workflow',
	] as const,
);

/** Package name included by the umbrella installation. */
export type PackageName = typeof packages[number];

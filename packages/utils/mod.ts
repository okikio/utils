/**
 * Import focused utilities through one package installation.
 *
 * Select a subpath such as @okikio/utils/http/request for the operation you need. The umbrella preserves
 * the focused packages' programming model; it does not replace their ownership, validation, or
 * cancellation contracts.
 *
 * @module
 */
/**
 * Frozen inventory of focused package names. Reading it imports no focused
 * implementations; use the selected subpath to load one capability.
 */
export const packages = Object.freeze(
	[
		'@okikio/activity',
		'@okikio/authz',
		'@okikio/capability',
		'@okikio/collection',
		'@okikio/context',
		'@okikio/dispose',
		'@okikio/duration',
		'@okikio/env',
		'@okikio/format',
		'@okikio/hash',
		'@okikio/hono',
		'@okikio/http',
		'@okikio/input',
		'@okikio/pool',
		'@okikio/query',
		'@okikio/result',
		'@okikio/runtime',
		'@okikio/scheduler',
		'@okikio/schema',
		'@okikio/server',
		'@okikio/storage',
		'@okikio/streams',
		'@okikio/task',
		'@okikio/telemetry',
		'@okikio/worker',
		'@okikio/workflow',
	] as const,
);
/** Package identity included by this installation. */
export type PackageName = typeof packages[number];

/** Deno permission-aware Worker adapter for `@okikio/worker`. */
import type { Context } from '@okikio/context';
import * as worker from './mod.ts';
import type { WorkerOpenOptions, RawWorker, WorkerHandle } from './types.ts';

/** Options that add Deno Worker permissions to the standard Worker protocol. */
export interface DenoOptions<Request, Response> extends Omit<WorkerOpenOptions<Request, Response>, 'create'> {
	readonly permissions?: Deno.PermissionOptions;
}

/**
 * Opens one Deno Worker while keeping permission policy out of the generic Worker API.
 *
 * Request correlation, validation, cancellation, and shutdown still belong to
 * `@okikio/worker`. This adapter only adds the Deno-specific `permissions` option
 * when the raw Worker is constructed.
 */
export function open<Request, Response>(
	ctx: Context,
	options: DenoOptions<Request, Response>,
): WorkerHandle<Request, Response> {
	return worker.open(ctx, {
		...options,
		create(module, workerOptions) {
			return new Worker(module, {
				...workerOptions,
				deno: { permissions: options.permissions ?? 'inherit' },
			} as WorkerOptions & { deno: { permissions: Deno.PermissionOptions } }) as RawWorker;
		},
	});
}

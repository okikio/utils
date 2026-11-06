/** Deno permission-aware Worker adapter for `@okikio/worker/thread`. */
import type { Context } from '@okikio/context';
import * as worker from '@okikio/worker/thread';
import type { RawWorker, WorkerHandle, WorkerOpenOptions } from '@okikio/worker/thread/types';

/** Options that add Deno Worker permissions to the standard Worker protocol. */
export interface DenoOptions<Request, Response, Notice = never, CallRequest = never, CallResponse = never>
	extends Omit<WorkerOpenOptions<Request, Response, Notice, CallRequest, CallResponse>, 'create'> {
	/** Explicit Deno Worker permissions for this realm; the host grants only what its work needs. */
	readonly permissions?: Deno.PermissionOptions;
}

/**
 * Opens one Deno Worker while keeping permission policy out of the generic Worker API.
 *
 * Request correlation, validation, cancellation, and shutdown still belong to
 * `@okikio/worker/thread`. This adapter only adds the Deno-specific `permissions` option
 * when the raw Worker is constructed.
 */
export function open<Request, Response, Notice = never, CallRequest = never, CallResponse = never>(
	ctx: Context,
	options: DenoOptions<Request, Response, Notice, CallRequest, CallResponse>,
): WorkerHandle<Request, Response> {
	return worker.open(ctx, {
		...options,
		create(module, workerOptions) {
			return new Worker(
				module,
				{
					...workerOptions,
					deno: { permissions: options.permissions ?? 'inherit' },
				} as WorkerOptions & { deno: { permissions: Deno.PermissionOptions } },
			) as RawWorker;
		},
	});
}

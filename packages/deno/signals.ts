/**
 * Deno process-signal integration for owned operation contexts.
 *
 * The context remains the lifetime owner. Signal listeners are removed through
 * the context's cleanup stack, so executable roots do not repeat listener
 * registration and `try/finally` cleanup.
 *
 * @module
 */
import * as context from '@okikio/context';

/** Options for attaching process stop signals to one owned context. */
export interface AttachOptions {
	/** Human-readable cancellation reason projected into the context. */
	readonly message?: string;
	/** Whether SIGTERM should be observed where the runtime supports it. */
	readonly term?: boolean;
}

/**
 * Attach SIGINT and, by default, SIGTERM to one owned context.
 *
 * Listener cleanup is registered on the same context, so disposing the context
 * always releases the process-global listeners.
 */
export function attach(ctx: context.Owned, options: AttachOptions = {}): void {
	const message = options.message?.trim() || 'Process stopping.';
	const stop = () => context.cancel(ctx, new DOMException(message, 'AbortError'));
	const term = options.term !== false && Deno.build.os !== 'windows';

	Deno.addSignalListener('SIGINT', stop);
	if (term) Deno.addSignalListener('SIGTERM', stop);
	ctx.defer(() => {
		Deno.removeSignalListener('SIGINT', stop);
		if (term) Deno.removeSignalListener('SIGTERM', stop);
	});
}

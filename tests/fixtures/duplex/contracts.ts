/** One exact activity contract shared by browser callers and an isolated container host. @module */
import * as context from '@okikio/context';
import type { Context } from '@okikio/context';
import * as schema from '@okikio/schema';
import * as codec from '@okikio/schema/codec';
import * as activity from '@okikio/activity';
import * as engine from '@okikio/activity/engine';
import * as effect from '@okikio/capability/effect';
import * as permission from '@okikio/authz/permission';
import type { ActivityAttemptType } from '@okikio/workflow';

/** The same imported identity is used on both sides; it starts no process on import. */
export const Engine = engine.define({ id: 'duplex.container' });
/** Input chooses authority work or cancellation with a deliberately held cleanup phase. */
export const InputSchema = schema.object({
	/** Unique scenario identity; metrics and release address this value rather than a session token. */
	id: schema.string({ minLength: 1, maxLength: 128 }),
	/** authority returns after controls; wait remains active until cancellation. */
	mode: schema.oneOf(['authority', 'wait']),
	/** manual waits for release(id); failure throws from the provider's real finally block. */
	cleanup: schema.oneOf(['automatic', 'manual', 'failure']),
	/** Reverse heartbeat count. Browser and container benchmarks sweep this finite workload. */
	calls: schema.optional(schema.number({ integer: true, minimum: 1, maximum: 32 })),
});
/** Exact runtime-validated scenario input for caller helpers. */
export type InputType = schema.Output<typeof InputSchema>;
/** A result includes the real host PID so host/container work cannot be confused. */
export const OutputSchema = schema.object({ id: schema.string(), pid: schema.number({ integer: true, minimum: 1 }) });
/** Declared permission must be answered by the original caller, never by a local default. */
export const Permission = permission.define({ id: 'duplex.container.write', target: schema.string() });
/** The original caller owns acceptance of this declared, keyed effect. */
export const Effect = effect.define({
	id: 'duplex.container.stored',
	value: codec.identity(schema.object({ id: schema.string() })),
});
/** The container implementation and browser caller import this exact checked contract. */
export const Work = activity.define({
	id: 'duplex.container.work',
	version: '1',
	input: codec.identity(InputSchema),
	result: codec.identity(OutputSchema),
	placement: engine.require(Engine),
	requirements: [permission.require(Permission)],
	effects: [Effect],
});
/** Capture a complete fenced Scheduler-shaped attempt without carrying credentials or live resources. */
export function attempt(ctx: Context, input: InputType): ActivityAttemptType {
	return {
		jobId: input.id,
		claimId: `claim:${input.id}`,
		attempt: 1,
		generation: 1,
		activityId: Work.id,
		activityVersion: Work.version,
		engineId: Engine.id,
		registrationId: 'duplex.container.registration',
		hostId: 'duplex.container.host',
		admitted: true,
		origin: {
			workflowId: 'duplex.container.workflow',
			workflowVersion: '1',
			runId: input.id,
			instructionPath: '0',
			instructionFingerprint: 'duplex.container.fingerprint',
		},
		context: context.snapshot(ctx),
		input,
	};
}

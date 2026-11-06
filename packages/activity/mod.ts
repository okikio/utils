/**
 * Define one named operation with checked input and output. For example, a photo activity can require a
 * storage resource, save a label, and return the new photo ID.
 *
 * A definition describes the operation. Its implementation performs the work. A local call runs one
 * attempt; a workflow executor can run the same definition as a saved job. The activity owns its attempt
 * context and borrows its resources.
 *
 * An engine selects where work may run. Moving work to a thread or process does not transfer live
 * connections or closures. Dispatch and storage adapters own saved claims, leases, and recovery.
 *
 * @example
 * ```ts
 * import * as activity from '@okikio/activity';
 * import * as engine from '@okikio/activity/engine';
 * import * as context from '@okikio/context';
 * import * as resource from '@okikio/capability/resource';
 * import * as schema from '@okikio/schema';
 * import { HostSelectionError } from './selection.ts';
 *
 * const Local = engine.define({ id: 'local' });
 * const Upper = activity.define({
 * 	id: 'text.upper',
 * 	version: '1',
 * 	input: schema.string(),
 * 	result: schema.string(),
 * 	placement: engine.require(Local),
 * });
 * const UpperLive = activity.implement(Upper, { run: (ctx) => ctx.input.toUpperCase() });
 * await using ctx = context.create({ id: 'uppercase' });
 * await using resources = resource.create(resource.implementations(), { ctx, host: {} });
 * const value = await activity.run({
 * 	ctx,
 * 	engine: Local,
 * 	resources,
 * 	implementation: UpperLive,
 * 	input: 'hello',
 * 	jobId: 'uppercase-1',
 * 	attempt: 1,
 * });
 * console.log(value);
 * ```
 *
 * @module
 */
import * as codec from '@okikio/schema/codec';
import * as catalogCore from '@okikio/collection/catalog';
import type { DefinitionInput as CatalogDefinitionInput } from '@okikio/collection/catalog';
import * as contextCore from '@okikio/context';
import * as capability from '@okikio/capability/execution';
import * as effectCore from '@okikio/capability/effect';
import * as failureCore from '@okikio/result/failure';
import * as permissionCore from '@okikio/authz/permission';
import * as requirementCore from '@okikio/capability/requirement';
import type { RequirementDefinition } from '@okikio/capability/requirement';
import * as resourceCore from '@okikio/capability/resource';
import * as resilienceCore from '@okikio/capability/resilience';
import * as resultCore from '@okikio/result';
import * as schema from '@okikio/schema';
import { HostSelectionError } from './selection.ts';
import * as workflow from '@okikio/workflow';
import * as engineCore from './engine.ts';
import type {
	ActivityCatalog,
	ActivityContext,
	ActivityDefinition,
	ActivityDocument,
	ActivityFailures,
	ActivityImplementation,
	ActivityImplementationOptions,
	ActivityInput,
	ActivityOperation,
	ActivityOptions,
	ActivityRequestOptions,
	ActivityResult,
	ActivityRunOptions,
	ActivitySelection,
	ActivityTryResult,
} from './types.ts';

/** Error raised when a selected engine is not part of an activity placement. */
export class InvalidEngineError extends TypeError {
	/** Stable activity ID whose attempt reached an incompatible engine. */
	readonly activityId: string;
	/** Engine ID carried by the invalid attempt. */
	readonly engineId: string;

	/** Create one placement defect that identifies both activity and incompatible engine. */
	constructor(activityId: string, engineId: string) {
		super(`Activity ${JSON.stringify(activityId)} does not allow engine ${JSON.stringify(engineId)}.`);
		this.name = 'InvalidEngineError';
		this.activityId = activityId;
		this.engineId = engineId;
	}
}

/** Error raised when an activity throws an expected failure it did not declare. */
export class UndeclaredFailureError extends Error {
	/** Activity declaration or reference whose validated attempt is requested. */
	readonly activity: ActivityDefinition;
	/** Expected failure data retained under its declared contract. */
	readonly failure: import('@okikio/result/failure').Occurrence;

	/** Retain the activity and rejected failure occurrence so the declaration defect can be diagnosed. */
	constructor(activity: ActivityDefinition, failure: import('@okikio/result/failure').Occurrence) {
		super(
			`Activity ${JSON.stringify(activity.id)} threw undeclared failure ${JSON.stringify(failure.definition.id)}.`,
			{
				cause: failure,
			},
		);
		this.name = 'UndeclaredFailureError';
		this.activity = activity;
		this.failure = failure;
	}
}

/** Define one immutable external-work contract. */
export function define<const Authoring extends ActivityOptions>(input: Authoring): ActivityDefinition<Authoring> {
	assertId(input.id, 'activity');
	assertId(input.version, 'activity version');
	schema.assert(codec.input(input.input), 'activity input schema');
	schema.assert(codec.input(input.result), 'activity result schema');

	const placement = engineCore.compose(input.placement);
	const failures = input.failures === undefined ? Object.freeze([]) : catalogCore.compose(input.failures);
	const effects = input.effects === undefined ? Object.freeze([]) : effectCore.compose(input.effects);
	const resources = input.resources === undefined ? Object.freeze([]) : catalogCore.compose(input.resources);
	const requirements = input.requirements === undefined
		? Object.freeze([])
		: requirementCore.compose(input.requirements);
	const resilience = input.resilience === undefined ? Object.freeze([]) : resilienceCore.compose(input.resilience);

	return Object.freeze({
		kind: 'activity',
		id: input.id,
		version: input.version,
		...(input.description === undefined ? {} : { description: input.description }),
		input: input.input,
		result: input.result,
		failures,
		effects,
		placement,
		resources,
		requirements,
		resilience,
	}) as ActivityDefinition<Authoring>;
}

/** Bind concrete behavior to one exact activity contract without selecting placement. */
export function implement<Activity extends ActivityDefinition>(
	definition: Activity,
	input: ActivityImplementationOptions<Activity>,
): ActivityImplementation<Activity> {
	if (typeof input.run !== 'function') throw new TypeError('Activity implementation run must be a function.');
	const implementation: ActivityImplementation<Activity> = Object.freeze({
		definition,
		run: input.run,
		invoke: (options: import('@okikio/workflow').InvocationType) => run({ ...options, implementation }),
	});
	return implementation;
}

/** Create a named immutable activity catalog. */
export function catalog<
	const Namespace extends string,
	const Entries extends Readonly<Record<PropertyKey, ActivityDefinition>>,
>(namespace: Namespace, entries: Entries): ActivityCatalog<Entries> {
	return catalogCore.create(namespace, entries);
}

/** Select a key-preserving activity catalog subset. */
export function select<
	const Entries extends Readonly<Record<PropertyKey, ActivityDefinition>>,
	const Keys extends readonly (keyof Entries & string)[],
>(
	source: ActivityCatalog<Entries>,
	keys: Keys,
): ActivitySelection<Entries[Keys[number]], Pick<Entries, Keys[number]>> {
	return catalogCore.select(source, keys);
}

/** Compose activities, catalogs, selections, and nested arrays. */
export function compose<Entry extends ActivityDefinition>(
	...input: readonly CatalogDefinitionInput<Entry>[]
): readonly Entry[] {
	return catalogCore.compose(...input);
}

/** Create one serializable workflow request for an activity. No external work starts. */
export function request<Activity extends ActivityDefinition>(
	definition: Activity,
	input: codec.ContractInput<Activity['input']>,
	options: ActivityRequestOptions = {},
): ActivityOperation<Activity> {
	return workflow.activity<ActivityResult<Activity>, ActivityFailures<Activity>>(definition, input, options);
}

/** Create one workflow request that converts only declared failures into an explicit result. */
function attempt<Activity extends ActivityDefinition>(
	definition: Activity,
	input: codec.ContractInput<Activity['input']>,
	options: ActivityRequestOptions = {},
): workflow.WorkflowOperation<ActivityTryResult<Activity>, never> {
	return Object.freeze({
		*[Symbol.iterator](): Generator<
			workflow.WorkflowInstruction,
			ActivityTryResult<Activity>,
			workflow.WorkflowCompletionAny
		> {
			try {
				return resultCore.ok(yield* request(definition, input, options));
			} catch (reason) {
				if (isFailure(definition, reason)) return resultCore.fail(reason as ActivityFailures<Activity>);
				throw reason;
			}
		},
	});
}

/**
 * Run one concrete activity attempt immediately in the current host.
 *
 * Check the input, prepare the attempt context, and call the implementation once.
 * Apply its direct requirements unless the caller already admitted the attempt.
 * Declared permissions make later explicit checks possible; declaration alone
 * does not approve access to a target.
 *
 * The attempt borrows its resource collection and releases values owned by its
 * child context before returning. Resource declarations guide typed access;
 * they do not isolate untrusted code. Retry settings do not start retries here.
 *
 * Encode and decode the result before returning it, so a local caller receives
 * the same representation as a remote consumer. Cleanup failure can still make
 * the attempt reject after the implementation produced a value.
 */
export async function run<Activity extends ActivityDefinition>(
	options: ActivityRunOptions<Activity>,
): Promise<ActivityResult<Activity>> {
	assertJobId(options.jobId);
	if (!Number.isSafeInteger(options.attempt) || options.attempt < 1) {
		throw new TypeError('Activity attempt must be a positive safe integer.');
	}

	const definition = options.implementation.definition;
	if (options.location?.host && !options.physicalHost) throw new HostSelectionError('lost');
	assertEngine(definition, options.engine);
	// Convert and validate before the application receives input. Local execution
	// follows the same wire/application contract as a remote invocation.
	const input = await codec.read(definition.input, options.input) as ActivityInput<Activity>;
	await using owned = contextCore.child(options.ctx, { id: options.jobId });

	// Attach declarations to this attempt's lifetime before checking admission or running application code.
	const requirementCtx = requirementScope(owned, options);
	const governedCtx = requirementCore.bind(requirementCtx, reachableRequirements(definition));
	const capabilities = capability.scope(governedCtx, {
		resources: { collection: options.resources, allowed: definition.resources },
		effects: {
			effects: definition.effects,
			...(options.effect === undefined ? {} : { emitter: options.effect }),
		},
	});

	const ctx = contextCore.view(capabilities, {
		activity: definition,
		engine: options.engine,
		jobId: options.jobId,
		physicalHost: options.physicalHost,
		attempt: options.attempt,
		input,
		claim: options.claim,
		// Check both sides of an awaited host checkpoint: cancellation can arrive while that hook is suspended.
		checkpoint: async () => {
			contextCore.check(owned);
			await options.checkpoint?.();
			contextCore.check(owned);
		},
		heartbeat: options.heartbeat ?? (() => {}),
	}) as ActivityContext<Activity>;

	if (options.admitted !== true) await requirementCore.apply(ctx, definition.requirements);
	try {
		await ctx.checkpoint();
		const value = await options.implementation.run(ctx);
		// A local attempt must obey the same result conversion as a transported attempt.
		return await codec.read(definition.result, await codec.write(definition.result, value)) as ActivityResult<Activity>;
	} catch (reason) {
		if (isFailureOccurrence(reason) && !isFailure(definition, reason)) {
			throw new UndeclaredFailureError(definition, reason);
		}
		throw reason;
	}
}

/** Return whether a reason is one of an activity's exact declared failures. */
export function isFailure<Activity extends ActivityDefinition>(
	definition: Activity,
	reason: unknown,
): reason is ActivityFailures<Activity> {
	return isFailureOccurrence(reason) && definition.failures.includes(reason.definition);
}

/** Create deterministic JSON-safe activity documentation. */
export function document(input: CatalogDefinitionInput<ActivityDefinition>): readonly ActivityDocument[] {
	return Object.freeze(
		catalogCore.values(input).map((definition) =>
			Object.freeze({
				id: definition.id,
				version: definition.version,
				...(definition.description === undefined ? {} : { description: definition.description }),
				inputVendor: codec.input(definition.input)['~standard'].vendor,
				resultVendor: codec.input(definition.result)['~standard'].vendor,
				failures: Object.freeze(definition.failures.map((entry) => entry.id)),
				effects: Object.freeze(definition.effects.map((entry) => entry.id)),
				placement: engineCore.document(definition.placement),
				resources: Object.freeze(definition.resources.map((entry) => entry.id)),
				requirements: requirementCore.document(definition.requirements),
				resilience: Object.freeze(definition.resilience.map((entry) => entry.type)),
			})
		),
	);
}

/** Build one requirement scope and make the explicit permission checker authoritative for its family. */
function requirementScope<Activity extends ActivityDefinition>(
	ctx: import('@okikio/context').Context,
	options: ActivityRunOptions<Activity>,
): import('@okikio/capability/requirement').RequirementContext {
	const interpreters = { ...(options.requirements?.interpreters ?? {}) };
	if (options.permission !== undefined || interpreters.permission === undefined) {
		interpreters.permission = permissionCore.interpreter(options.permission);
	}
	return requirementCore.scope(ctx, {
		interpreters,
		unknown: options.requirements?.unknown ?? 'reject',
	});
}

/** Collect requirements reachable through this activity without making them active. */
function reachableRequirements(definition: ActivityDefinition): readonly RequirementDefinition[] {
	return requirementCore.compose(definition.requirements, resourceCore.reachable(definition.resources));
}

/** Verify that the Scheduler-selected engine is one of the activity's declared candidates. */
function assertEngine(definition: ActivityDefinition, engine: engineCore.EngineDefinition): void {
	if (!definition.placement.choices.some((choice) => choice.engine === engine)) {
		throw new InvalidEngineError(definition.id, engine.id);
	}
}

/** Return whether a reason is a package-created expected-failure occurrence. */
function isFailureOccurrence(value: unknown): value is import('@okikio/result/failure').Occurrence {
	return failureCore.isOccurrence(value);
}

/** Reject an invalid stable activity or version identifier. */
function assertId(value: string, label: string): void {
	if (!/^[a-z0-9][a-z0-9._:-]*$/i.test(value)) throw new TypeError(`Invalid ${label} id ${JSON.stringify(value)}.`);
}

/** Reject an invalid durable activity-job identity before attempt creation. */
function assertJobId(value: string): void {
	if (value.trim().length === 0) throw new TypeError('Activity jobId must not be empty.');
	if (value.length > 512) throw new TypeError('Activity jobId must not exceed 512 characters.');
}

/** Create one workflow request that converts only declared failures into an explicit result. */
export { attempt as try };
export type {
	ActivityCatalog,
	ActivityContext,
	ActivityDefinition,
	ActivityDocument,
	ActivityFailures,
	ActivityImplementation,
	ActivityImplementationOptions,
	ActivityInput,
	ActivityOperation,
	ActivityOptions,
	ActivityRequestOptions,
	ActivityResources,
	ActivityResult,
	ActivityRunOptions,
	ActivitySchema,
	ActivitySelection,
	ActivityTryResult,
} from './types.ts';

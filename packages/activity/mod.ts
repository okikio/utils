/**
 * External-work definitions, workflow requests, and direct local attempts.
 *
 * Definitions are import-safe. `request()` creates only a serializable workflow
 * instruction. `run()` performs one already-selected implementation in the
 * current host under explicit engine, requirement, resource, and effect state.
 *
 * @module
 */
import * as catalogCore from '@okikio/catalog';
import type { DefinitionInput as CatalogDefinitionInput } from '@okikio/catalog';
import * as contextCore from '@okikio/context';
import * as effectCore from '@okikio/effect';
import * as failureCore from '@okikio/failure';
import * as permissionCore from '@okikio/permission';
import * as requirementCore from '@okikio/requirement';
import type { RequirementDefinition } from '@okikio/requirement';
import * as resourceCore from '@okikio/resource';
import * as resilienceCore from '@okikio/resilience';
import * as resultCore from '@okikio/result';
import * as schema from '@okikio/schema';
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
	ActivityResources,
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
	readonly activity: ActivityDefinition;
	readonly failure: import('@okikio/failure').Occurrence;

	constructor(activity: ActivityDefinition, failure: import('@okikio/failure').Occurrence) {
		super(`Activity ${JSON.stringify(activity.id)} threw undeclared failure ${JSON.stringify(failure.definition.id)}.`, {
			cause: failure,
		});
		this.name = 'UndeclaredFailureError';
		this.activity = activity;
		this.failure = failure;
	}
}

/** Define one immutable external-work contract. */
export function define<const Authoring extends ActivityOptions>(input: Authoring): ActivityDefinition<Authoring> {
	assertId(input.id, 'activity');
	assertId(input.version, 'activity version');
	schema.assert(input.input, 'activity input schema');
	schema.assert(input.result, 'activity result schema');

	const placement = engineCore.compose(input.placement);
	const failures = input.failures === undefined ? Object.freeze([]) : catalogCore.compose(input.failures);
	const effects = input.effects === undefined ? Object.freeze([]) : effectCore.compose(input.effects);
	const resources = input.resources === undefined ? Object.freeze([]) : catalogCore.compose(input.resources);
	const requirements = input.requirements === undefined ? Object.freeze([]) : requirementCore.compose(input.requirements);
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
	return Object.freeze({ definition, run: input.run });
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
): ActivitySelection<Entries[keyof Entries], Pick<Entries, Keys[number]>> {
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
	input: ActivityInput<Activity>,
	options: ActivityRequestOptions = {},
): ActivityOperation<Activity> {
	return workflow.activity<ActivityResult<Activity>, ActivityFailures<Activity>>(definition, input, options);
}

/** Create one workflow request that converts only declared failures into an explicit result. */
function attempt<Activity extends ActivityDefinition>(
	definition: Activity,
	input: ActivityInput<Activity>,
	options: ActivityRequestOptions = {},
): workflow.WorkflowOperation<ActivityTryResult<Activity>, never> {
	return Object.freeze({
		*[Symbol.iterator](): Generator<workflow.WorkflowInstruction, ActivityTryResult<Activity>, workflow.WorkflowCompletionAny> {
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
 * The attempt validates input/result schemas, applies direct active
 * requirements, exposes every statically reachable permission only for later
 * explicit checks, narrows resource access, and disposes attempt-owned values.
 */
export async function run<Activity extends ActivityDefinition>(
	options: ActivityRunOptions<Activity>,
): Promise<ActivityResult<Activity>> {
	assertJobId(options.jobId);
	if (!Number.isSafeInteger(options.attempt) || options.attempt < 1) {
		throw new TypeError('Activity attempt must be a positive safe integer.');
	}

	const definition = options.implementation.definition;
	assertEngine(definition, options.engine);
	const input = await schema.parse(definition.input, options.input) as ActivityInput<Activity>;
	await using owned = contextCore.child(options.ctx, { id: options.jobId });

	const requirementCtx = requirementScope(owned, options);
	const governedCtx = requirementCore.bind(requirementCtx, reachableRequirements(definition));
	const effectCtx = effectCore.scope(governedCtx, {
		effects: definition.effects,
		...(options.effect === undefined ? {} : { emitter: options.effect }),
	});
	const resources = resourceCore.scope(options.resources, effectCtx);

	const ctx = contextCore.view(effectCtx, {
		activity: definition,
		engine: options.engine,
		jobId: options.jobId,
		attempt: options.attempt,
		input,
		get: <Resource extends ActivityResources<Activity>>(resource: Resource) => resources.get(resource),
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
		return await schema.parse(definition.result, value) as ActivityResult<Activity>;
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
	return Object.freeze(catalogCore.values(input).map((definition) => Object.freeze({
		id: definition.id,
		version: definition.version,
		...(definition.description === undefined ? {} : { description: definition.description }),
		inputVendor: definition.input['~standard'].vendor,
		resultVendor: definition.result['~standard'].vendor,
		failures: Object.freeze(definition.failures.map((entry) => entry.id)),
		effects: Object.freeze(definition.effects.map((entry) => entry.id)),
		placement: engineCore.document(definition.placement),
		resources: Object.freeze(definition.resources.map((entry) => entry.id)),
		requirements: requirementCore.document(definition.requirements),
		resilience: Object.freeze(definition.resilience.map((entry) => entry.type)),
	})));
}

/** Build one requirement scope and make the explicit permission checker authoritative for its family. */
function requirementScope<Activity extends ActivityDefinition>(
	ctx: import('@okikio/context').Context,
	options: ActivityRunOptions<Activity>,
): import('@okikio/requirement').RequirementContext {
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
function isFailureOccurrence(value: unknown): value is import('@okikio/failure').Occurrence {
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
	ActivitySchema,
	ActivityOptions,
	ActivityDefinition,
	ActivityInput,
	ActivityResult,
	ActivityResources,
	ActivityFailures,
	ActivityContext,
	ActivityImplementation,
	ActivityImplementationOptions,
	ActivityRequestOptions,
	ActivityRunOptions,
	ActivityCatalog,
	ActivitySelection,
	ActivityDocument,
	ActivityTryResult,
	ActivityOperation,
} from './types.ts';

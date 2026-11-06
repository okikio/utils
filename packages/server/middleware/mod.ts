/**
 * Declare middleware ordering and context needs so startup can reject a missing producer.
 *
 * Bind the checking code with handler(). Choose a request lane to place it
 * before validation, after validation, or around the endpoint operation. Use
 * once() when contributions from several layers must share one execution.
 * These declarations check ordering; the callback still has to verify credentials.
 *
 * @example
 * ```ts
 * import * as middleware from '@okikio/server/middleware';
 * const Actor = middleware.context<{ id: string }>()({ id: 'actor', description: 'Authenticated actor.' });
 * const Read = middleware.define({
 * 	id: 'actor.read',
 * 	description: 'Read actor after authentication.',
 * 	requires: [Actor],
 * });
 * console.log(middleware.validate([Read]).valid);
 * console.log(middleware.validate([Read], [Actor]).valid);
 * ```
 *
 * @module
 */
import * as catalogProtocol from '@okikio/collection/catalog';
import * as effect from '@okikio/capability/effect';
import * as recordCore from '@okikio/collection/record';
import * as resilience from '@okikio/capability/resilience';
import * as requirement from '@okikio/capability/requirement';
import type { Catalog, CatalogEntryIdentity, CatalogSelection, DefinitionInput } from '@okikio/collection/catalog';

import type {
	MiddlewareContextDefinition,
	MiddlewareContextDefinitionInput,
	MiddlewareDefinition,
	MiddlewareDefinitionInput,
	MiddlewareDocument,
	MiddlewareHandler,
	MiddlewareInput,
	MiddlewareLane,
	MiddlewareOnceKey,
	MiddlewarePlan,
	MiddlewareProblems,
	MiddlewareProvides,
	MiddlewareRequires,
	MiddlewareResources,
	MiddlewareUse,
	MiddlewareValidationIssue,
	MiddlewareValidationResult,
} from './types.ts';

const lanes = Object.freeze(
	[
		'wholeRequest',
		'beforeValidation',
		'afterValidation',
		'aroundOperation',
	] as const satisfies readonly MiddlewareLane[],
);

/**
 * Create a key for a value that one middleware step supplies to later steps.
 * Use the same key object in provides, requires, set and get; matching text IDs
 * do not make separately created keys interchangeable. The type parameter
 * describes the value to TypeScript and does not validate a credential.
 */
export function context<Value>(): (
	input: MiddlewareContextDefinitionInput,
) => MiddlewareContextDefinition<Value>;
/** Define an untyped request-context value used only for static composition. */
export function context(input: MiddlewareContextDefinitionInput): MiddlewareContextDefinition<unknown>;
/** Create the direct or curried middleware-context authoring function. */
export function context(
	input?: MiddlewareContextDefinitionInput,
): MiddlewareContextDefinition | ((input: MiddlewareContextDefinitionInput) => MiddlewareContextDefinition) {
	if (input === undefined) return createContext;
	return createContext(input);
}

/**
 * Create one immutable key for a request-local value and reject missing descriptions.
 *
 * @internal
 */
function createContext(input: MiddlewareContextDefinitionInput): MiddlewareContextDefinition {
	recordCore.assert(input, 'Middleware context definition');
	assertId(input.id, 'middleware context');
	if (input.description.trim().length === 0) throw new TypeError('Middleware context description cannot be empty.');
	return Object.freeze({ kind: 'middleware-context', ...input }) as MiddlewareContextDefinition;
}

/**
 * Describe a middleware step without running its callback or opening resources.
 * requires names values that earlier steps must supply; provides names values
 * this step promises to set. Bind the checking code separately with handler().
 */
export function define<
	const Input extends MiddlewareDefinitionInput,
>(input: Input): MiddlewareDefinition<
	MiddlewareRequires<Input>,
	MiddlewareProvides<Input>,
	MiddlewareResources<Input>,
	MiddlewareProblems<Input>
> {
	recordCore.assert(input, 'Middleware definition');
	assertId(input.id, 'middleware');
	if (input.description.trim().length === 0) throw new TypeError('Middleware description cannot be empty.');
	const requires = Object.freeze([...(input.requires ?? [])]) as unknown as MiddlewareRequires<Input>;
	const provides = Object.freeze([...(input.provides ?? [])]) as unknown as MiddlewareProvides<Input>;
	assertContextList(requires, 'requires');
	assertContextList(provides, 'provides');
	return Object.freeze({
		kind: 'middleware',
		id: input.id,
		description: input.description,
		requires,
		provides,
		...(input.resources !== undefined ? { resources: snapshotInput(input.resources) } : {}),
		...(input.problems !== undefined ? { problems: snapshotInput(input.problems) } : {}),
		...(input.requirements !== undefined ? { requirements: requirement.compose(input.requirements) } : {}),
		...(input.effects !== undefined ? { effects: effect.compose(input.effects) } : {}),
		...(input.authentication !== undefined ? { authentication: snapshotInput(input.authentication) } : {}),
		...(input.resiliency !== undefined ? { resiliency: resilience.compose(input.resiliency) } : {}),
		...(input.documentation ? { documentation: snapshotDocumentation(input.documentation) } : {}),
	}) as MiddlewareDefinition<
		MiddlewareRequires<Input>,
		MiddlewareProvides<Input>,
		MiddlewareResources<Input>,
		MiddlewareProblems<Input>
	>;
}

/**
 * Copy nested composition arrays without invoking accessor elements.
 * Definition objects remain borrowed so exact identity survives composition.
 *
 * @internal
 */
function snapshotInput<Value>(value: Value): Value {
	if (!Array.isArray(value)) return value;
	const descriptors = Object.getOwnPropertyDescriptors(value);
	const result: unknown[] = [];
	for (let index = 0; index < value.length; index += 1) {
		const descriptor = descriptors[String(index)];
		if (descriptor === undefined || !('value' in descriptor)) {
			throw new TypeError('Middleware definition arrays must be dense data arrays without accessors.');
		}
		result.push(snapshotInput(descriptor.value));
	}
	// Array validation above proves the snapshot preserves the caller's nested array shape.
	return Object.freeze(result) as Value;
}

/** Snapshot optional documentation metadata without invoking accessors. */
function snapshotDocumentation(
	value: NonNullable<MiddlewareDefinitionInput['documentation']>,
): Readonly<{ readonly url?: string; readonly notes?: string }> {
	recordCore.assert(value, 'Middleware documentation');
	const unknown = recordCore.keys(value).filter((key) => key !== 'url' && key !== 'notes');
	if (unknown.length > 0) {
		throw new TypeError(`Middleware documentation contains unknown field ${JSON.stringify(unknown[0])}.`);
	}
	if (value.url !== undefined && typeof value.url !== 'string') {
		throw new TypeError('Middleware documentation url must be a string.');
	}
	if (value.notes !== undefined && typeof value.notes !== 'string') {
		throw new TypeError('Middleware documentation notes must be a string.');
	}
	return Object.freeze({
		...(value.url === undefined ? {} : { url: value.url }),
		...(value.notes === undefined ? {} : { notes: value.notes }),
	});
}

/** Bind runtime behavior to one exact middleware definition. */
export function handler<
	Definition extends MiddlewareDefinition,
	Host = unknown,
	Result = unknown,
>(
	definition: Definition,
	handle: MiddlewareHandler<Definition, Host, Result>['handle'],
): MiddlewareHandler<Definition, Host, Result> {
	if (typeof handle !== 'function') throw new TypeError('Middleware handler must be a function.');
	return Object.freeze({ kind: 'middleware-handler', definition, handle });
}

/**
 * Remember which steps have started for this exact Request object. Weak keys let
 * completed requests be collected without a separate global cleanup operation.
 */
const onceByRequest = new WeakMap<Request, Set<MiddlewareOnceKey>>();

/**
 * Wrap an exact middleware handler so its inner work executes at most once for
 * one Request, even when the same definition is contributed by several layers.
 *
 * Duplicate occurrences still call next(), so later handlers continue to run.
 * The mark is set before the inner callback starts: even if it fails, another
 * occurrence on this Request does not repeat its side effects. Another Request
 * object has its own marks.
 */
export function once<
	Definition extends MiddlewareDefinition,
	Host = unknown,
	Result = unknown,
>(
	binding: MiddlewareHandler<Definition, Host, Result>,
	key: MiddlewareOnceKey = binding.definition,
): MiddlewareHandler<Definition, Host, Result> {
	return handler(binding.definition, async (context, next) => {
		let executed = onceByRequest.get(context.request);
		if (executed === undefined) {
			executed = new Set();
			onceByRequest.set(context.request, executed);
		}
		if (executed.has(key)) return await next();
		// Mark before awaiting user code so re-entry cannot run this step twice.
		executed.add(key);
		return await binding.handle(context, next);
	});
}

/** Create a named middleware catalog. */
export function middlewareCatalog<
	const Namespace extends string,
	const Entries extends Readonly<Record<PropertyKey, MiddlewareDefinition>>,
>(namespace: Namespace, entries: Entries): Catalog<Entries[keyof Entries], Entries> {
	return catalogProtocol.create(namespace, entries);
}

/** Select an immutable key-preserving middleware subset. */
export function select<
	const Entries extends Readonly<Record<PropertyKey, MiddlewareDefinition>>,
	const Keys extends readonly (keyof Entries & string)[],
>(
	source: Catalog<Entries[keyof Entries], Entries>,
	keys: Keys,
): CatalogSelection<Entries[keyof Entries], Pick<Entries, Keys[number]>> {
	return catalogProtocol.select(source, keys);
}

/** Compose middleware definitions, catalogs, selections, and nested arrays. */
export function compose<Entry extends MiddlewareDefinition>(
	...input: readonly DefinitionInput<Entry>[]
): readonly Entry[] {
	return catalogProtocol.compose(...input);
}

/** Surround the complete application request pipeline before transport materialization. */
export const wholeRequest = <Definition extends MiddlewareDefinition>(
	definition: Definition,
): MiddlewareUse<Definition, 'wholeRequest'> => use(definition, 'wholeRequest');
/** Place middleware immediately before request validation. */
export const beforeValidation = <Definition extends MiddlewareDefinition>(
	definition: Definition,
): MiddlewareUse<Definition, 'beforeValidation'> => use(definition, 'beforeValidation');
/** Place middleware in the normal post-validation lane. */
export const afterValidation = <Definition extends MiddlewareDefinition>(
	definition: Definition,
): MiddlewareUse<Definition, 'afterValidation'> => use(definition, 'afterValidation');
/** Place middleware immediately around endpoint handler invocation. */
export const aroundOperation = <Definition extends MiddlewareDefinition>(
	definition: Definition,
): MiddlewareUse<Definition, 'aroundOperation'> => use(definition, 'aroundOperation');

/** Normalize middleware input while preserving authored order within each lane. */
export function plan(input: MiddlewareInput | undefined): MiddlewarePlan {
	const result: Record<MiddlewareLane, MiddlewareDefinition[]> = {
		wholeRequest: [],
		beforeValidation: [],
		afterValidation: [],
		aroundOperation: [],
	};
	if (input !== undefined) visit(input, (definition, lane) => result[lane].push(definition));
	return freezePlan(result);
}

/**
 * Check whether request steps can obtain their required values in execution order.
 * initialContexts lists keys the host promises to supply before those steps.
 * Report missing producers, conflicting producers and reused text IDs without
 * calling any handler. A valid plan does not prove that a credential was checked
 * or that a callback will actually set its promised value.
 */
export function validate(
	input: MiddlewareInput | undefined,
	initialContexts: readonly MiddlewareContextDefinition[] = [],
): MiddlewareValidationResult {
	const normalized = plan(input);
	const issues: MiddlewareValidationIssue[] = [];
	const idOwners = new Map<string, MiddlewareDefinition>();
	const available = new Set(initialContexts);
	const providers = new Map<MiddlewareContextDefinition, MiddlewareDefinition>();

	// Walk in request execution order. A later producer cannot satisfy a value
	// that an earlier consumer needs, even if both appear somewhere in the plan.
	for (const lane of lanes) {
		for (const definition of normalized[lane]) {
			const owner = idOwners.get(definition.id);
			if (owner && owner !== definition) {
				issues.push(issue('duplicate-id', `Middleware ID ${JSON.stringify(definition.id)} is duplicated.`, definition));
			}
			idOwners.set(definition.id, definition);
			for (const required of definition.requires) {
				if (!available.has(required)) {
					issues.push(
						issue(
							'missing-required-context',
							`${definition.id} requires unavailable context ${required.id}.`,
							definition,
							required,
						),
					);
				}
			}
			for (const provided of definition.provides) {
				const existing = providers.get(provided);
				if (existing && existing !== definition) {
					issues.push(
						issue(
							'duplicate-context-provider',
							`${provided.id} is provided by both ${existing.id} and ${definition.id}.`,
							definition,
							provided,
						),
					);
				}
				providers.set(provided, definition);
				available.add(provided);
			}
		}
	}

	return issues.length === 0
		? Object.freeze({ valid: true, plan: normalized })
		: Object.freeze({ valid: false, issues: Object.freeze(issues) });
}

/** Create deterministic JSON-safe middleware documentation. */
export function document(input: DefinitionInput<MiddlewareDefinition>): readonly MiddlewareDocument[] {
	return Object.freeze(
		catalogProtocol.values(input).map((definition): MiddlewareDocument =>
			Object.freeze({
				id: definition.id,
				description: definition.description,
				requires: Object.freeze(definition.requires.map((item) => item.id)),
				provides: Object.freeze(definition.provides.map((item) => item.id)),
				resources: ids(definition.resources),
				problems: ids(definition.problems),
				requirements: requirement.document(definition.requirements ?? []),
				effects: definition.effects === undefined
					? Object.freeze([])
					: Object.freeze(effect.compose(definition.effects).map((entry) => entry.id)),
				resiliency: definition.resiliency === undefined
					? Object.freeze([])
					: Object.freeze(resilience.compose(definition.resiliency).map((policy) => policy.type)),
				...(definition.documentation !== undefined ? { documentation: definition.documentation } : {}),
			})
		),
	);
}

/**
 * Creates one middleware selection entry that retains exact definition identity and caller-supplied configuration.
 *
 * @internal
 */
function use<Definition extends MiddlewareDefinition, Lane extends MiddlewareLane>(
	definition: Definition,
	lane: Lane,
): MiddlewareUse<Definition, Lane> {
	return Object.freeze({ kind: 'middleware-use', definition, lane });
}

/**
 * Visit nested middleware contributions in authored order.
 * Explicit lane wrappers retain their lane; plain definitions default to
 * afterValidation. This arranges declarations without executing their handlers.
 *
 * @internal
 */
function visit(
	input: MiddlewareInput,
	accept: (definition: MiddlewareDefinition, lane: MiddlewareLane) => void,
): void {
	if (isMiddlewareArray(input)) {
		for (const item of input) visit(item, accept);
		return;
	}
	if (input.kind === 'middleware-use') {
		accept(input.definition, input.lane);
		return;
	}
	// Plain middleware defaults to the normal post-validation operation lane.
	accept(input, 'afterValidation');
}

/**
 * Recognize nested middleware composition arrays.
 *
 * @internal
 */
function isMiddlewareArray(input: MiddlewareInput): input is readonly MiddlewareInput[] {
	return Array.isArray(input);
}

/**
 * Freeze each prepared lane and the plan that contains them.
 *
 * @internal
 */
function freezePlan(input: Record<MiddlewareLane, MiddlewareDefinition[]>): MiddlewarePlan {
	return Object.freeze({
		wholeRequest: Object.freeze(input.wholeRequest),
		beforeValidation: Object.freeze(input.beforeValidation),
		afterValidation: Object.freeze(input.afterValidation),
		aroundOperation: Object.freeze(input.aroundOperation),
	});
}

/**
 * Expand a capability composition into descriptive IDs without acquiring values.
 *
 * @internal
 */
function ids(input: DefinitionInput<CatalogEntryIdentity> | undefined): readonly string[] {
	return input === undefined
		? Object.freeze([])
		: Object.freeze(catalogProtocol.values(input).map((entry) => entry.id));
}

/**
 * Require context-definition entries and reject repeated exact identities.
 *
 * @internal
 */
function assertContextList(values: readonly MiddlewareContextDefinition[], field: string): void {
	const seen = new Set<MiddlewareContextDefinition>();
	for (const value of values) {
		if (value.kind !== 'middleware-context') {
			throw new TypeError(`Middleware ${field} entries must be context definitions.`);
		}
		if (seen.has(value)) throw new TypeError(`Middleware ${field} repeats context ${JSON.stringify(value.id)}.`);
		seen.add(value);
	}
}

/**
 * Require the stable identifier grammar used by middleware metadata.
 *
 * @internal
 */
function assertId(id: string, label: string): void {
	if (!/^[a-z0-9][a-z0-9._:-]*$/i.test(id)) throw new TypeError(`Invalid ${label} id ${JSON.stringify(id)}.`);
}

/**
 * Retain the failing declaration and optional context beside a stable issue code.
 *
 * @internal
 */
function issue(
	code: MiddlewareValidationIssue['code'],
	message: string,
	definition?: MiddlewareDefinition,
	context?: MiddlewareContextDefinition,
): MiddlewareValidationIssue {
	return Object.freeze({
		code,
		message,
		...(definition !== undefined ? { definition } : {}),
		...(context !== undefined ? { context } : {}),
	});
}

export { middlewareCatalog as catalog };
export type {
	MiddlewareContextDefinition,
	MiddlewareContextDefinitionInput,
	MiddlewareContextStore,
	MiddlewareContextValue,
	MiddlewareDefinition,
	MiddlewareDefinitionInput,
	MiddlewareDocument,
	MiddlewareHandler,
	MiddlewareHandlerContext,
	MiddlewareInput,
	MiddlewareLane,
	MiddlewareNext,
	MiddlewareOnceKey,
	MiddlewarePlan,
	MiddlewareProblems,
	MiddlewareProvides,
	MiddlewareRequires,
	MiddlewareResourceDefinition,
	MiddlewareResourceResolver,
	MiddlewareResources,
	MiddlewareResourceValue,
	MiddlewareUse,
	MiddlewareValidationIssue,
	MiddlewareValidationResult,
} from './types.ts';

/**
 * Create expensive dependencies once, borrow them through declared access and close them at their owner lifetime. Hand-built dependency bags make missing implementations, cycles and cleanup ordering hard to detect.
 *
 * Add dependency declarations when one resource needs another, validate implementation coverage before startup, and scope access to the exact resources an activity may use. Collections own created values; callers borrow them and must not close them individually. Acquisition requirements apply at creation, while actor-specific use requirements are checked on public borrowing. Remote work must reconstruct its local resources rather than serialize live clients.
 *
 * @example
 * ```ts
 * import '@okikio/duration/polyfill';
 * import '@okikio/dispose/polyfill';
 * import * as context from '@okikio/context';
 * import * as resource from '@okikio/capability/resource';
 * const Store = resource.define<{ read(id: string): string }>()({ id: 'store', description: 'Read one stored value.' });
 * const StoreLive = resource.implement(Store, { create: () => ({ read: (id) => `value:${id}` }) });
 * await using ctx = context.create({ id: 'store-owner' });
 * await using stores = resource.create(resource.implementations(StoreLive), { ctx, host: {} });
 * const store = await stores.get(ctx, Store);
 * console.log(store.read('asset-1'));
 * ```
 *
 * @module
 */
import { AsyncDisposableStack, asyncDispose, dispose, SuppressedError } from '@okikio/dispose';
import * as telemetry from '@okikio/telemetry/instrument';
import * as recordCore from '@okikio/collection/record';
import * as catalogCore from '@okikio/collection/catalog';
import type {
	Catalog,
	CatalogEntryIdentity,
	CatalogSelection,
	DefinitionInput as CatalogDefinitionInput,
} from '@okikio/collection/catalog';
import * as context from '@okikio/context';
import * as requirement from '@okikio/capability/requirement';
import type { EnvironmentRequirement } from '@okikio/env';
import * as env from '@okikio/env';

import type {
	ResourceCollection,
	ResourceCollectionOptions,
	ResourceCreateArgumentsAny,
	ResourceDefinition,
	ResourceDependencies,
	ResourceDocument,
	ResourceImplementation,
	ResourceImplementationAny,
	ResourceImplementationOptions,
	ResourceImplementationSet,
	ResourceOptions,
	ResourceValidationIssue,
	ResourceValidationResult,
	ResourceValue,
} from './types.ts';

/** Shared immutable empty dependency map used by definitions that declare no dependencies. */
const emptyDependencies = Object.freeze(Object.create(null)) as Readonly<Record<string, never>>;
/** Shared immutable empty environment map used by definitions that declare no environment fields. */
const emptyEnvironment = Object.freeze(Object.create(null)) as Readonly<Record<string, never>>;

/**
 * An adapter could not acquire a declared runtime capability.
 *
 * Adapters use this for expected dependency outages. Configuration mistakes in
 * the static graph keep their separate error types; arbitrary programming errors
 * are not automatically relabelled as availability failures. The original cause
 * stays private so an HTTP host can return a safe retryable problem.
 */
export class UnavailableError extends Error {
	/** Exact capability whose adapter reported an availability failure. */
	readonly definition: ResourceDefinition;

	/** Retain the exact resource and private outage cause for host diagnostics. */
	constructor(definition: ResourceDefinition, options?: ErrorOptions) {
		super(`Resource ${JSON.stringify(definition.id)} is unavailable.`, options);
		this.name = 'UnavailableError';
		this.definition = definition;
	}
}

/** Error raised when two distinct definitions reuse one stable resource ID. */
export class DefinitionConflictError extends Error {
	/** Stable identity used to correlate this contract or occurrence. */
	readonly id: string;
	/** First operand or observation retained in this ordered pair. */
	readonly first: ResourceDefinition;
	/** Second operand or observation retained in this ordered pair. */
	readonly second: ResourceDefinition;

	/** Identify an ID assigned to different resource definition objects. */
	constructor(id: string, first: ResourceDefinition, second: ResourceDefinition) {
		super(`Resource identifier ${JSON.stringify(id)} is owned by different definition objects.`);
		this.name = 'DefinitionConflictError';
		this.id = id;
		this.first = first;
		this.second = second;
	}
}

/** Error raised when a collection receives two implementations for one definition. */
export class ImplementationConflictError extends Error {
	/** Exact declared contract object; an independently authored same-name object is not the same declaration. */
	readonly definition: ResourceDefinition;

	/** Identify the resource whose acquisition factory was configured more than once. */
	constructor(definition: ResourceDefinition) {
		super(`Resource ${JSON.stringify(definition.id)} has more than one implementation.`);
		this.name = 'ImplementationConflictError';
		this.definition = definition;
	}
}

/** Error raised when a reachable resource definition has no implementation. */
export class MissingImplementationError extends Error {
	/** Exact declared contract object; an independently authored same-name object is not the same declaration. */
	readonly definition: ResourceDefinition;
	/** Definitions that require the missing resource, used to explain the dependency path. */
	readonly requiredBy: readonly ResourceDefinition[];

	/** Retain the requested definition when a collection or allowlist cannot supply it. */
	constructor(definition: ResourceDefinition, requiredBy: readonly ResourceDefinition[] = []) {
		const suffix = requiredBy.length === 0
			? ''
			: `\nRequired by:\n${requiredBy.map((item) => `  ${item.id}`).join('\n')}`;
		super(`Missing resource implementation.\n\nResource:\n  ${definition.id}${suffix}`);
		this.name = 'MissingImplementationError';
		this.definition = definition;
		this.requiredBy = Object.freeze([...requiredBy]);
	}
}

/** Error raised for a cycle in the static resource dependency graph. */
export class DependencyCycleError extends Error {
	/** Source, route or expression path used to locate this value. */
	readonly path: readonly ResourceDefinition[];

	/** Retain the ordered dependency path that prevents lazy acquisition from completing. */
	constructor(path: readonly ResourceDefinition[]) {
		super(`Resource dependency cycle detected:\n${path.map((item) => item.id).join(' -> ')}`);
		this.name = 'DependencyCycleError';
		this.path = Object.freeze([...path]);
	}
}

/** Error raised when a disposing or disposed collection is used. */
export class CollectionDisposedError extends Error {
	constructor() {
		super('The resource collection is disposing or has already been disposed.');
		this.name = 'CollectionDisposedError';
	}
}

/**
 * Define a provider-neutral resource when only static metadata is needed.
 *
 * Use the curried overload, `resource.define<ResourceValue>()({...})`, when dependent
 * implementations need the concrete resource value type.
 */
export function define<
	const Dependencies extends ResourceDependencies = Readonly<Record<string, never>>,
	const ResourceEnvironment extends EnvironmentRequirement | undefined = undefined,
	const Id extends string = string,
>(
	input: ResourceOptions<Dependencies, ResourceEnvironment, Id>,
): ResourceDefinition<unknown, Dependencies, ResourceEnvironment, Id>;
/** Define a typed resource directly. Use the curried form to infer typed dependencies. */
export function define<Value>(input: ResourceOptions): ResourceDefinition<Value>;
/** Define a resource with an explicit concrete value contract. */
export function define<ResourceValue>(): <
	const Dependencies extends ResourceDependencies = Readonly<Record<string, never>>,
	const ResourceEnvironment extends EnvironmentRequirement | undefined = undefined,
	const Id extends string = string,
>(
	input: ResourceOptions<Dependencies, ResourceEnvironment, Id>,
) => ResourceDefinition<ResourceValue, Dependencies, ResourceEnvironment, Id>;
/** Create the direct or curried resource-definition authoring function. */
export function define(
	input?: ResourceOptions<ResourceDependencies, EnvironmentRequirement | undefined>,
): ResourceDefinition | ((input: ResourceOptions) => ResourceDefinition) {
	if (input === undefined) return (next: ResourceOptions) => defineResource(next);
	return defineResource(input);
}

/**
 * Creates one normalized resource definition after validating static author input.
 *
 * The normalized value freezes direct dependencies and direct use requirements.
 * Reachable dependency requirements are derived separately for inspection; they
 * are never copied into this definition as eager admission requirements.
 *
 * @internal
 */
function defineResource<
	Dependencies extends ResourceDependencies,
	ResourceEnvironment extends EnvironmentRequirement | undefined,
>(
	input: ResourceOptions<Dependencies, ResourceEnvironment>,
): ResourceDefinition<unknown, Dependencies, ResourceEnvironment> {
	assertDefinitionInput(input);
	const dependencies = input.dependencies === undefined ? emptyDependencies : freezeRecord(input.dependencies);
	const requirements = input.requirements === undefined ? Object.freeze([]) : requirement.compose(input.requirements);
	return Object.freeze({
		kind: 'resource',
		id: input.id,
		description: input.description,
		dependencies,
		...(input.environment === undefined ? {} : { environment: input.environment }),
		requirements,
		...(input.failures === undefined ? {} : { failures: input.failures }),
		...(input.health === undefined ? {} : { health: Object.freeze({ ...input.health }) }),
		...(input.documentation === undefined ? {} : { documentation: Object.freeze({ ...input.documentation }) }),
	}) as ResourceDefinition<unknown, Dependencies, ResourceEnvironment>;
}

/** Create a named immutable resource catalog. */
export function catalog<
	const Namespace extends string,
	const Entries extends Readonly<Record<PropertyKey, ResourceDefinition>>,
>(namespace: Namespace, entries: Entries): Catalog<Entries[keyof Entries], Entries> {
	return catalogCore.create(namespace, entries);
}

/** Select an immutable key-preserving resource subset. */
export function select<
	const Entries extends Readonly<Record<PropertyKey, ResourceDefinition>>,
	const Keys extends readonly (keyof Entries & string)[],
>(
	source: Catalog<Entries[keyof Entries], Entries>,
	keys: Keys,
): CatalogSelection<Entries[Keys[number]], Pick<Entries, Keys[number]>> {
	return catalogCore.select(source, keys);
}

/** Compose resource definitions, catalogs, selections, and nested arrays. */
export function compose<Entry extends ResourceDefinition>(
	...inputs: readonly CatalogDefinitionInput<Entry>[]
): readonly Entry[] {
	return catalogCore.compose(...inputs);
}

/** Bind one host-specific constructor to one exact resource definition. */
export function implement<
	Resource extends ResourceDefinition,
	Value extends ResourceValue<Resource>,
	Host = unknown,
>(
	definition: Resource,
	input: ResourceImplementationOptions<Resource, Value, Host>,
): ResourceImplementation<Resource, Value, Host> {
	if (typeof input.create !== 'function') throw new TypeError('Resource implementation create must be a function.');
	const requirements = input.requirements === undefined ? Object.freeze([]) : requirement.compose(input.requirements);
	if (input.ownership !== undefined && input.ownership !== 'owned' && input.ownership !== 'borrowed') {
		throw new TypeError('Resource ownership must be owned or borrowed.');
	}
	return Object.freeze({ definition, requirements, ownership: input.ownership ?? 'owned', create: input.create });
}

/**
 * Assemble an explicit, import-safe universe of resource implementations.
 *
 * Repeating the same implementation object is harmless. A different
 * implementation for the same exact definition is rejected.
 */
export function implementations<const Implementations extends readonly ResourceImplementationAny[]>(
	...input: Implementations
): ResourceImplementationSet<Implementations> {
	const accepted: Implementations[number][] = [];
	const seenObjects = new Set<ResourceImplementationAny>();
	const byDefinition = new Map<ResourceDefinition, ResourceImplementationAny>();
	const byId = new Map<string, ResourceDefinition>();

	for (const implementation of input) {
		if (seenObjects.has(implementation)) continue;
		seenObjects.add(implementation);
		assertImplementation(implementation);

		const idOwner = byId.get(implementation.definition.id);
		if (idOwner !== undefined && idOwner !== implementation.definition) {
			throw new DefinitionConflictError(implementation.definition.id, idOwner, implementation.definition);
		}
		byId.set(implementation.definition.id, implementation.definition);

		const existing = byDefinition.get(implementation.definition);
		if (existing !== undefined && existing !== implementation) {
			throw new ImplementationConflictError(implementation.definition);
		}
		byDefinition.set(implementation.definition, implementation);
		accepted.push(implementation);
	}

	return Object.freeze({ implementations: Object.freeze(accepted) });
}

/** Validate a definition graph and, when supplied, implementation coverage. */
export function validate(
	input: CatalogDefinitionInput<ResourceDefinition> | ResourceImplementationSet,
): ResourceValidationResult {
	const issues: ResourceValidationIssue[] = [];
	const roots = isImplementationSet(input)
		? input.implementations.map((implementation) => implementation.definition)
		: catalogCore.values(input);
	const definitions = collectDefinitions(roots, issues);

	if (isImplementationSet(input)) {
		const seen = new Map<ResourceDefinition, ResourceImplementationAny>();
		for (const implementation of input.implementations) {
			const previous = seen.get(implementation.definition);
			if (previous !== undefined && previous !== implementation) {
				issues.push(Object.freeze({
					code: 'duplicate-implementation',
					message: `Resource ${JSON.stringify(implementation.definition.id)} has multiple implementations.`,
					definition: implementation.definition,
				}));
			}
			seen.set(implementation.definition, implementation);
		}
		for (const definition of definitions) {
			if (seen.has(definition)) continue;
			issues.push(Object.freeze({
				code: 'missing-implementation',
				message: `Resource ${JSON.stringify(definition.id)} has no implementation.`,
				definition,
				requiredBy: Object.freeze(findDependents(definition, definitions)),
			}));
		}
	}

	return issues.length === 0
		? Object.freeze({ valid: true, definitions: Object.freeze(definitions) })
		: Object.freeze({ valid: false, issues: Object.freeze(issues) });
}

/** Create deterministic, JSON-safe documentation for a resource graph. */
export function document(
	input: CatalogDefinitionInput<ResourceDefinition>,
	implementationSet?: ResourceImplementationSet,
): readonly ResourceDocument[] {
	const definitions = collectDefinitions(catalogCore.values(input), []);
	const available = implementationSet === undefined
		? undefined
		: new Set(implementationSet.implementations.map((implementation) => implementation.definition));

	return Object.freeze(definitions.map((definition): ResourceDocument => {
		const direct = Object.values(definition.dependencies);
		const transitive = collectTransitiveDependencies(definition);
		const environment = definition.environment?.fields.map((field) =>
			Object.freeze({
				key: field.key,
				reason: field.reason,
				requirementId: definition.environment!.id,
			})
		) ?? Object.freeze([]);
		return Object.freeze({
			id: definition.id,
			description: definition.description,
			dependencies: Object.freeze(direct.map((dependency) => dependency.id)),
			transitiveDependencies: Object.freeze(transitive.map((dependency) => dependency.id)),
			environment: Object.freeze([...environment]),
			requirements: requirement.document(definition.requirements),
			reachableRequirements: requirement.document(collectTransitiveRequirements(definition)),
			failures: ids(definition.failures),
			...(available === undefined ? {} : { implementationAvailable: available.has(definition) }),
			...(definition.health === undefined ? {} : { health: definition.health }),
			...(definition.documentation === undefined ? {} : { documentation: definition.documentation }),
		});
	}));
}

/** Collect every statically reachable requirement from a resource graph. */
export function reachable(
	input: CatalogDefinitionInput<ResourceDefinition>,
): readonly import('@okikio/capability/requirement').RequirementDefinition[] {
	const definitions = collectDefinitions(catalogCore.values(input), []);
	const inputs = definitions.map((definition) => definition.requirements);
	return inputs.length === 0 ? Object.freeze([]) : requirement.compose(inputs);
}

/**
 * Bind one resource collection to the current execution context.
 *
 * Every `get()` applies the exact resource definition's direct requirements
 * before borrowing the collection-owned value. This keeps actor authority at
 * use time even when the underlying value is cached and shared. Omitting allowed
 * permits every configured definition through this resolver. Capability.scope
 * instead requires an explicit allowlist whenever it lends a collection.
 */
export function scope<Allowed extends ResourceDefinition>(
	collection: ResourceCollection,
	ctx: import('@okikio/context').Context,
	allowed?: CatalogDefinitionInput<Allowed>,
): import('./types.ts').ResourceResolver<Allowed> {
	const definitions = allowed === undefined ? undefined : new Set(catalogCore.compose(allowed));
	return Object.freeze({
		has<ResourceDefinition extends Allowed>(definition: ResourceDefinition): boolean {
			return (definitions === undefined || definitions.has(definition)) && collection.has(definition);
		},
		async get<ResourceDefinition extends Allowed>(
			definition: ResourceDefinition,
		): Promise<ResourceValue<ResourceDefinition>> {
			if (definitions !== undefined && !definitions.has(definition)) {
				throw new MissingImplementationError(definition);
			}
			return await collection.get(ctx, definition);
		},
	});
}

/** Create one independently owned, lazy resource collection. */
export function create<Host>(
	implementationSet: ResourceImplementationSet,
	options: ResourceCollectionOptions<Host>,
): ResourceCollection {
	if (options.source !== undefined && options.environment !== undefined) {
		throw new TypeError('Resource source and parsed environment are mutually exclusive.');
	}
	const validation = validate(implementationSet);
	if (!validation.valid) throwValidationIssue(validation.issues[0]!);
	const collection = new LiveCollection(implementationSet, options);
	inspectors.set(collection, (maximum) => collection.inspect(maximum));
	return collection;
}

/** Bounded lifetime report; IDs describe declarations and never include resource values or environment data. */
export interface ResourceInspectionType {
	/** Disposed means all collection cleanup attempts settled, even if disposal rejected. */
	readonly state: 'active' | 'disposing' | 'disposed';
	/** Number of configured definitions, independent of the returned page. */
	readonly configured: number;
	/** True when maximumResources omitted later entries in authored implementation order. */
	readonly capped: boolean;
	/** Lifetime categories only. Failed acquisitions return to configured and remain eligible for explicit retry. */
	readonly resources: readonly Readonly<
		{ readonly id: string; readonly state: 'configured' | 'acquiring' | 'ready' | 'releasing' | 'closed' }
	>[];
}
/** Keep diagnostic authority with the actual owning collection, without extending borrowed resolver facades. */
const inspectors = new WeakMap<ResourceCollection, (maximum: number) => ResourceInspectionType>();

/**
 * Observe the owning collection without acquiring resources, checking permissions or revealing values.
 * document() describes static contracts; this report describes current lifetime state. Only collections
 * created by this module carry this diagnostic capability. A scoped borrowed resolver does not grant it.
 */
export function inspect(
	collection: ResourceCollection,
	options: Readonly<{ readonly maximumResources: number }>,
): ResourceInspectionType {
	if (!Number.isSafeInteger(options.maximumResources) || options.maximumResources < 0) {
		throw new RangeError('Resource report maximumResources must be a non-negative safe integer.');
	}
	const read = inspectors.get(collection);
	if (read === undefined) {
		throw new TypeError('Resource inspection requires an owning collection created by this module.');
	}
	return read(options.maximumResources);
}

/**
 * Owns the internal live collection state used by the resource collection.
 *
 * ```text
 * collection.get(ctx, Resource)
 *        |
 *        +-- acquire declared dependencies first
 *        |
 *        +-- share one in-flight create() per definition
 *        |
 *        `-- remember acquired value and disposal order
 *
 * collection.dispose()
 *        `-- last acquired -> ... -> first acquired
 * ```
 *
 * Resource internals preserve exact definition identity, lazy dependency
 * acquisition, shared in-flight creation, and reverse-order disposal.
 *
 * @internal
 */
class LiveCollection implements ResourceCollection {
	/** Fixed validated graph; map insertion order is the bounded report order. */
	readonly #implementationByDefinition: ReadonlyMap<ResourceDefinition, ResourceImplementationAny>;
	/** Borrowed parsed environment; never included in diagnostics. */
	readonly #environment: Readonly<Record<string, unknown>>;
	/** Borrowed lazy environment source. Inspection must not read it. */
	readonly #source: env.EnvironmentSourceInput | undefined;
	/** Borrowed native host capability supplied only to resource construction. */
	readonly #host: unknown;
	/** Collection-owned cancellation lifetime, separate from individual borrowers. */
	readonly #ctx: context.Owned;
	/** Host requirement interpreters used only for implementation-acquisition requirements. */
	readonly #requirementRuntime: import('@okikio/capability/requirement').RequirementRuntime;
	/** Reverse acquisition cleanup; dependencies outlive their consumers. */
	readonly #resources = new AsyncDisposableStack();
	/** Single-flight creation promises; failures are removed so explicit subsequent use may retry. */
	readonly #acquisitions = new Map<ResourceDefinition, Promise<unknown>>();
	/** Successfully adopted values, including undefined; presence is checked independently of value. */
	readonly #values = new Map<ResourceDefinition, unknown>();
	/** A live object can be adopted by only one acquisition in this collection. */
	readonly #owners = new WeakMap<object, ResourceDefinition>();
	/** Cleanup failures from acquisitions still owned when collection disposal starts. */
	readonly #disposalFailures: unknown[] = [];
	/** Stops acquisition before joining all cleanup. Disposed is published only after cleanup settles. */
	#state: 'active' | 'disposing' | 'disposed' = 'active';
	/** All repeat disposers join the same cleanup outcome. */
	#disposalPromise: Promise<void> | undefined;

	/** Capture the validated graph and a child lifetime; providers stay lazy until get(). */
	constructor(set: ResourceImplementationSet, options: ResourceCollectionOptions<unknown>) {
		this.#implementationByDefinition = new Map(
			set.implementations.map((implementation) => [implementation.definition, implementation] as const),
		);
		this.#environment = options.environment ?? emptyEnvironment;
		this.#source = options.source;
		this.#host = options.host;
		this.#ctx = context.child(options.ctx);
		this.#requirementRuntime = options.requirements ??
			Object.freeze({ interpreters: Object.freeze({}), unknown: 'reject' as const });
		this.#resources.use(this.#ctx);
	}

	/** Read current ownership maps only; no provider calls, target validation, promises or values enter the report. */
	inspect(maximum: number): ResourceInspectionType {
		const resources: {
			readonly id: string;
			readonly state: 'configured' | 'acquiring' | 'ready' | 'releasing' | 'closed';
		}[] = [];
		for (const definition of this.#implementationByDefinition.keys()) {
			if (resources.length === maximum) break;
			const state = this.#state === 'disposed'
				? 'closed'
				: this.#values.has(definition)
				? this.#state === 'disposing' ? 'releasing' : 'ready'
				: this.#acquisitions.has(definition)
				? 'acquiring'
				: 'configured';
			resources.push(Object.freeze({ id: definition.id, state }));
		}
		return Object.freeze({
			state: this.#state,
			configured: this.#implementationByDefinition.size,
			capped: resources.length < this.#implementationByDefinition.size,
			resources: Object.freeze(resources),
		});
	}

	/**
	 * Check implementation coverage by exact definition identity, without acquiring a value.
	 *
	 * @internal
	 */
	has<Resource extends ResourceDefinition>(definition: Resource): boolean {
		return this.#implementationByDefinition.has(definition);
	}

	/**
	 * Check this borrower's direct requirements on every call, including cache hits.
	 * Borrower cancellation stops observation, not collection-owned creation shared
	 * with other borrowers. The returned value remains collection-owned.
	 *
	 * @internal
	 */
	async get<Resource extends ResourceDefinition>(
		ctx: import('@okikio/context').Context,
		definition: Resource,
	): Promise<ResourceValue<Resource>> {
		if (this.#state !== 'active') throw new CollectionDisposedError();
		context.check(ctx);
		if (!this.#implementationByDefinition.has(definition)) throw new MissingImplementationError(definition);

		// ResourceDefinition requirements belong to the borrower, not the cached value.
		// Reapply them for every public use so one actor cannot inherit another
		// actor's authority merely because the concrete resource already exists.
		if (definition.requirements.length > 0) {
			const governed = requirement.bind(ctx, definition.requirements);
			await requirement.apply(governed, definition.requirements);
		}
		return await context.observe(ctx.signal, this.#resolve(definition, [])) as ResourceValue<Resource>;
	}

	/**
	 * Resolve a dependency through the ready cache or one shared acquisition.
	 * Check the current path for cycles before joining an existing acquisition,
	 * otherwise a cycle would wait on itself. Remove failed acquisitions to permit
	 * an explicit later retry; successful values stay owned until disposal.
	 *
	 * @internal
	 */
	async #resolve(definition: ResourceDefinition, path: readonly ResourceDefinition[]): Promise<unknown> {
		if (this.#state !== 'active') throw new CollectionDisposedError();
		if (this.#values.has(definition)) return this.#values.get(definition);

		const cycleIndex = path.indexOf(definition);
		if (cycleIndex >= 0) throw new DependencyCycleError([...path.slice(cycleIndex), definition]);

		const existing = this.#acquisitions.get(definition);
		if (existing !== undefined) return await existing;

		const acquisition = this.#createValue(definition, [...path, definition]);
		this.#acquisitions.set(definition, acquisition);
		try {
			return await acquisition;
		} catch (error) {
			this.#acquisitions.delete(definition);
			throw error;
		}
	}

	/**
	 * Acquire dependencies before constructing one resource under an owned child context.
	 *
	 * The collection resolves exact definition objects and registers resources in
	 * dependency order, so disposal can run in reverse order. Construction borrows
	 * the context view; registered cleanup belongs to this acquisition lifetime.
	 *
	 * @internal
	 */
	async #createValue(definition: ResourceDefinition, path: readonly ResourceDefinition[]): Promise<unknown> {
		return await telemetry.get(this.#ctx).span(
			'resource.acquire',
			{ resource: definition.id },
			() => this.#acquireValue(definition, path),
		);
	}
	/** Own creation and partial cleanup under the child context; the surrounding span only observes that lifetime. */
	async #acquireValue(definition: ResourceDefinition, path: readonly ResourceDefinition[]): Promise<unknown> {
		const implementation = this.#implementationByDefinition.get(definition);
		if (implementation === undefined) throw new MissingImplementationError(definition, path.slice(0, -1));

		const selected = selectEnvironment(definition, this.#environment, this.#source);
		const environment = selected instanceof Promise ? await selected : selected;
		if (this.#state !== 'active') throw new CollectionDisposedError();

		const dependencies: Record<string, unknown> = Object.create(null);
		// Resolve the declared dependency graph before calling this factory. The
		// resource stack then closes consumers before the values they borrowed.
		for (const [key, dependency] of Object.entries(definition.dependencies)) {
			dependencies[key] = await this.#resolve(dependency, path);
		}

		context.check(this.#ctx);
		const ownedCtx = context.child(this.#ctx);
		const registered = new WeakSet<object>();
		const borrowed = new Set(Object.values(dependencies));
		// Dependencies keep their original owner even when a derived definition
		// returns the exact same value. Explicit registration cannot steal it.
		const claim = <Value>(value: Value): boolean => {
			if ((typeof value !== 'object' || value === null) && typeof value !== 'function') return true;
			const object = value as object;
			if (borrowed.has(value)) throw new TypeError('A borrowed dependency cannot be adopted by its consumer.');
			if (registered.has(object)) return false;
			const previous = this.#owners.get(object);
			if (previous !== undefined && previous !== definition) {
				throw new TypeError(`Resource ${JSON.stringify(previous.id)} already owns this value.`);
			}
			registered.add(object);
			this.#owners.set(object, definition);
			return true;
		};
		const baseCtx = requirement.scope(ownedCtx, {
			interpreters: this.#requirementRuntime.interpreters,
			unknown: this.#requirementRuntime.unknown,
		});
		// Resource construction borrows the owned context lifetime. Wrapping its
		// ownership methods lets us distinguish a returned disposable that the
		// implementation already registered from one the collection must adopt.
		const resourceCtx = Object.freeze({
			...baseCtx,
			use<ResourceValue extends Disposable | AsyncDisposable | null | undefined>(value: ResourceValue): ResourceValue {
				return claim(value) ? ownedCtx.use(value) : value;
			},
			adopt<ResourceValue>(
				value: ResourceValue,
				dispose: (value: ResourceValue) => void | PromiseLike<void>,
			): ResourceValue {
				return claim(value) ? ownedCtx.adopt(value, dispose) : value;
			},
			defer(dispose: () => void | PromiseLike<void>): void {
				ownedCtx.defer(dispose);
			},
		}) as import('./types.ts').ResourceCreateContext;
		try {
			const createCtx = implementation.requirements.length === 0
				? resourceCtx
				: requirement.bind(resourceCtx, implementation.requirements);
			if (implementation.requirements.length > 0) await requirement.apply(createCtx, implementation.requirements);
			const args = Object.freeze(
				{
					definition,
					dependencies: Object.freeze(dependencies),
					environment,
					host: this.#host,
					ctx: createCtx,
				} satisfies ResourceCreateArgumentsAny,
			);
			const value = await implementation.create(args);
			if (implementation.ownership === 'owned' && isDisposable(value) && !borrowed.has(value) && claim(value)) {
				ownedCtx.use(value);
			}

			if (this.#state !== 'active') {
				throw new CollectionDisposedError();
			}

			this.#resources.use(ownedCtx);
			this.#values.set(definition, value);
			return value;
		} catch (error) {
			try {
				await ownedCtx[asyncDispose]();
			} catch (cleanup) {
				const failure = new SuppressedError(
					cleanup,
					error,
					`Resource ${JSON.stringify(definition.id)} creation failed and cleanup also failed.`,
				);
				// A borrower can stop observing an acquisition before its cleanup
				// finishes. The disposing collection still owns that failure.
				if (this.#state !== 'active') this.#disposalFailures.push(failure);
				throw failure;
			}
			throw error;
		}
	}

	/**
	 * Stop acquisition and publish one join before synchronous abort observers run.
	 * Every disposer receives the same completion and cleanup failure.
	 *
	 * @internal
	 */
	[asyncDispose](): Promise<void> {
		if (this.#disposalPromise !== undefined) return this.#disposalPromise;
		const completion = Promise.withResolvers<void>();
		this.#disposalPromise = completion.promise;
		this.#state = 'disposing';
		context.cancel(this.#ctx, new CollectionDisposedError());
		void this.#dispose().then(completion.resolve, completion.reject);
		return completion.promise;
	}

	/**
	 * Join in-flight creations before releasing acquired lifetimes in reverse order.
	 * A borrower may already have stopped observing a failed acquisition; collection
	 * shutdown still reports the cleanup failure retained by that acquisition.
	 *
	 * @internal
	 */
	async #dispose(): Promise<void> {
		await Promise.allSettled([...this.#acquisitions.values()]);
		try {
			await this.#resources.disposeAsync();
		} catch (error) {
			this.#disposalFailures.push(error);
		} finally {
			this.#values.clear();
			this.#acquisitions.clear();
			this.#state = 'disposed';
		}
		if (this.#disposalFailures.length === 1) throw this.#disposalFailures[0];
		if (this.#disposalFailures.length > 1) {
			throw new AggregateError(this.#disposalFailures, 'Multiple resource lifetimes failed to clean up.');
		}
	}
}

/**
 * Walk dependencies before dependents, retaining one entry per exact object.
 * The active path detects cycles; the ID map separately detects independently
 * authored lookalikes. Record either defect instead of recursing forever or
 * silently choosing one definition.
 *
 * @internal
 */
function collectDefinitions(
	roots: readonly ResourceDefinition[],
	issues: ResourceValidationIssue[],
): ResourceDefinition[] {
	const definitions: ResourceDefinition[] = [];
	const visited = new Set<ResourceDefinition>();
	const visiting: ResourceDefinition[] = [];
	const byId = new Map<string, ResourceDefinition>();

	/**
	 * Walk dependencies before adding their consumer. The active path detects a
	 * cycle; the completed set avoids visiting a shared dependency twice. These
	 * are separate sets because an already completed dependency is safe to reuse,
	 * while waiting on an ancestor would make acquisition wait on itself.
	 */
	const visit = (definition: ResourceDefinition): void => {
		const owner = byId.get(definition.id);
		if (owner !== undefined && owner !== definition) {
			issues.push(Object.freeze({
				code: 'duplicate-definition-id',
				message: `Resource identifier ${JSON.stringify(definition.id)} is owned by different definitions.`,
				id: definition.id,
				first: owner,
				second: definition,
			}));
			return;
		}
		byId.set(definition.id, definition);

		const cycleIndex = visiting.indexOf(definition);
		if (cycleIndex >= 0) {
			const path = Object.freeze([...visiting.slice(cycleIndex), definition]);
			issues.push(Object.freeze({
				code: 'dependency-cycle',
				message: `Resource dependency cycle detected: ${path.map((item) => item.id).join(' -> ')}`,
				path,
			}));
			return;
		}
		if (visited.has(definition)) return;

		visiting.push(definition);
		for (const dependency of Object.values(definition.dependencies)) visit(dependency);
		visiting.pop();
		visited.add(definition);
		definitions.push(definition);
	};

	for (const root of roots) visit(root);
	return definitions;
}

/**
 * Find direct dependents for a missing-implementation diagnostic; no acquisition runs.
 *
 * @internal
 */
function findDependents(target: ResourceDefinition, definitions: readonly ResourceDefinition[]): ResourceDefinition[] {
	return definitions.filter((definition) => Object.values(definition.dependencies).includes(target));
}

/**
 * Visit each reachable dependency once in discovery order for static documentation.
 * The seen set terminates repeated edges; graph validation owns cycle diagnostics.
 *
 * @internal
 */
function collectTransitiveDependencies(definition: ResourceDefinition): ResourceDefinition[] {
	const result: ResourceDefinition[] = [];
	const seen = new Set<ResourceDefinition>();
	const visit = (current: ResourceDefinition): void => {
		for (const dependency of Object.values(current.dependencies)) {
			if (seen.has(dependency)) continue;
			seen.add(dependency);
			result.push(dependency);
			visit(dependency);
		}
	};
	visit(definition);
	return result;
}

/** Collect requirements reachable from one resource and its dependency graph. */
function collectTransitiveRequirements(
	definition: ResourceDefinition,
): readonly import('@okikio/capability/requirement').RequirementDefinition[] {
	return reachable(definition);
}

/**
 * Flatten optional trusted definitions to public IDs without serializing runtime values.
 *
 * @internal
 */
function ids(input: CatalogDefinitionInput<CatalogEntryIdentity> | undefined): readonly string[] {
	return input === undefined ? Object.freeze([]) : Object.freeze(catalogCore.values(input).map((entry) => entry.id));
}

/**
 * Parse only this resource's declared fields from a raw source, or select them
 * from host-validated configuration. Parsed host values are borrowed; selecting
 * fields does not revalidate them or expose unrelated secrets to the factory.
 *
 * @internal
 */
function selectEnvironment(
	definition: ResourceDefinition,
	environment: Readonly<Record<string, unknown>>,
	source: env.EnvironmentSourceInput | undefined,
): Readonly<Record<string, unknown>> | Promise<Readonly<Record<string, unknown>>> {
	if (definition.environment === undefined) return emptyEnvironment;
	if (source !== undefined) {
		const fields = Object.fromEntries(definition.environment.fields.map(({ key, field }) => [key, field]));
		return env.define(fields).parse(source);
	}
	const selected: Record<string, unknown> = Object.create(null);
	for (const field of definition.environment.fields) selected[field.key] = environment[field.key];
	return Object.freeze(selected);
}

/** Return whether a created value participates in explicit resource management. */
function isDisposable(value: unknown): value is Disposable | AsyncDisposable {
	if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return false;
	return typeof (value as Partial<AsyncDisposable>)[asyncDispose] === 'function' ||
		typeof (value as Partial<Disposable>)[dispose] === 'function';
}

/** Snapshot dependency records without dropping any type-visible entry. @internal */
function freezeRecord<const RecordType extends Readonly<Record<string, Entry>>, Entry>(record: RecordType): RecordType {
	return recordCore.snapshot(record, 'resource dependencies');
}

/**
 * Check the resource discriminator and required definition fields before indexing providers.
 *
 * @internal
 */
function assertDefinitionInput(
	input: ResourceOptions<ResourceDependencies, EnvironmentRequirement | undefined>,
): void {
	if (!/^[a-z0-9][a-z0-9._:-]*$/i.test(input.id)) {
		throw new TypeError(`Invalid resource id ${JSON.stringify(input.id)}.`);
	}
	if (input.description.trim().length === 0) throw new TypeError('Resource description cannot be empty.');
	if (input.dependencies !== undefined) recordCore.assert(input.dependencies, 'resource dependencies');
	for (const [key, dependency] of Object.entries(input.dependencies ?? {})) {
		if (key.length === 0) throw new TypeError('Resource dependency keys cannot be empty.');
		if (!isDefinition(dependency)) {
			throw new TypeError(`Resource dependency ${JSON.stringify(key)} is not a resource definition.`);
		}
	}
}

/**
 * Require an exact resource definition and callable factory before building a collection.
 *
 * @internal
 */
function assertImplementation(value: ResourceImplementationAny): void {
	if (!value || typeof value !== 'object' || !isDefinition(value.definition) || typeof value.create !== 'function') {
		throw new TypeError('Resource implementation must contain a definition and create function.');
	}
}

/**
 * Recognize the resource discriminator and descriptive fields; dependency
 * validation is separate, so this shape check is not a complete graph validator.
 *
 * @internal
 */
function isDefinition(value: unknown): value is ResourceDefinition {
	return typeof value === 'object' && value !== null &&
		(value as { kind?: unknown }).kind === 'resource' &&
		typeof (value as { id?: unknown }).id === 'string' &&
		typeof (value as { description?: unknown }).description === 'string';
}

/**
 * Distinguish implementation-set input from a definition/catalog input.
 * Individual factories and graph coverage are validated separately.
 *
 * @internal
 */
function isImplementationSet(value: unknown): value is ResourceImplementationSet {
	return typeof value === 'object' && value !== null &&
		Array.isArray((value as { implementations?: unknown }).implementations);
}

/**
 * Convert the first graph issue into its specific public error before creating
 * the runtime owner. Preserve exact definitions and cycle paths for diagnostics.
 *
 * @internal
 */
function throwValidationIssue(issue: ResourceValidationIssue): never {
	switch (issue.code) {
		case 'duplicate-definition-id':
			throw new DefinitionConflictError(issue.id, issue.first, issue.second);
		case 'duplicate-implementation':
			throw new ImplementationConflictError(issue.definition);
		case 'missing-implementation':
			throw new MissingImplementationError(issue.definition, issue.requiredBy);
		case 'dependency-cycle':
			throw new DependencyCycleError(issue.path);
	}
}

export type {
	ResourceCollection,
	ResourceCollectionOptions,
	ResourceCreateArguments,
	ResourceCreateArgumentsAny,
	ResourceCreateContext,
	ResourceDefinition,
	ResourceDependencies,
	ResourceDependencyValues,
	ResourceDocument,
	ResourceDocumentation,
	ResourceEnvironment,
	ResourceHealth,
	ResourceImplementation,
	ResourceImplementationAny,
	ResourceImplementationOptions,
	ResourceImplementationSet,
	ResourceOptions,
	ResourceResolver,
	ResourceValidationIssue,
	ResourceValidationResult,
	ResourceValue,
} from './types.ts';

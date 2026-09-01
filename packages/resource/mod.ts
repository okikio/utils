/**
 * Import-safe resource definitions and lazily acquired owned collections.
 *
 * Definitions describe required capabilities and dependencies. Implementations
 * provide host-specific construction without changing definition identity.
 *
 * @module
 */
import '@okikio/dispose/polyfill';
import * as recordCore from '@okikio/record';
import * as catalogCore from '@okikio/catalog';
import type {
	Catalog,
	CatalogEntryIdentity,
	CatalogSelection,
	DefinitionInput as CatalogDefinitionInput,
} from '@okikio/catalog';
import * as context from '@okikio/context';
import * as requirement from '@okikio/requirement';
import type { EnvironmentRequirement } from '@okikio/env';

import type {
	ResourceImplementationAny,
	ResourceCollection,
	ResourceCollectionOptions,
	ResourceDefinition,
	ResourceOptions,
	ResourceDependencies,
	ResourceDocument,
	ResourceCreateArgumentsAny,
	ResourceImplementation,
	ResourceImplementationOptions,
	ResourceImplementationSet,
	ResourceValidationIssue,
	ResourceValidationResult,
	ResourceValue,
} from './types.ts';

/** Shared immutable empty dependency map used by definitions that declare no dependencies. */
const emptyDependencies = Object.freeze(Object.create(null)) as Readonly<Record<string, never>>;
/** Shared immutable empty environment map used by definitions that declare no environment fields. */
const emptyEnvironment = Object.freeze(Object.create(null)) as Readonly<Record<string, never>>;

/** Error raised when two distinct definitions reuse one stable resource ID. */
export class DefinitionConflictError extends Error {
	readonly id: string;
	readonly first: ResourceDefinition;
	readonly second: ResourceDefinition;

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
	readonly definition: ResourceDefinition;

	constructor(definition: ResourceDefinition) {
		super(`Resource ${JSON.stringify(definition.id)} has more than one implementation.`);
		this.name = 'ImplementationConflictError';
		this.definition = definition;
	}
}

/** Error raised when a reachable resource definition has no implementation. */
export class MissingImplementationError extends Error {
	readonly definition: ResourceDefinition;
	readonly requiredBy: readonly ResourceDefinition[];

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
	readonly path: readonly ResourceDefinition[];

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
>(input: ResourceOptions<Dependencies, ResourceEnvironment>): ResourceDefinition<unknown, Dependencies, ResourceEnvironment>;
/** Define a resource with an explicit concrete value contract. */
export function define<ResourceValue>(): <
	const Dependencies extends ResourceDependencies = Readonly<Record<string, never>>,
	const ResourceEnvironment extends EnvironmentRequirement | undefined = undefined,
>(input: ResourceOptions<Dependencies, ResourceEnvironment>) => ResourceDefinition<ResourceValue, Dependencies, ResourceEnvironment>;
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
>(input: ResourceOptions<Dependencies, ResourceEnvironment>): ResourceDefinition<unknown, Dependencies, ResourceEnvironment> {
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
): CatalogSelection<Entries[keyof Entries], Pick<Entries, Keys[number]>> {
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
	return Object.freeze({ definition, requirements, create: input.create });
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
		const environment = definition.environment?.fields.map((field) => Object.freeze({
			key: field.key,
			reason: field.reason,
			requirementId: definition.environment!.id,
		})) ?? Object.freeze([]);
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

/** Alias for `resource.document()` when generating deployment or operator manifests. */
export const manifest = document;

/** Collect every statically reachable requirement from a resource graph. */
export function reachable(input: CatalogDefinitionInput<ResourceDefinition>): readonly import('@okikio/requirement').RequirementDefinition[] {
	const definitions = collectDefinitions(catalogCore.values(input), []);
	const inputs = definitions.map((definition) => definition.requirements);
	return inputs.length === 0 ? Object.freeze([]) : requirement.compose(inputs);
}

/**
 * Bind one resource collection to the current execution context.
 *
 * Every `get()` applies the exact resource definition's direct requirements
 * before borrowing the collection-owned value. This keeps actor authority at
 * use time even when the underlying value is cached and shared.
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
		async get<ResourceDefinition extends Allowed>(definition: ResourceDefinition): Promise<ResourceValue<ResourceDefinition>> {
			if (definitions !== undefined && !definitions.has(definition)) {
				throw new MissingImplementationError(definition);
			}
			return await collection.get(ctx, definition);
		},
	});
}

/** Create one independently owned, lazy resource collection. */
export function create<Host>(implementationSet: ResourceImplementationSet, options: ResourceCollectionOptions<Host>): ResourceCollection {
	const validation = validate(implementationSet);
	if (!validation.valid) throwValidationIssue(validation.issues[0]!);
	return new LiveCollection(implementationSet, options);
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
	readonly #implementationByDefinition: ReadonlyMap<ResourceDefinition, ResourceImplementationAny>;
	readonly #environment: Readonly<Record<string, unknown>>;
	readonly #host: unknown;
	readonly #ctx: context.Owned;
	/** Host requirement interpreters used only for implementation-acquisition requirements. */
	readonly #requirementRuntime: import('@okikio/requirement').RequirementRuntime;
	readonly #resources = new AsyncDisposableStack();
	readonly #acquisitions = new Map<ResourceDefinition, Promise<unknown>>();
	readonly #values = new Map<ResourceDefinition, unknown>();
	#state: 'active' | 'disposing' | 'disposed' = 'active';
	#disposalPromise: Promise<void> | undefined;

	constructor(set: ResourceImplementationSet, options: ResourceCollectionOptions<unknown>) {
		this.#implementationByDefinition = new Map(
			set.implementations.map((implementation) => [implementation.definition, implementation] as const),
		);
		this.#environment = options.environment ?? emptyEnvironment;
		this.#host = options.host;
		this.#ctx = context.child(options.ctx);
		this.#requirementRuntime = options.requirements ?? Object.freeze({ interpreters: Object.freeze({}), unknown: 'reject' as const });
		this.#resources.use(this.#ctx);
	}

	/**
	 * Checks whether the required state is present for the resource collection.
	 *
	 * @internal
	 */
	has<Resource extends ResourceDefinition>(definition: Resource): boolean {
		return this.#implementationByDefinition.has(definition);
	}

	/**
	 * Gets state from the resource collection after its ownership and validation rules have been established.
	 *
	 * @internal
	 */
	async get<Resource extends ResourceDefinition>(
		ctx: import('@okikio/context').Context,
		definition: Resource,
	): Promise<ResourceValue<Resource>> {
		if (this.#state !== 'active') throw new CollectionDisposedError();
		if (!this.#implementationByDefinition.has(definition)) throw new MissingImplementationError(definition);

		// ResourceDefinition requirements belong to the borrower, not the cached value.
		// Reapply them for every public use so one actor cannot inherit another
		// actor's authority merely because the concrete resource already exists.
		if (definition.requirements.length > 0) {
			const governed = requirement.bind(ctx, definition.requirements);
			await requirement.apply(governed, definition.requirements);
		}
		return await this.#resolve(definition, []) as ResourceValue<Resource>;
	}

	/**
	 * Resolves state from already validated module inputs.
	 *
	 * It preserves exact resource-definition identity, lazy dependency acquisition, and reverse-order collection disposal.
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
	 * Creates value while preserving the module's ownership rules.
	 *
	 * It preserves exact resource-definition identity, lazy dependency acquisition, and reverse-order collection disposal.
	 *
	 * @internal
	 */
	async #createValue(definition: ResourceDefinition, path: readonly ResourceDefinition[]): Promise<unknown> {
		const implementation = this.#implementationByDefinition.get(definition);
		if (implementation === undefined) throw new MissingImplementationError(definition, path.slice(0, -1));

		const dependencies: Record<string, unknown> = Object.create(null);
		for (const [key, dependency] of Object.entries(definition.dependencies)) {
			dependencies[key] = await this.#resolve(dependency, path);
		}

		context.check(this.#ctx);
		const ownedCtx = context.child(this.#ctx);
		const registered = new WeakSet<object>();
		const mark = <ResourceValue>(value: ResourceValue): ResourceValue => {
			if ((typeof value === 'object' && value !== null) || typeof value === 'function') registered.add(value as object);
			return value;
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
				mark(value);
				return ownedCtx.use(value);
			},
			adopt<ResourceValue>(value: ResourceValue, dispose: (value: ResourceValue) => void | PromiseLike<void>): ResourceValue {
				mark(value);
				return ownedCtx.adopt(value, dispose);
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
			const args: ResourceCreateArgumentsAny = Object.freeze({
				definition,
				dependencies: Object.freeze(dependencies),
				environment: selectEnvironment(definition, this.#environment),
				host: this.#host,
				ctx: createCtx,
			});
			const value = await implementation.create(args);
			if (isDisposable(value) && !registered.has(value as object)) ownedCtx.use(value);

			if (this.#state !== 'active') {
				await ownedCtx[Symbol.asyncDispose]();
				throw new CollectionDisposedError();
			}

			this.#resources.use(ownedCtx);
			this.#values.set(definition, value);
			return value;
		} catch (error) {
			try {
				await ownedCtx[Symbol.asyncDispose]();
			} catch (cleanup) {
				throw new SuppressedError(cleanup, error, `Resource ${JSON.stringify(definition.id)} creation failed and cleanup also failed.`);
			}
			throw error;
		}
	}

	/**
	 * Releases owned state and waits for cleanup completion when used with `await using`.
	 *
	 * @internal
	 */
	[Symbol.asyncDispose](): Promise<void> {
		if (this.#disposalPromise !== undefined) return this.#disposalPromise;
		this.#state = 'disposing';
		context.cancel(this.#ctx, new CollectionDisposedError());
		this.#disposalPromise = this.#dispose();
		return this.#disposalPromise;
	}

	/**
	 * Disposes owned state exactly once and releases all module-owned resources.
	 *
	 * It preserves exact resource-definition identity, lazy dependency acquisition, and reverse-order collection disposal.
	 *
	 * @internal
	 */
	async #dispose(): Promise<void> {
		await Promise.allSettled([...this.#acquisitions.values()]);
		this.#values.clear();
		this.#acquisitions.clear();
		this.#state = 'disposed';
		await this.#resources.disposeAsync();
	}
}

/**
 * Collects definitions while preserving deterministic identity and order.
 *
 * It preserves exact resource-definition identity, lazy dependency acquisition, and reverse-order collection disposal.
 *
 * @internal
 */
function collectDefinitions(roots: readonly ResourceDefinition[], issues: ResourceValidationIssue[]): ResourceDefinition[] {
	const definitions: ResourceDefinition[] = [];
	const visited = new Set<ResourceDefinition>();
	const visiting: ResourceDefinition[] = [];
	const byId = new Map<string, ResourceDefinition>();

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
 * Finds dependents used by the resource collection without creating it when absent.
 *
 * @internal
 */
function findDependents(target: ResourceDefinition, definitions: readonly ResourceDefinition[]): ResourceDefinition[] {
	return definitions.filter((definition) => Object.values(definition.dependencies).includes(target));
}

/**
 * Collects transitive dependencies while preserving deterministic identity and order.
 *
 * It preserves exact resource-definition identity, lazy dependency acquisition, and reverse-order collection disposal.
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
function collectTransitiveRequirements(definition: ResourceDefinition): readonly import('@okikio/requirement').RequirementDefinition[] {
	return reachable(definition);
}

/**
 * Collects the ids used to preserve stable identity in the resource collection.
 *
 * @internal
 */
function ids(input: CatalogDefinitionInput<CatalogEntryIdentity> | undefined): readonly string[] {
	return input === undefined ? Object.freeze([]) : Object.freeze(catalogCore.values(input).map((entry) => entry.id));
}

/**
 * Selects environment needed by the resource collection without changing the source definition.
 *
 * @internal
 */
function selectEnvironment(
	definition: ResourceDefinition,
	environment: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
	if (definition.environment === undefined) return emptyEnvironment;
	const selected: Record<string, unknown> = Object.create(null);
	for (const field of definition.environment.fields) selected[field.key] = environment[field.key];
	return Object.freeze(selected);
}

/** Return whether a created value participates in explicit resource management. */
function isDisposable(value: unknown): value is Disposable | AsyncDisposable {
	if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return false;
	return typeof (value as Partial<AsyncDisposable>)[Symbol.asyncDispose] === 'function' ||
		typeof (value as Partial<Disposable>)[Symbol.dispose] === 'function';
}

/** Snapshot dependency records without dropping any type-visible entry. @internal */
function freezeRecord<const RecordType extends Readonly<Record<string, Entry>>, Entry>(record: RecordType): RecordType {
	return recordCore.snapshot(record, 'resource dependencies');
}

/**
 * Rejects invalid definition input before it can enter authoritative module state.
 *
 * @internal
 */
function assertDefinitionInput(
	input: ResourceOptions<ResourceDependencies, EnvironmentRequirement | undefined>,
): void {
	if (!/^[a-z0-9][a-z0-9._:-]*$/i.test(input.id)) throw new TypeError(`Invalid resource id ${JSON.stringify(input.id)}.`);
	if (input.description.trim().length === 0) throw new TypeError('Resource description cannot be empty.');
	if (input.dependencies !== undefined) recordCore.assert(input.dependencies, 'resource dependencies');
	for (const [key, dependency] of Object.entries(input.dependencies ?? {})) {
		if (key.length === 0) throw new TypeError('Resource dependency keys cannot be empty.');
		if (!isDefinition(dependency)) throw new TypeError(`Resource dependency ${JSON.stringify(key)} is not a resource definition.`);
	}
}

/**
 * Rejects invalid implementation before it can enter authoritative module state.
 *
 * @internal
 */
function assertImplementation(value: ResourceImplementationAny): void {
	if (!value || typeof value !== 'object' || !isDefinition(value.definition) || typeof value.create !== 'function') {
		throw new TypeError('Resource implementation must contain a definition and create function.');
	}
}

/**
 * Checks whether definition satisfies the condition required by the resource collection.
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
 * Checks whether implementation set satisfies the condition required by the resource collection.
 *
 * @internal
 */
function isImplementationSet(value: unknown): value is ResourceImplementationSet {
	return typeof value === 'object' && value !== null &&
		Array.isArray((value as { implementations?: unknown }).implementations);
}

/**
 * Propagates validation issue through the controlled iterator path used by the resource collection.
 *
 * Resource internals preserve exact definition identity, lazy dependency acquisition, shared in-flight creation, and reverse-order disposal.
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
	ResourceImplementationAny,
	ResourceCollection,
	ResourceCreateArguments,
	ResourceCreateContext,
	ResourceCollectionOptions,
	ResourceDefinition,
	ResourceOptions,
	ResourceDependencies,
	ResourceDependencyValues,
	ResourceDocument,
	ResourceDocumentation,
	ResourceEnvironment,
	ResourceCreateArgumentsAny,
	ResourceHealth,
	ResourceImplementation,
	ResourceImplementationOptions,
	ResourceImplementationSet,
	ResourceResolver,
	ResourceValidationIssue,
	ResourceValidationResult,
	ResourceValue,
} from './types.ts';

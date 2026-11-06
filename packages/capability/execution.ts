/** Compose borrowed capabilities while the caller retains its operation lifetime. @module */
import * as context from '@okikio/context';
import type { Context, Resources } from '@okikio/context';
import * as effect from './effect/mod.ts';
import * as requirement from './requirement/mod.ts';
import * as resource from './resource/mod.ts';
import type { DefinitionInput } from '@okikio/collection/catalog';
import type { ResourceCollection, ResourceDefinition, ResourceResolver, ResourceValue } from './resource/types.ts';

/** Borrowed view retaining the caller's fields and the exact allowed resource union. */
export type Scope<Base extends Context = Context, Allowed extends ResourceDefinition = never> =
	& Omit<effect.EffectContext<requirement.RequirementContext<Base>>, 'get' | 'has'>
	& ResourceResolver<Allowed>;

/** Explicit resource access and interpreter choices for one borrowed view. */
export interface ScopeOptions<Allowed extends ResourceDefinition = never> {
	/** Borrow a collection without owning its cleanup; the exact allowed definitions are required. */
	readonly resources?: { readonly collection: ResourceCollection; readonly allowed: DefinitionInput<Allowed> };
	/** Replace the current interpreters. Omission retains an existing requirement view or rejects unknown families. */
	readonly requirements?: requirement.RequirementScopeOptions;
	/** Replace declared effects and their recipient. Omission retains an existing view or permits no effects. */
	readonly effects?: effect.EffectScopeOptions;
}

/**
 * Attach resource borrowing, requirements, and effect delivery to ordinary work.
 *
 * No operation runs and no requirement is activated by this call. The returned
 * view borrows the original signal, clock, cleanup methods, collection, and
 * recipient. Closing the view is closing the same owner, not a second owner.
 * Task and Activity use this composition while keeping their own execution and
 * checkpoint policy. Use requirement.apply() where a requirement becomes active.
 *
 * Resource access is always explicit. Omitting resources creates an empty
 * resolver, including when the source view had access to a broader collection.
 *
 * @example
 * ```ts
 * const scoped = scope(owner, { resources: { collection: clients, allowed: [Store] } });
 * const store = await scoped.get(Store);
 * ```
 */
export function scope<Base extends Context, Allowed extends ResourceDefinition = never>(
	base: Base,
	options: ScopeOptions<Allowed> = {},
): Scope<Base, Allowed> {
	const governed = requirement.scope(base, options.requirements);
	const accepted = effect.scope(governed, options.effects);
	const resolver = options.resources === undefined
		? undefined
		: resource.scope(options.resources.collection, accepted, options.resources.allowed);
	return context.view(accepted, {
		has: <Definition extends Allowed>(definition: Definition): boolean => resolver?.has(definition) ?? false,
		async get<Definition extends Allowed>(definition: Definition): Promise<ResourceValue<Definition>> {
			context.check(accepted);
			if (resolver === undefined) throw new resource.MissingImplementationError(definition);
			return await resolver.get(definition);
		},
	});
}

/**
 * One execution owns its registered cleanup, while a collection owns resources
 * returned by get(). Activity and Task extend this same contract with their own
 * identity, input, placement or progress semantics.
 */
export interface ExecutionContext<Allowed extends ResourceDefinition = never>
	extends Scope<Context, Allowed>, Resources {
	/** Reach an explicit cooperative pause point and recheck cancellation before resuming. */
	checkpoint(): Promise<void>;
}

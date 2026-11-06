/** Own a lazy resource collection without making local callers assemble its lifetime. @module */
import * as context from '@okikio/context';
import { AsyncDisposableStack } from '@okikio/dispose';
import { create, implementations } from './mod.ts';
import type {
	ResourceCollection,
	ResourceCollectionOptions,
	ResourceDefinition,
	ResourceImplementationAny,
	ResourceImplementationSet,
	ResourceValue,
} from './types.ts';

/** Host configuration. Omit ctx to give the returned collection its own cancellation and cleanup lifetime. */
export type OpenOptions<Host = unknown> = Omit<ResourceCollectionOptions<Host>, 'ctx' | 'host'> & {
	/** Borrow an existing lifetime; closing this collection never disposes that parent. */
	readonly ctx?: context.Owned;
	/** Native clients or other construction facilities, supplied only when the implementation needs them. */
	readonly host?: Host;
};

/** A lazy collection with a default borrowing context and an explicit escape hatch for composed execution. */
export interface Opened extends AsyncDisposable {
	/** Pass to Activity, Service or capability.scope when they own the per-call borrowing context. */
	readonly collection: ResourceCollection;
	/**
	 * Borrow the exact definition's value, opening it on first use. The collection owns its cleanup.
	 * Omit ctx for local owner-scoped work. Supply the current request context when its cancellation
	 * or authorization differs; requirements are still checked on every borrow, including cached values.
	 */
	get<Resource extends ResourceDefinition>(
		definition: Resource,
		ctx?: context.Context,
	): Promise<ResourceValue<Resource>>;
}

/**
 * Open one lazy collection from a binding, an array of bindings, or a validated implementation set.
 * The returned scope owns its resources and any Context it creates. No provider runs until get().
 * Use await using so failure and normal completion both join cleanup. Native host capabilities and
 * requirement interpreters remain explicit; this function never discovers credentials or grants access.
 */
export async function open<Host = unknown>(
	bindings: ResourceImplementationAny | readonly ResourceImplementationAny[] | ResourceImplementationSet,
	options: OpenOptions<Host> = {},
): Promise<Opened> {
	// Until move(), a failed validation or collection construction closes everything acquired here.
	await using ownership = new AsyncDisposableStack();
	const ctx = options.ctx ?? ownership.use(context.create({ id: 'resources' }));
	const set = 'implementations' in bindings
		? bindings
		: implementations(...('definition' in bindings ? [bindings] : bindings));
	const collection = ownership.use(create(set, { ...options, ctx, host: options.host }));
	const cleanup = ownership.move();
	return {
		collection,
		get: (definition, caller = ctx) => collection.get(caller, definition),
		[Symbol.asyncDispose]: () => cleanup.disposeAsync(),
	};
}

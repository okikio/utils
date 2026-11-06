/** Compose a resource binding with bounded retained sessions and one owned host lifetime. @module */
import * as context from '@okikio/context';
import { AsyncDisposableStack } from '@okikio/dispose';
import * as resources from '../mod.ts';
import type { ResourceImplementationAny, ResourceValue } from '../types.ts';
import type { OpenOptions as ResourceOptions } from '../open.ts';
import { Owner } from './owner.ts';
import type { Options } from './owner.ts';
import { memory, registry } from './store.ts';
import type { Registry } from './store.ts';
import type { OwnerType, PolicyInputType } from './schema.ts';

/** Configure the host once; individual create/use calls borrow that configured lifetime. */
export interface OpenOptions<Input = undefined, Host = unknown> extends ResourceOptions<Host> {
	/** Additional resource bindings needed by the selected resource. They remain local to each session. */
	readonly dependencies?: readonly ResourceImplementationAny[];
	/** Inject shared authority for several processes. It remains borrowed and requires an explicit executor identity. */
	readonly registry?: Registry;
	/** Registered executor and deployment generation. Omit only for local, process-bound use. */
	readonly owner?: OwnerType;
	/** Opening, live and closing objects together. Defaults to 100; excess creation rejects instead of queuing. */
	readonly maximum?: number;
	/** Override measured deployment budgets. Defaults: 30s owner lease, 30s borrow lease, 5min idle, exclusive borrowing. */
	readonly policy?: Partial<PolicyInputType>;
	/**
	 * Map typed per-session input to construction settings, such as a schema-checked environment source.
	 * It runs on this owner for each creation. Validate untrusted inputs at the calling activity boundary;
	 * source configuration is also checked by each resource's declared environment rules.
	 */
	readonly configure?: (input: Input) => Omit<ResourceOptions<Host>, 'ctx'>;
}

/** Join resource sessions before their internally created parent Context. Injected parents remain borrowed. */
class ResourceOwner<Value, Input> extends Owner<Value, Input> {
	/** Filled only after construction succeeds; until then the opening scope retains cleanup responsibility. */
	#ownership: AsyncDisposableStack | undefined;
	/** Repeated shutdown requests, including cancellation callbacks, join one complete cleanup operation. */
	#closed: Promise<void> | undefined;
	/** Transfer the completed construction scope; this class is private to this composition. */
	adopt(ownership: AsyncDisposableStack): void {
		this.#ownership = ownership;
	}
	override [Symbol.asyncDispose](): Promise<void> {
		if (this.#closed) return this.#closed;
		// Publish before cancellation observers can reenter disposal.
		const completion = Promise.withResolvers<void>();
		this.#closed = completion.promise;
		void (async () => {
			// The stack still closes its Context if session cleanup throws. Disposal preserves both failures.
			await using _ownership = this.#ownership;
			await super[Symbol.asyncDispose]();
		})().then(completion.resolve, completion.reject);
		return completion.promise;
	}
}

/**
 * Keep separate instances of one resource binding alive between actions.
 * Define the resource and implementation normally, then open this scope once on its host.
 * Each create() acquires a fresh collection; use() lends that instance and close() joins its cleanup.
 * Local defaults need no deployment identifiers or database. Inject registry and owner together for
 * distributed authority; memory defaults cannot coordinate different processes or restore a dead object.
 */
export async function open<Implementation extends ResourceImplementationAny, Input = undefined, Host = unknown>(
	implementation: Implementation,
	options: OpenOptions<Input, Host> = {},
): Promise<Owner<ResourceValue<Implementation['definition']>, Input>> {
	await using ownership = new AsyncDisposableStack();
	if (options.registry !== undefined && options.owner === undefined) {
		throw new TypeError('A shared session registry requires its registered executor owner.');
	}
	const maximum = options.maximum ?? 100;
	const ctx = options.ctx ?? ownership.use(context.create({ id: 'resource-sessions' }));
	const settings: Options<ResourceValue<Implementation['definition']>, Input> = {
		ctx,
		registry: options.registry ?? registry(memory({ maximum: maximum + 64, maximumTerminal: 64 })),
		owner: options.owner ?? { id: crypto.randomUUID(), generation: 1 },
		resource: implementation.definition.id,
		maximum,
		policy: {
			leaseMs: options.policy?.leaseMs ?? 30000,
			borrowMs: options.policy?.borrowMs ?? 30000,
			idleMs: options.policy?.idleMs ?? 300000,
			maximumBorrows: options.policy?.maximumBorrows ?? 1,
		},
		async create(_reference, signal, input) {
			// Each session owns its collection. Leaving a using scope here would close it before the first use.
			await using acquisition = new AsyncDisposableStack();
			const lifetime = acquisition.use(context.child(ctx, { signal }));
			const collection = acquisition.use(
				await resources.open([
					implementation,
					...options.dependencies ?? [],
				], { ...options, ...options.configure?.(input), ctx: lifetime }),
			);
			const value = await collection.get<Implementation['definition']>(implementation.definition);
			const cleanup = acquisition.move();
			return { value, [Symbol.asyncDispose]: () => cleanup.disposeAsync() };
		},
	};
	const owner = new ResourceOwner(settings);
	owner.adopt(ownership.move());
	return owner;
}

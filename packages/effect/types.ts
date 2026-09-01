import type { StandardSchemaV1 } from '@standard-schema/spec';
import type {
	Catalog,
	CatalogEntryIdentity,
	CatalogSelection,
	DefinitionInput as CatalogDefinitionInput,
} from '@okikio/catalog';
import type { Context as BaseContext } from '@okikio/context';

/** Standard Schema contract used to validate one effect value. */
export type EffectSchema<Input = unknown, Output = Input> = StandardSchemaV1<Input, Output>;

/** Options accepted by `effects.define()`. */
export interface EffectOptions<Id extends string = string, ValueSchema extends EffectSchema = EffectSchema> {
	/** Stable effect identity used for declarations, durable envelopes, and handler matching. */
	readonly id: Id;
	/** Human-readable consequence meaning used by documentation and diagnostics. */
	readonly description?: string;
	/** Schema that validates the concrete consequence data before ownership transfer. */
	readonly value: ValueSchema;
}

/** Immutable declaration of one required one-way consequence. */
export interface EffectDefinition<Id extends string = string, ValueSchema extends EffectSchema = EffectSchema>
	extends CatalogEntryIdentity {
	/** Stable discriminant for one required effect contract. */
	readonly kind: 'effect';
	/** Stable effect identity used by emitters, outboxes, and exact handlers. */
	readonly id: Id;
	/** Human-readable consequence meaning used by documentation and diagnostics. */
	readonly description?: string;
	/** Schema that owns validation of the effect value. */
	readonly value: ValueSchema;
}

/** Input accepted when creating one occurrence. */
export type EffectValueInput<Effect extends EffectDefinition> = StandardSchemaV1.InferInput<Effect['value']>;

/** Validated value carried by one occurrence. */
export type EffectValue<Effect extends EffectDefinition> = StandardSchemaV1.InferOutput<Effect['value']>;

/**
 * One frozen occurrence of a declared effect.
 *
 * The caller-owned key identifies the same logical consequence across retries.
 * It must not include an attempt number when a later attempt is retrying the
 * same consequence.
 */
export interface EffectOccurrence<Effect extends EffectDefinition = EffectDefinition> {
	/** Stable discriminant for one concrete consequence occurrence. */
	readonly kind: 'effect-occurrence';
	/** Exact effect definition whose handler must accept this consequence. */
	readonly definition: Effect;
	/** Retry-stable logical identity. A retried attempt reuses the same key for the same consequence. */
	readonly key: string;
	/** Schema-validated consequence data. */
	readonly value: EffectValue<Effect>;
}

/** Durable effect envelope that can cross a process, Worker, queue, or store. */
export interface EffectEncoded {
	/** Stable effect definition ID resolved by the receiving host. */
	readonly id: string;
	/** Retry-stable logical consequence key. */
	readonly key: string;
	/** Cloneable effect value that the receiving definition validates again. */
	readonly value: unknown;
}

/** Options accepted by `effects.create()` and the convenience `emit()` form. */
export interface EffectCreateOptions {
	/** Stable key for this logical consequence within the owning execution. */
	readonly key: string;
}

/**
 * Authoritative owner for required effects.
 *
 * Resolution means the owner accepted responsibility. It does not mean any
 * downstream work triggered by the effect has completed.
 */
export interface EffectEmitter {
	/** Accept ownership of one occurrence or reject before ownership transfer completes. */
	emit(ctx: BaseContext, occurrence: EffectOccurrence): Promise<void>;
}

/** Required-effect state attached to one local execution context. */
export interface EffectRuntime {
	/** Authoritative effect owner used by `effects.emit()` in this execution context. */
	readonly emitter?: EffectEmitter;
	/** Exact effect definitions the active code declared it may emit. */
	readonly effects: readonly EffectDefinition[];
}

/** Execution-context view with required-effect delivery available. */
export type EffectContext<Base extends BaseContext = BaseContext> = Base & Readonly<{ readonly effects: EffectRuntime }>;

/** Options accepted by `effects.scope()`. */
export interface EffectScopeOptions {
	/** Effect owner. Omit only when emission must fail as unconfigured. */
	readonly emitter?: EffectEmitter;
	/** Exact effect definitions that code in this scope can emit. */
	readonly effects: CatalogDefinitionInput<EffectDefinition>;
}

/** Named effect catalog. */
export type EffectCatalog<Entries extends Readonly<Record<PropertyKey, EffectDefinition>>> = Catalog<
	Entries[keyof Entries],
	Entries
>;

/** Key-preserving effect catalog selection. */
export type EffectSelection<
	Entry extends EffectDefinition,
	Entries extends Readonly<Record<PropertyKey, Entry>>,
> = CatalogSelection<Entry, Entries>;

/** Recursive input accepted where effect definitions are declared. */
export type EffectDefinitions = CatalogDefinitionInput<EffectDefinition>;

/** Exact implementation that accepts one effect definition. */
export interface EffectHandler<Effect extends EffectDefinition = EffectDefinition> {
	/** Exact effect definition accepted by this handler. */
	readonly definition: Effect;
	/** Accept one occurrence. Resolution is the authoritative ownership-transfer point. */
	accept(ctx: BaseContext, occurrence: EffectOccurrence<Effect>): void | Promise<void>;
}

/** Successful terminal receipt stored after an outbox handler accepts one queued effect. */
export interface EffectReceiptType {
	/** Stable effect definition ID whose queued occurrence was accepted. */
	readonly id: string;
	/** Retry-stable occurrence key whose downstream ownership is now established. */
	readonly key: string;
}

/** Options accepted while creating a queue-backed effect outbox. */
export interface EffectOutboxOptions {
	/** Queue that durably or locally owns admitted effect occurrences until terminal handling. */
	readonly queue: import('@okikio/queue').Queue<EffectEncoded, EffectReceiptType>;
	/** Exact handlers available to accept queued effect definitions. */
	readonly handlers: readonly EffectHandler[];
	/** Maximum handler attempts before the queued effect enters failed terminal state. */
	readonly maximumAttempts?: number;
	/** Delay applied when an effect handler must retry. */
	readonly retryDelay?: Temporal.Duration | Temporal.DurationLike | string;
	/** Close the injected queue when the outbox closes. Defaults to false. */
	readonly disposeQueue?: boolean;
	/** Override the stable queue idempotency key derived from context and effect identity. */
	readonly identity?: (ctx: BaseContext, occurrence: EffectOccurrence) => string;
}

/** Options accepted while draining one bounded batch from an outbox. */
export interface EffectDrainOptions {
	/** Claim owner identity used for this drain pass. */
	readonly owner?: string;
	/** Maximum queued effects claimed during this pass. */
	readonly limit?: number;
	/** Lease duration for each claimed effect while a handler owns it. */
	readonly duration?: Temporal.Duration | Temporal.DurationLike | string;
}

/** Outcome counters for one bounded outbox drain operation. */
export interface EffectDrainResultType {
	/** Number of queue items claimed by this drain pass. */
	readonly claimed: number;
	/** Number of effects whose exact handlers accepted ownership. */
	readonly accepted: number;
	/** Number of effects returned for another bounded attempt. */
	readonly retried: number;
	/** Number of effects committed as terminal failures after retry exhaustion. */
	readonly failed: number;
}

/** Queue-backed effect owner whose enqueue commit is the producer acceptance point. */
export interface EffectOutbox extends EffectEmitter, AsyncDisposable {
	/** Claim and handle one bounded batch without changing producer acceptance semantics. */
	drain(ctx: BaseContext, options?: EffectDrainOptions): Promise<EffectDrainResultType>;
	/** Stop new outbox work and release resources owned by this outbox. */
	close(reason?: unknown): Promise<void>;
}

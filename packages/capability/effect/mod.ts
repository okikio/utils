/**
 * Describe a business announcement, then hand it to the component that accepts responsibility for it.
 * An effect definition names the announcement and its value rule. An occurrence is one fact,
 * such as “asset-1 was saved.” Creating an occurrence does not deliver it.
 *
 * Call emit() to wait for the configured recipient to accept that occurrence. A queue-backed
 * recipient can accept it now and deliver it later. Acceptance and downstream completion are
 * separate results; a diagnostic log proves neither.
 *
 * A stable key lets a recipient recognize repeated delivery. The recipient must implement that
 * check: the key alone cannot make an external write occur exactly once. Cancelling after
 * acceptance does not remove an occurrence the recipient already accepted.
 *
 * @example
 * ```ts
 * import '@okikio/duration/polyfill';
 * import '@okikio/dispose/polyfill';
 * import * as context from '@okikio/context';
 * import * as effect from '@okikio/capability/effect';
 * import * as schema from '@okikio/schema';
 * const Saved = effect.define({ id: 'asset.saved', value: schema.object({ id: schema.string() }) });
 * await using owner = context.create({ id: 'save' });
 * const accepted: string[] = [];
 * const ctx = effect.scope(owner, {
 *   effects: [Saved],
 *   emitter: { async emit(_ctx, occurrence) { accepted.push(occurrence.key); } },
 * });
 * await effect.emit(ctx, Saved, { id: 'asset-1' }, { key: 'save:asset-1' });
 * console.log(accepted.join(','));
 * ```
 *
 * @module
 */
import { asyncDispose } from '@okikio/dispose';
import type { Temporal } from '@okikio/duration/temporal';
import { encodeHex } from '@std/encoding/hex';
import * as codec from '@okikio/schema/codec';
import * as record from '@okikio/collection/record';
import * as catalogCore from '@okikio/collection/catalog';
import type { DefinitionInput as CatalogDefinitionInput } from '@okikio/collection/catalog';
import * as contextCore from '@okikio/context';
import type { Context } from '@okikio/context';
import * as schema from '@okikio/schema';
import type { Queue, QueueClaim } from '@okikio/scheduler/queue';
import type {
	EffectCatalog,
	EffectContext,
	EffectCreateOptions,
	EffectDefinition,
	EffectDrainOptions,
	EffectEmitter,
	EffectEncoded,
	EffectHandler,
	EffectOccurrence,
	EffectOptions,
	EffectOutbox,
	EffectOutboxOptions,
	EffectReceiptType,
	EffectRuntime,
	EffectScopeOptions,
	EffectSelection,
	EffectValue,
	EffectValueInput,
} from './types.ts';

/** Process-local identity registry for occurrences created by this module instance. @internal */
const occurrences = new WeakSet<object>();

/** Error raised when durable effect data references an unknown trusted definition. */
export class UnknownEffectDefinitionError extends TypeError {
	/** Stable identity used to correlate this contract or occurrence. */
	readonly id: string;

	/** Create this UnknownEffectDefinitionError from the explicit contract values supplied by its caller. */
	constructor(id: string) {
		super(`Unknown effect definition ${JSON.stringify(id)}.`);
		this.name = 'UnknownEffectDefinitionError';
		this.id = id;
	}
}

/** Error raised when runtime code emits an effect that was not declared by the execution scope. */
export class UndeclaredEffectError extends Error {
	/** Exact effect definition that the active execution did not declare. */
	readonly definition: EffectDefinition;

	/** Create one execution error for an undeclared effect announcement. */
	constructor(definition: EffectDefinition) {
		super(`Effect ${JSON.stringify(definition.id)} is not declared by this execution scope.`);
		this.name = 'UndeclaredEffectError';
		this.definition = definition;
	}
}

/** Error raised when effect emission has no configured authoritative owner. */
export class MissingEffectEmitterError extends Error {
	constructor() {
		super('Effect emission requires an explicit effect emitter for this execution scope.');
		this.name = 'MissingEffectEmitterError';
	}
}

/** Error raised when two implementations claim authority for the same effect definition. */
export class DuplicateEffectHandlerError extends TypeError {
	/** Exact effect definition claimed by more than one authoritative handler. */
	readonly definition: EffectDefinition;

	/** Create one configuration error for duplicate authoritative effect ownership. */
	constructor(definition: EffectDefinition) {
		super(`Effect ${JSON.stringify(definition.id)} has more than one authoritative handler.`);
		this.name = 'DuplicateEffectHandlerError';
		this.definition = definition;
	}
}

/** Error raised when an effect owner has no exact handler for a declared effect. */
export class MissingEffectHandlerError extends Error {
	/** Exact declared effect definition for which no authoritative handler exists. */
	readonly definition: EffectDefinition;

	/** Create one execution error for a declared effect with no accepting handler. */
	constructor(definition: EffectDefinition) {
		super(`Effect ${JSON.stringify(definition.id)} has no authoritative handler.`);
		this.name = 'MissingEffectHandlerError';
		this.definition = definition;
	}
}

/** Define one immutable effect contract that code may announce. */
export function define<
	const Id extends string,
	ValueSchema extends import('./types.ts').EffectSchema,
>(input: EffectOptions<Id, ValueSchema>): EffectDefinition<Id, ValueSchema> {
	assertIdentifier(input.id);
	if (input.delivery !== undefined && input.delivery !== 'latest') throw new TypeError('Unknown effect delivery mode.');
	schema.assert(codec.input(input.value), 'effect value schema');
	return Object.freeze({
		kind: 'effect',
		id: input.id,
		...(input.description === undefined ? {} : { description: input.description }),
		value: input.value,
		...(input.delivery === undefined ? {} : { delivery: input.delivery }),
	});
}

/** Create a named immutable effect catalog. */
export function catalog<
	const Namespace extends string,
	const Entries extends Readonly<Record<PropertyKey, EffectDefinition>>,
>(
	namespace: Namespace,
	entries: Entries,
): EffectCatalog<Entries> {
	return catalogCore.create(namespace, entries);
}

/** Select a key-preserving effect catalog subset. */
export function select<
	const Entries extends Readonly<Record<PropertyKey, EffectDefinition>>,
	const Keys extends readonly (keyof Entries & string)[],
>(
	source: EffectCatalog<Entries>,
	keys: Keys,
): EffectSelection<Entries[Keys[number]], Pick<Entries, Keys[number]>> {
	return catalogCore.select(source, keys);
}

/** Compose effect definitions, catalogs, selections, and nested arrays. */
export function compose<Entry extends EffectDefinition>(
	...input: readonly CatalogDefinitionInput<Entry>[]
): readonly Entry[] {
	return catalogCore.compose(...input);
}

/**
 * Validate one payload and freeze its occurrence wrapper without delivering it.
 * Payload ownership follows the selected schema/codec; freezing the wrapper
 * does not recursively freeze arbitrary application values.
 */
export async function create<Effect extends EffectDefinition>(
	definition: Effect,
	value: EffectValueInput<Effect>,
	options: EffectCreateOptions,
): Promise<EffectOccurrence<Effect>> {
	assertDefinition(definition);
	assertKey(options.key);
	// The schema output is exact for `definition.value`, but TypeScript cannot
	// reduce `EffectValue<Effect>` through the generic definition property here.
	const parsed = await codec.read(definition.value, value) as EffectValue<Effect>;
	const occurrence: EffectOccurrence<Effect> = {
		kind: 'effect-occurrence',
		definition,
		key: options.key,
		value: parsed,
	};
	occurrences.add(occurrence);
	return Object.freeze(occurrence);
}

/**
 * Create an unowned effect-aware view of an existing execution context.
 *
 * The returned scope borrows the parent context, emitter, and effect
 * declarations. It creates no hidden registry and owns no cleanup. Omitted
 * options preserve an existing effect view; supplied options replace it.
 */
export function scope<Base extends import('@okikio/context').Context>(
	ctx: Base,
	options?: EffectScopeOptions,
): EffectContext<Base> {
	const selected = options ?? (ctx as Base & Partial<EffectContext>).effects ?? { effects: [] };
	const effects = catalogCore.compose(selected.effects);
	if (selected.emitter !== undefined && typeof selected.emitter.emit !== 'function') {
		throw new TypeError('Effect emitter must provide emit().');
	}
	const runtime = Object.freeze(
		{
			...(selected.emitter === undefined ? {} : { emitter: selected.emitter }),
			effects,
		} satisfies EffectRuntime,
	);
	return contextCore.view(ctx, { effects: runtime });
}

/** Emit one already-created occurrence and wait until its exact owner accepts responsibility. */
export function emit<Effect extends EffectDefinition>(
	ctx: EffectContext,
	occurrence: EffectOccurrence<Effect>,
): Promise<EffectOccurrence<Effect>>;
/** Create and emit one occurrence as a convenience for ordinary call sites. */
export function emit<Effect extends EffectDefinition>(
	ctx: EffectContext,
	definition: Effect,
	value: EffectValueInput<Effect>,
	options?: EffectCreateOptions,
): Promise<EffectOccurrence<Effect>>;
/** Execute the emit overload and return the exact accepted occurrence. */
export async function emit<Effect extends EffectDefinition>(
	ctx: EffectContext,
	input: Effect | EffectOccurrence<Effect>,
	value?: EffectValueInput<Effect>,
	options?: EffectCreateOptions,
): Promise<EffectOccurrence<Effect>> {
	contextCore.check(ctx);
	const occurrence = isOccurrence(input) ? declared(ctx, input) : await createDeclared(
		ctx,
		input,
		value as EffectValueInput<Effect>,
		options ?? (input.delivery === 'latest' ? { key: 'latest' } : requireCreateOptions(options)),
	);
	const emitter = ctx.effects.emitter;
	if (emitter === undefined) throw new MissingEffectEmitterError();
	contextCore.check(ctx);
	await emitter.emit(ctx, occurrence);
	return occurrence;
}

/** Validate declaration membership for an already-created occurrence. */
function declared<Effect extends EffectDefinition>(
	ctx: EffectContext,
	occurrence: EffectOccurrence<Effect>,
): EffectOccurrence<Effect> {
	assertDeclared(ctx, occurrence.definition);
	return occurrence;
}

/** Validate declaration membership before schema work for the create-and-emit form. */
async function createDeclared<Effect extends EffectDefinition>(
	ctx: EffectContext,
	definition: Effect,
	value: EffectValueInput<Effect>,
	options: EffectCreateOptions,
): Promise<EffectOccurrence<Effect>> {
	assertDeclared(ctx, definition);
	const occurrence = await create(definition, value, options);
	contextCore.check(ctx);
	return occurrence;
}

/** Encode validated application output through its explicit wire direction. */
export async function encode(value: EffectOccurrence): Promise<EffectEncoded> {
	assertOccurrence(value);
	const parsed = await codec.write(value.definition.value, value.value);
	return Object.freeze({ id: value.definition.id, key: value.key, value: parsed });
}

/** Decode and validate a durable occurrence through trusted exact definitions. */
export async function decode<Entry extends EffectDefinition>(
	value: unknown,
	trusted: CatalogDefinitionInput<Entry>,
): Promise<EffectOccurrence<Entry>> {
	if (!isEncoded(value)) throw new TypeError('EffectEncoded effect must contain string id, key, and value fields.');
	const definition = catalogCore.compose(trusted).find((entry) => entry.id === value.id);
	if (definition === undefined) throw new UnknownEffectDefinitionError(value.id);
	return await create(definition, value.value as EffectValueInput<Entry>, { key: value.key });
}

/** Return whether a value is an effect occurrence created by this module instance. */
export function isOccurrence(value: unknown): value is EffectOccurrence {
	return typeof value === 'object' && value !== null && occurrences.has(value);
}

/** Return whether a value is an occurrence of one exact effect definition. */
export function is<Effect extends EffectDefinition>(
	value: unknown,
	definition: Effect,
): value is EffectOccurrence<Effect> {
	return isOccurrence(value) && value.definition === definition;
}

/** Validate one occurrence before durable encoding. */
function assertOccurrence(value: EffectOccurrence): void {
	if (!isOccurrence(value)) throw new TypeError('Value is not an effect occurrence.');
	assertKey(value.key);
}

/** Require create options for the convenience `emit()` overload. */
function requireCreateOptions(value: EffectCreateOptions | undefined): EffectCreateOptions {
	if (value === undefined) throw new TypeError('effect.emit() requires create options when given a definition.');
	return value;
}

/** Reject an effect that the current execution scope did not statically declare. */
function assertDeclared(ctx: EffectContext, definition: EffectDefinition): void {
	if (!ctx.effects.effects.includes(definition)) throw new UndeclaredEffectError(definition);
}

/** Recognize an effect-shaped definition; declaration membership separately checks exact object identity. */
function isDefinition(value: unknown): value is EffectDefinition {
	return typeof value === 'object' && value !== null &&
		(value as { readonly kind?: unknown }).kind === 'effect' &&
		typeof (value as { readonly id?: unknown }).id === 'string' &&
		typeof (value as { readonly value?: unknown }).value === 'object';
}

/** Validate one effect definition before creating runtime state. */
function assertDefinition(value: EffectDefinition): void {
	if (!isDefinition(value)) throw new TypeError('Effect occurrence must reference an effect definition.');
}

/**
 * Return whether a durable effect envelope is an inert ordinary data record.
 *
 * Descriptor inspection prevents accessor-backed transport values from running
 * caller code while the decoder is only classifying input.
 *
 * @internal
 */
function isEncoded(value: unknown): value is EffectEncoded {
	return record.is(value) &&
		Object.hasOwn(value, 'id') && typeof value.id === 'string' &&
		Object.hasOwn(value, 'key') && typeof value.key === 'string' &&
		Object.hasOwn(value, 'value');
}

/** Validate the caller-owned idempotency key. */
function assertKey(value: string): void {
	if (value.trim().length === 0) throw new TypeError('Effect key must not be empty.');
	if (value.length > 512) throw new TypeError('Effect key must not exceed 512 characters.');
}

/** Bind one exact effect definition to its authoritative acceptance behavior. */
export function implement<Effect extends EffectDefinition>(
	definition: Effect,
	accept: EffectHandler<Effect>['accept'],
): EffectHandler<Effect> {
	assertDefinition(definition);
	if (typeof accept !== 'function') throw new TypeError('Effect handler must provide an acceptance function.');
	return Object.freeze({ definition, accept });
}

/**
 * Create a direct effect emitter from exact handlers.
 *
 * Direct acceptance runs the handler before `emit()` resolves. Use this form
 * when producer and effect owner share one process and no durable handoff is
 * required.
 */
export function emitter(...handlers: readonly EffectHandler[]): EffectEmitter {
	const table = handlerTable(handlers);
	return Object.freeze({
		async emit(ctx: Context, occurrence: EffectOccurrence) {
			contextCore.check(ctx);
			const handler = table.get(occurrence.definition);
			if (handler === undefined) throw new MissingEffectHandlerError(occurrence.definition);
			await handler.accept(ctx, occurrence);
		},
	});
}

/**
 * Create a queue-backed effect outbox.
 *
 * Producer acceptance occurs when `queue.add()` commits the idempotent outbox
 * item. `drain()` later claims that item and invokes the one exact handler. The
 * injected queue remains caller-owned unless `disposeQueue` is true.
 */
export function outbox(options: EffectOutboxOptions): EffectOutbox {
	const maximumAttempts = positiveInteger(options.maximumAttempts ?? 8, 'effect maximumAttempts');
	const handlers = handlerTable(options.handlers);
	const definitions = [...handlers.keys()];
	const retryDelay = options.retryDelay ?? { seconds: 1 };
	const identity = options.identity ?? defaultIdentity;
	let closed = false;
	let closePromise: Promise<void> | undefined;

	const box = Object.freeze(
		{
			async emit(ctx: Context, occurrence: EffectOccurrence) {
				contextCore.check(ctx);
				if (closed) throw new Error('Effect outbox is closed.');
				if (!handlers.has(occurrence.definition)) throw new MissingEffectHandlerError(occurrence.definition);
				const encoded = await encode(occurrence);
				const key = await identity(ctx, occurrence);
				assertKey(key);
				await options.queue.add(ctx, encoded, { key });
			},
			/**
			 * Claim at most the requested batch and deliver it one item at a time.
			 * Queue claims decide which attempt may acknowledge each item. A handler
			 * can already have performed its external write when acknowledgement fails,
			 * so the handler still needs a repeat-safe business identity.
			 */
			async drain(ctx: Context, drainOptions: EffectDrainOptions = {}) {
				contextCore.check(ctx);
				if (closed) throw new Error('Effect outbox is closed.');
				const limit = positiveInteger(drainOptions.limit ?? 1, 'effect drain limit');
				const claims = await options.queue.claim(ctx, {
					owner: drainOptions.owner ?? ctx.id,
					limit,
					...(drainOptions.duration === undefined ? {} : { duration: drainOptions.duration }),
				});
				let accepted = 0;
				let retried = 0;
				let failed = 0;
				// Finish each claimed delivery before starting the next; this loop does not create parallel sink calls.
				for (const claim of claims) {
					contextCore.check(ctx);
					const result = await dispatch(ctx, claim, options.queue, definitions, handlers, maximumAttempts, retryDelay);
					if (result === 'accepted') accepted++;
					else if (result === 'retried') retried++;
					else failed++;
				}
				return Object.freeze({ claimed: claims.length, accepted, retried, failed });
			},
			close(reason?: unknown) {
				closePromise ??= (async () => {
					if (closed) return;
					closed = true;
					if (options.disposeQueue === true) await options.queue.close(reason);
				})();
				return closePromise;
			},
			async [asyncDispose]() {
				await box.close('Effect outbox was disposed.');
			},
		} satisfies EffectOutbox,
	);
	return box;
}

/**
 * Accept one occurrence, then acknowledge its fenced queue claim. Failure of
 * acknowledgement can cause redelivery even after the handler accepted it, so
 * handlers need idempotent acceptance. Cancellation leaves the claim to expire;
 * other decode, handler, or completion failures consume the configured retry budget.
 */
async function dispatch(
	ctx: Context,
	claim: QueueClaim<EffectEncoded>,
	queue: Queue<EffectEncoded, EffectReceiptType>,
	definitions: readonly EffectDefinition[],
	handlers: ReadonlyMap<EffectDefinition, EffectHandler>,
	maximumAttempts: number,
	retryDelay: Temporal.Duration | Temporal.DurationLike | string,
): Promise<'accepted' | 'retried' | 'failed'> {
	try {
		const occurrence = await decode(claim.value, definitions);
		const handler = handlers.get(occurrence.definition);
		if (handler === undefined) throw new MissingEffectHandlerError(occurrence.definition);
		await handler.accept(ctx, occurrence);
		await queue.complete(ctx, claim, Object.freeze({ id: occurrence.definition.id, key: occurrence.key }));
		return 'accepted';
	} catch (error) {
		// Cancellation leaves the claim to expire. A cancelled drain must not use
		// an already-cancelled context to mutate durable retry state.
		if (ctx.signal.aborted) throw error;
		if (claim.attempt < maximumAttempts) {
			await queue.retry(ctx, claim, { delay: retryDelay });
			return 'retried';
		}
		await queue.fail(
			ctx,
			claim,
			Object.freeze({
				id: 'effect.handler-fault',
				data: Object.freeze({ effectId: claim.value.id, effectKey: claim.value.key, attempt: claim.attempt }),
				message: error instanceof Error ? error.message : 'Effect handler faulted.',
			}),
		);
		return 'failed';
	}
}

/** Build one exact-handler table and reject duplicate effect authority eagerly. */
function handlerTable(handlers: readonly EffectHandler[]): ReadonlyMap<EffectDefinition, EffectHandler> {
	const table = new Map<EffectDefinition, EffectHandler>();
	for (const handler of handlers) {
		assertDefinition(handler.definition);
		if (typeof handler.accept !== 'function') throw new TypeError('Effect handler must provide accept().');
		if (table.has(handler.definition)) throw new DuplicateEffectHandlerError(handler.definition);
		table.set(handler.definition, handler);
	}
	return table;
}

/** Derive one retry-stable outbox key from execution and logical effect identity. */
async function defaultIdentity(ctx: Context, occurrence: EffectOccurrence): Promise<string> {
	const tuple = JSON.stringify([ctx.idempotencyKey ?? ctx.id, occurrence.definition.id, occurrence.key]);
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(tuple));
	return `effect-v1:${encodeHex(new Uint8Array(digest))}`;
}

/** Require positive bounded counts before they control queue or retry growth. */
function positiveInteger(value: number, name: string): number {
	if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${name} must be a positive safe integer.`);
	return value;
}

/** Reject an invalid stable effect identifier before it enters authoritative state. */
function assertIdentifier(id: string): void {
	if (!/^[a-z0-9][a-z0-9._:-]*$/i.test(id)) throw new TypeError(`Invalid effect id ${JSON.stringify(id)}.`);
}

export type {
	EffectCatalog,
	EffectContext,
	EffectCreateOptions,
	EffectDefinition,
	EffectDefinitions,
	EffectDrainOptions,
	EffectEmitter,
	EffectEncoded,
	EffectHandler,
	EffectOccurrence,
	EffectOptions,
	EffectOutbox,
	EffectOutboxOptions,
	EffectReceiptType,
	EffectRuntime,
	EffectScopeOptions,
	EffectSelection,
	EffectValue,
	EffectValueInput,
} from './types.ts';

export { observe } from './observe.ts';
export type { EffectObserver, ObserveOptions } from './observe.ts';

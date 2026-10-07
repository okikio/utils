import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Catalog, CatalogSelection } from '@okikio/catalog';

/**
 * Frozen declaration of one expected failure family.
 *
 * A definition gives an expected failure a stable durable identity and a
 * Standard Schema data contract. It does not choose an HTTP status, CLI exit
 * code, retry policy, or result container.
 */
export interface Definition<Id extends string = string, Data = unknown> {
	/** Stable discriminant that selects the documented variant. */
	readonly kind: 'failure';
	/** Stable identity used to correlate this contract or occurrence. */
	readonly id: Id;
	/** Caller-authored purpose used in documentation and diagnostics. */
	readonly description: string;
	/** Data payload carried by this representation. */
	readonly data: StandardSchemaV1<unknown, Data>;
}

/** Data output represented by a failure definition. */
export type Data<FailureDefinition extends Definition> = StandardSchemaV1.InferOutput<FailureDefinition['data']>;

/**
 * In-process frozen occurrence of one exact expected failure definition.
 *
 * `cause` is diagnostic process-local data. Encoding deliberately omits it so
 * durable failure records contain only stable definition data and the message.
 */
export interface Occurrence<FailureDefinition extends Definition = Definition> extends Error {
	/** Exact declared contract object; an independently authored same-name object is not the same declaration. */
	readonly definition: FailureDefinition;
	/** Data payload carried by this representation. */
	readonly data: Data<FailureDefinition>;
	/** Original failure that caused this diagnostic or cancellation result. */
	readonly cause?: unknown;
}

/**
 * Durable representation of an expected failure occurrence.
 *
 * The stable `id` lets a receiving process resolve the original definition and
 * revalidate `data` before it reconstructs the occurrence.
 */
export interface Encoded {
	/** Stable identity used to correlate this contract or occurrence. */
	readonly id: string;
	/** Data payload carried by this representation. */
	readonly data: unknown;
	/** Human-readable explanation; use the stable code or discriminant for program decisions. */
	readonly message: string;
}

/** Named failure catalog. */
export type FailureCatalog<Entries extends Readonly<Record<PropertyKey, Definition>>> = Catalog<
	Entries[keyof Entries],
	Entries
>;

/** Key-preserving failure catalog selection. */
export type FailureSelection<
	Entry extends Definition,
	Entries extends Readonly<Record<PropertyKey, Entry>>,
> = CatalogSelection<Entry, Entries>;

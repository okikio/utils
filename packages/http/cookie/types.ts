import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { CatalogEntryIdentity } from '@okikio/catalog';

/** Browser SameSite policy for an application cookie. */
export type CookieSameSite = 'strict' | 'lax' | 'none';

/** Static attributes applied whenever a cookie is written. */
export interface CookieAttributes {
	/** Domain attribute explicitly selected for the cookie. */
	readonly domain?: string;
	/** Explicit cookie Path attribute. */
	readonly path?: string;
	/** Whether cookie serialization includes the Secure attribute. */
	readonly secure?: boolean;
	/** Whether cookie serialization includes the HttpOnly attribute. */
	readonly httpOnly?: boolean;
	/** Explicit SameSite attribute serialized for this cookie. */
	readonly sameSite?: CookieSameSite;
	/** Whether cookie serialization includes the Partitioned attribute. */
	readonly partitioned?: boolean;
	/** Explicit cookie Priority attribute, when selected. */
	readonly priority?: 'low' | 'medium' | 'high';
	/** Cookie Max-Age in seconds. */
	readonly maxAge?: number;
}

/** Import-safe definition of one stable application cookie. */
export interface CookieDefinition<Schema extends StandardSchemaV1<string, string> = StandardSchemaV1<string, string>>
	extends CatalogEntryIdentity {
	/** Discriminant used to recognize this contract without inspecting its other fields. */
	readonly kind: 'cookie';
	/** Wire cookie name; distinct from its catalog definition ID. */
	readonly name: string;
	/** Standard Schema used to validate the string cookie value. */
	readonly value: Schema;
	/** Static cookie attributes retained by the definition. */
	readonly attributes: CookieAttributes;
}

/** Input accepted by `cookie.define()`. */
export interface CookieDefinitionInput<Schema extends StandardSchemaV1<string, string>> {
	/** Stable declaration identity used for exact lookup and diagnostic correlation. */
	readonly id: string;
	/** Purpose and behavior of this contract, supplied by its author. */
	readonly description: string;
	/** Wire cookie name; distinct from its catalog definition ID. */
	readonly name: string;
	/** Standard Schema used to validate the string cookie value. */
	readonly value: Schema;
	/** Static cookie attributes retained by the definition. */
	readonly attributes?: CookieAttributes;
}

/** Output inferred from a cookie definition's Standard Schema. */
export type CookieValue<Definition extends CookieDefinition> = StandardSchemaV1.InferOutput<Definition['value']>;

/** Optional per-occurrence attributes applied while setting a cookie. */
export interface SetCookieOptions {
	/** Per-occurrence cookie expiry instant supplied by the caller. */
	readonly expires?: Temporal.Instant | Date;
	/** Per-occurrence cookie Max-Age in seconds. */
	readonly maxAge?: number;
}

/** Non-throwing cookie read result. */
export type CookieReadResult<Value> =
	| Readonly<{ readonly success: true; readonly value: Value | undefined }>
	| Readonly<{ readonly success: false; readonly issues: readonly StandardSchemaV1.Issue[] }>;

/** JSON-safe cookie definition projection. */
export interface CookieDocument {
	/** Stable declaration identity used for exact lookup and diagnostic correlation. */
	readonly id: string;
	/** Wire cookie name retained in documentation. */
	readonly name: string;
	/** Purpose and behavior of this contract, supplied by its author. */
	readonly description: string;
	/** Static cookie attributes retained by the definition. */
	readonly attributes: CookieAttributes;
}

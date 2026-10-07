import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { CatalogEntryIdentity } from '@okikio/catalog';
import type { HeaderInput, ResponseHeaders } from '@okikio/http/response/headers';

/** Supported RFC 9457 HTTP error status. */
export type ProblemStatus = number;

/** Public severity classification used by documentation and diagnostics. */
export type ProblemSeverity = 'info' | 'warning' | 'error' | 'critical';

/** Retry guidance attached to a problem definition. */
export type ProblemRetryPolicy =
	| { readonly kind: 'never' }
	| { readonly kind: 'immediate'; readonly maximumAttempts?: number }
	| { readonly kind: 'after'; readonly header?: string; readonly defaultSeconds?: number };

/** Provider metadata retained for internal problem catalogs. */
export interface ProblemProviderMetadata {
	/** External provider identity retained as problem metadata. */
	readonly name: string;
	/** Stable failure code; callers should branch on this instead of matching explanation text. */
	readonly code?: string;
	/** Reference URL supplied for the external provider. */
	readonly documentation?: string;
}

/** Concrete problem example retained for generated references. */
export interface ProblemExample {
	/** Authored name of this entry or example in its containing catalog. */
	readonly key: string;
	/** Short explanation shown beside this operation or example in generated references. */
	readonly summary?: string;
	/** Concrete example payload retained for generated documentation. */
	readonly value: Readonly<Record<string, unknown>>;
}

/** Contract for extension members appended to the RFC 9457 body. */
export interface ProblemExtensionContract<Schema extends StandardSchemaV1 = StandardSchemaV1> {
	/** Standard Schema that validates definition-specific problem extension members. */
	readonly schema: Schema;
	/** Purpose and behavior of this contract, supplied by its author. */
	readonly description?: string;
}

/** Static immutable RFC 9457 problem definition. */
export interface ProblemDefinition<
	Extensions extends ProblemExtensionContract | undefined = ProblemExtensionContract | undefined,
	Status extends ProblemStatus = ProblemStatus,
> extends CatalogEntryIdentity {
	/** Discriminant used to recognize this contract without inspecting its other fields. */
	readonly kind: 'problem';
	/** RFC 9457 problem type URI retained by the definition. */
	readonly type: string;
	/** HTTP status selected by this response or reported by this lifecycle observation. */
	readonly status: Status;
	/** Stable short title for this problem type. */
	readonly title: string;
	/** Purpose and behavior of this contract, supplied by its author. */
	readonly description: string;
	/** Caller-facing action that may resolve this problem, when one is known. */
	readonly remediation?: string;
	/** External reference for this problem type. */
	readonly externalDocumentation?: string;
	/** Application-owned localization identity for this problem type. */
	readonly localizationKey?: string;
	/** Concrete authored examples retained for API documentation. */
	readonly examples?: readonly ProblemExample[];
	/** Declared retry guidance; the caller or runtime still owns actual retry scheduling. */
	readonly retry?: ProblemRetryPolicy;
	/** Diagnostic severity assigned to this problem type. */
	readonly severity?: ProblemSeverity;
	/** Definition-specific problem extension contract or validated occurrence members. */
	readonly extensions?: Extensions;
	/** Whether this problem type is public or intended for internal use. */
	readonly exposure: 'public' | 'internal';
	/** Optional provider metadata retained with this problem type. */
	readonly provider?: ProblemProviderMetadata;
}

/** Input accepted by {@link define}. */
export interface ProblemDefinitionInput<
	Extensions extends ProblemExtensionContract | undefined,
	Status extends ProblemStatus,
> {
	/** Stable declaration identity used for exact lookup and diagnostic correlation. */
	readonly id: string;
	/** RFC 9457 problem type URI retained by the definition. */
	readonly type: string;
	/** HTTP status selected by this response or reported by this lifecycle observation. */
	readonly status: Status;
	/** Stable short title for this problem type. */
	readonly title: string;
	/** Purpose and behavior of this contract, supplied by its author. */
	readonly description: string;
	/** Caller-facing action that may resolve this problem, when one is known. */
	readonly remediation?: string;
	/** External reference for this problem type. */
	readonly externalDocumentation?: string;
	/** Application-owned localization identity for this problem type. */
	readonly localizationKey?: string;
	/** Concrete authored examples retained for API documentation. */
	readonly examples?: readonly ProblemExample[];
	/** Declared retry guidance; the caller or runtime still owns actual retry scheduling. */
	readonly retry?: ProblemRetryPolicy;
	/** Diagnostic severity assigned to this problem type. */
	readonly severity?: ProblemSeverity;
	/** Definition-specific problem extension contract or validated occurrence members. */
	readonly extensions?: Extensions;
	/** Whether this problem type is public or intended for internal use. */
	readonly exposure?: 'public' | 'internal';
	/** Optional provider metadata retained with this problem type. */
	readonly provider?: ProblemProviderMetadata;
}

/** Canonical RFC 9457 members plus definition-specific extensions. */
export type ProblemBody<Definition extends ProblemDefinition = ProblemDefinition> = Readonly<{
	type: Definition['type'];
	title: Definition['title'];
	status: Definition['status'];
	detail?: string;
	instance?: string;
	[key: string]: unknown;
}>;

/** Immutable headers attached to a problem result. */
export type ProblemHeaders = ResponseHeaders;

/** Options supplied while creating one problem occurrence. */
export interface CreateProblemOptions<
	Extensions extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>,
> {
	/** Occurrence-specific explanation serialized in the problem body. */
	readonly detail?: string;
	/** URI identifying this particular problem occurrence. */
	readonly instance?: string;
	/** Occurrence members validated by the declared extension contract. */
	readonly extensions?: Extensions;
	/** Explicit transport headers retained for this boundary; credential forwarding uses its separate policy. */
	readonly headers?: HeaderInput;
	/** Original diagnostic cause retained outside the public problem body. */
	readonly cause?: unknown;
}

/** Hidden metadata retained by a problem tuple. */
export interface ProblemResultMetadata<Definition extends ProblemDefinition = ProblemDefinition> {
	/** Exact problem definition retained with this logical tuple. */
	readonly definition: Definition;
	/** Original diagnostic cause retained outside the public problem body. */
	readonly cause?: unknown;
}

/** Logical RFC 9457 response tuple returned before server materialization. */
export type ProblemResult<
	Definition extends ProblemDefinition = ProblemDefinition,
	Body extends ProblemBody<Definition> = ProblemBody<Definition>,
	Headers extends ProblemHeaders = ProblemHeaders,
> = readonly [body: Body, status: Definition['status'], headers: Headers];

/** JSON-safe problem documentation projection. */
export interface ProblemDocument {
	/** Authored name of this entry or example in its containing catalog. */
	readonly key?: string;
	/** Stable declaration identity used for exact lookup and diagnostic correlation. */
	readonly id: string;
	/** RFC 9457 problem type URI retained by the definition. */
	readonly type: string;
	/** HTTP status selected by this response or reported by this lifecycle observation. */
	readonly status: ProblemStatus;
	/** Stable short title for this problem type. */
	readonly title: string;
	/** Purpose and behavior of this contract, supplied by its author. */
	readonly description: string;
	/** Caller-facing action that may resolve this problem, when one is known. */
	readonly remediation?: string;
	/** External reference for this problem type. */
	readonly externalDocumentation?: string;
	/** Declared retry guidance; the caller or runtime still owns actual retry scheduling. */
	readonly retry: ProblemRetryPolicy;
	/** Diagnostic severity assigned to this problem type. */
	readonly severity: ProblemSeverity;
	/** Whether this problem type is public or intended for internal use. */
	readonly exposure: 'public' | 'internal';
	/** Concrete authored examples retained for API documentation. */
	readonly examples: readonly ProblemExample[];
	/** Optional provider metadata retained with this problem type. */
	readonly provider?: ProblemProviderMetadata;
}

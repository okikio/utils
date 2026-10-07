/** Stable issue codes emitted by request wire parsing and sanitation. */
export type RequestIssueCode =
	| 'too-many-headers'
	| 'headers-too-large'
	| 'header-too-large'
	| 'invalid-header'
	| 'too-many-query-parameters'
	| 'query-name-too-large'
	| 'query-value-too-large'
	| 'invalid-parameter'
	| 'cookies-too-large'
	| 'too-many-cookies'
	| 'invalid-cookie'
	| 'duplicate-cookie'
	| 'invalid-authorization'
	| 'unsupported-authorization'
	| 'invalid-content-length'
	| 'body-too-large'
	| 'unsupported-content-type'
	| 'invalid-json'
	| 'invalid-form'
	| 'not-acceptable'
	| 'untrusted-forwarded-header';

/** Structured wire parsing failure. */
export interface RequestIssue {
	/** Stable failure code; callers should branch on this instead of matching explanation text. */
	readonly code: RequestIssueCode;
	/** Human-readable diagnostic explanation; it is not a stable program discriminator. */
	readonly message: string;
	/** Property-key path to the rejected request value, when available. */
	readonly path?: readonly PropertyKey[];
}

/** Error containing one or more transport issues safe for validation reporting. */
export class RequestTransportError extends Error {
	/** Structured validation issues retained for inspection without matching error messages. */
	readonly issues: readonly RequestIssue[];
	/** Retain safe wire issues; an optional cause holds private diagnostics outside validation reporting. */
	constructor(issues: RequestIssue | readonly RequestIssue[], options?: ErrorOptions) {
		const values = Array.isArray(issues) ? issues : [issues];
		super(values.map((value) => value.message).join('; '), options);
		this.name = 'RequestTransportError';
		this.issues = Object.freeze(values.map((value) => Object.freeze({ ...value })));
	}
}

/** Bounded defaults for generic Web request parsing. */
export interface RequestParsingLimits {
	/** Maximum request header fields admitted by wire parsing. */
	readonly maximumHeaders: number;
	/** Maximum aggregate request-header byte budget. */
	readonly maximumHeaderBytes: number;
	/** Maximum encoded bytes admitted for one header value. */
	readonly maximumHeaderValueBytes: number;
	/** Maximum query parameter occurrences admitted by parsing. */
	readonly maximumQueryParameters: number;
	/** Maximum text length admitted for a query name or value. */
	readonly maximumQueryValueLength: number;
	/** Maximum text length admitted for one path parameter. */
	readonly maximumParameterLength: number;
	/** Maximum encoded Cookie header byte budget. */
	readonly maximumCookieBytes: number;
	/** Maximum cookie occurrences admitted by parsing. */
	readonly maximumCookies: number;
	/** Maximum consumed request-body bytes, including the bounded read after a declared length. */
	readonly maximumBodyBytes: number;
	/** Maximum form field occurrences admitted by parsing. */
	readonly maximumFormFields: number;
}

/** Policy applied when a raw query parameter is present without an equals sign. */
export type BareQueryParameterPolicy = 'flag' | 'empty' | 'reject';

/** Parsing policy and bounded limit overrides accepted by generic request readers. */
export type RequestParsingOptions =
	& Partial<RequestParsingLimits>
	& Readonly<{
		/** Treat `?flag` as `true`, an empty string, or invalid input. Explicit `?flag=` always stays empty. */
		readonly bareQueryParameters?: BareQueryParameterPolicy;
	}>;

/** One normalized wire value, preserving repeated occurrences when present. */
export type WireValue = string | readonly string[];

/** Normalized wire record used for bounded query, header, and parameter values. */
export type WireRecord = Readonly<Record<string, WireValue>>;

/** One parsed form field value. Files remain explicit rather than being coerced to strings. */
export type FormWireValue = string | File | readonly (string | File)[];

/** Bounded form record preserving repeated text values and uploaded files. */
export type FormWireRecord = Readonly<Record<string, FormWireValue>>;
/** Parsed authorization credential. The secret is revealed only by an explicit call. */
export interface SensitiveCredential {
	/** Reveal the parsed credential explicitly; parsing alone does not authenticate it. */
	reveal(): string;
	/** Return [REDACTED] so ordinary string conversion does not reveal the credential. */
	toString(): '[REDACTED]';
	/** Return the redacted credential marker during JSON serialization. */
	toJSON(): '[REDACTED]';
}

/** Syntax-level Authorization field, not a verified identity. */
export interface ParsedAuthorization {
	/** Authored authorization scheme spelling retained from the header. */
	readonly scheme: string;
	/** Case-normalized authorization scheme used for explicit matching. */
	readonly normalizedScheme: string;
	/** Parsed secret held behind an explicit reveal operation; it is not a verified identity. */
	readonly credential: SensitiveCredential;
}

/** Cookie duplicate handling policy. */
export type DuplicateCookiePolicy = 'reject' | 'first' | 'last' | 'array';

/** Trusted external-origin resolution policy. */
export interface ForwardedHeaderPolicy {
	/** Whether this ingress deliberately trusts forwarded origin fields. */
	readonly trust: boolean;
	/** Whether trusted RFC Forwarded fields may supply external-origin evidence. */
	readonly allowForwarded?: boolean;
	/** Whether trusted X-Forwarded fields may supply external-origin evidence. */
	readonly allowXForwarded?: boolean;
	/** Explicit external host allowlist for trusted origin reconstruction. */
	readonly allowedHosts?: readonly string[];
	/** Explicit HTTP/HTTPS protocol allowlist for trusted origin reconstruction. */
	readonly allowedProtocols?: readonly ('http:' | 'https:')[];
}

/** Parsed media type. */
export interface MediaType {
	/** Top-level component of the parsed media type, such as application. */
	readonly type: string;
	/** Subtype component of the parsed media type. */
	readonly subtype: string;
	/** Named media-type parameters retained after syntax parsing. */
	readonly parameters: Readonly<Record<string, string>>;
	/** Media type and subtype without parameters, suitable for content-type matching. */
	readonly essence: string;
}

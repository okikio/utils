/**
 * HTTP status-code contracts and status-family schemas.
 *
 * The module keeps protocol status vocabulary independent from response construction so callers can validate status policy without creating a Response.
 */
import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@standard-schema/spec';

/** Informational HTTP status codes currently registered by IANA. */
export type InformationalStatus = 100 | 101 | 102 | 103 | 104;
/** Successful HTTP status codes. */
export type SuccessStatus = 200 | 201 | 202 | 203 | 204 | 205 | 206 | 207 | 208 | 226;
/** Redirect HTTP status codes, including deprecated 305/306 for recognition. */
export type RedirectStatus = 300 | 301 | 302 | 303 | 304 | 305 | 306 | 307 | 308;
/** Standard client-error HTTP status codes. */
export type ClientErrorStatus =
	| 400
	| 401
	| 402
	| 403
	| 404
	| 405
	| 406
	| 407
	| 408
	| 409
	| 410
	| 411
	| 412
	| 413
	| 414
	| 415
	| 416
	| 417
	| 418
	| 421
	| 422
	| 423
	| 424
	| 425
	| 426
	| 428
	| 429
	| 431
	| 451;
/** Standard server-error HTTP status codes. */
export type ServerErrorStatus = 500 | 501 | 502 | 503 | 504 | 505 | 506 | 507 | 508 | 510 | 511;
/** Every standard final/interim status recognized by the utility. */
export type HttpStatus = InformationalStatus | SuccessStatus | RedirectStatus | ClientErrorStatus | ServerErrorStatus;
/** Statuses valid for RFC problem responses. */
export type ProblemStatus = ClientErrorStatus | ServerErrorStatus;
/** Statuses whose semantics prohibit a message body. */
export type ContentlessStatus = 101 | 204 | 205 | 304;
/** Recognized statuses that may carry a representation. */
export type ContentfulStatus = Exclude<HttpStatus, ContentlessStatus>;

/** Standard Schema plus JSON Schema projection for an HTTP status subset. */
export type HttpStatusSchema<Status extends number = HttpStatus> =
	& StandardSchemaV1<unknown, Status>
	& StandardJSONSchemaV1<unknown, Status>
	& Readonly<{
		readonly values: readonly Status[];
		is(value: unknown): value is Status;
	}>;

// 104 Upload Resumption Supported is a temporary IANA registration that expires 2026-11-13 unless extended or made permanent.
const informationalValues = [100, 101, 102, 103, 104] as const;
const successValues = [200, 201, 202, 203, 204, 205, 206, 207, 208, 226] as const;
const redirectValues = [300, 301, 302, 303, 304, 305, 306, 307, 308] as const;
const clientErrorValues = [
	400,
	401,
	402,
	403,
	404,
	405,
	406,
	407,
	408,
	409,
	410,
	411,
	412,
	413,
	414,
	415,
	416,
	417,
	418,
	421,
	422,
	423,
	424,
	425,
	426,
	428,
	429,
	431,
	451,
] as const;
const serverErrorValues = [500, 501, 502, 503, 504, 505, 506, 507, 508, 510, 511] as const;
const contentlessValues = [101, 204, 205, 304] as const;

/** Informational status schema. */
export const informational: HttpStatusSchema<100 | 101 | 102 | 103 | 104> = createStatusSchema(informationalValues);
/** Successful status schema. */
export const success: HttpStatusSchema<200 | 201 | 202 | 203 | 204 | 205 | 206 | 207 | 208 | 226> = createStatusSchema(
	successValues,
);
/** Redirect status schema. */
export const redirect: HttpStatusSchema<300 | 301 | 302 | 303 | 304 | 307 | 308 | 305 | 306> = createStatusSchema(
	redirectValues,
);
/** Client-error status schema. */
export const clientError: HttpStatusSchema<
	| 400
	| 401
	| 402
	| 403
	| 404
	| 405
	| 406
	| 407
	| 408
	| 409
	| 410
	| 411
	| 412
	| 413
	| 414
	| 415
	| 416
	| 417
	| 418
	| 421
	| 422
	| 423
	| 424
	| 425
	| 426
	| 428
	| 429
	| 431
	| 451
> = createStatusSchema(clientErrorValues);
/** Server-error status schema. */
export const serverError: HttpStatusSchema<500 | 501 | 502 | 503 | 504 | 505 | 506 | 507 | 508 | 510 | 511> =
	createStatusSchema(serverErrorValues);
/** RFC problem status schema. */
export const problem: HttpStatusSchema<
	| 400
	| 401
	| 402
	| 403
	| 404
	| 405
	| 406
	| 407
	| 408
	| 409
	| 410
	| 411
	| 412
	| 413
	| 414
	| 415
	| 416
	| 417
	| 418
	| 421
	| 422
	| 423
	| 424
	| 425
	| 426
	| 428
	| 429
	| 431
	| 451
	| 500
	| 501
	| 502
	| 503
	| 504
	| 505
	| 506
	| 507
	| 508
	| 510
	| 511
> = createStatusSchema([...clientErrorValues, ...serverErrorValues] as const);
/** Contentless status schema. */
export const contentless: HttpStatusSchema<204 | 205 | 304 | 101> = createStatusSchema(contentlessValues);
/** Contentful status schema. */
export const contentful: HttpStatusSchema<ContentfulStatus> = createStatusSchema(
	[...informationalValues, ...successValues, ...redirectValues, ...clientErrorValues, ...serverErrorValues]
		.filter((value) => !contentlessValues.includes(value as ContentlessStatus)) as ContentfulStatus[],
);
/** All recognized HTTP statuses. */
export const any: HttpStatusSchema<
	| 200
	| 201
	| 202
	| 203
	| 204
	| 205
	| 206
	| 207
	| 208
	| 226
	| 300
	| 301
	| 302
	| 303
	| 304
	| 307
	| 308
	| 100
	| 101
	| 102
	| 103
	| 104
	| 305
	| 306
	| 400
	| 401
	| 402
	| 403
	| 404
	| 405
	| 406
	| 407
	| 408
	| 409
	| 410
	| 411
	| 412
	| 413
	| 414
	| 415
	| 416
	| 417
	| 418
	| 421
	| 422
	| 423
	| 424
	| 425
	| 426
	| 428
	| 429
	| 431
	| 451
	| 500
	| 501
	| 502
	| 503
	| 504
	| 505
	| 506
	| 507
	| 508
	| 510
	| 511
> = createStatusSchema(
	[
		...informationalValues,
		...successValues,
		...redirectValues,
		...clientErrorValues,
		...serverErrorValues,
	] as const,
);

/** Return whether a value is any recognized HTTP status. */
export function is(value: unknown): value is HttpStatus {
	return any.is(value);
}

/** Return whether a value is valid for an RFC problem response. */
export function isProblem(value: unknown): value is ProblemStatus {
	return problem.is(value);
}

/** Return whether the status semantics prohibit a message body. */
export function isContentless(value: unknown): value is ContentlessStatus {
	return contentless.is(value);
}

/**
 * Create a Standard Schema validator for an explicit set of recognized status codes.
 *
 * The copied frozen values document the allowed set. A private Set serves
 * membership checks, and non-integers fail even if coercion could produce a code.
 *
 * @internal
 */
function createStatusSchema<const Values extends readonly number[]>(values: Values): HttpStatusSchema<Values[number]> {
	const frozen = Object.freeze([...new Set(values)]) as readonly Values[number][];
	const allowed = new Set<number>(frozen);
	return Object.freeze({
		values: frozen,
		'~standard': Object.freeze({
			version: 1 as const,
			vendor: 'utils-http-status',
			/**
			 * Return a Standard Schema issue for any non-integer or unlisted status.
			 * No string-to-number coercion is applied.
			 */
			validate(value: unknown) {
				return typeof value === 'number' && Number.isInteger(value) && allowed.has(value)
					? { value: value as Values[number] }
					: { issues: [{ message: `Expected one of the supported HTTP statuses: ${frozen.join(', ')}.` }] };
			},
			jsonSchema: Object.freeze({
				input: () => Object.freeze({ type: 'integer' as const, enum: frozen }),
				output: () => Object.freeze({ type: 'integer' as const, enum: frozen }),
			}),
		}),
		/**
		 * Narrow an unknown value by exact numeric membership in this status set.
		 */
		is(value: unknown): value is Values[number] {
			return typeof value === 'number' && Number.isInteger(value) && allowed.has(value);
		},
	});
}

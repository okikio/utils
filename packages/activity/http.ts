/**
 * Authenticated unary HTTP activity transport.
 *
 * The application owns the listener, credentials, authorization, resources and
 * durable claim authority. This transport does not retry or invent a Scheduler
 * heartbeat acknowledgement. The http/duplex subpath adds paired-request reverse calls.
 *
 * @module
 */
import * as context from '@okikio/context';
import type { Context } from '@okikio/context';
import * as schema from '@okikio/schema';
import * as json from '@okikio/streams/json';
import type {
	ActivityAttemptControl,
	ActivityAttemptResultType,
	ActivityAttemptType,
	EngineProvider,
} from '@okikio/workflow';
import type { ActivityDefinition } from './types.ts';
import type { EngineDefinition } from './engine.ts';
import * as remote from './remote.ts';
import * as transport from './transport.ts';

/** Options shared by both ends of the bounded unary protocol. */
export interface Limits {
	/** Maximum UTF-8 bytes per request or response; default 1 MiB, maximum 16 MiB. */
	readonly maximumBytes?: number;
}

/** Credentials are obtained for each request so the application can rotate them. */
export interface ClientOptions extends Limits {
	/** Exact activity engine represented by the remote service. */
	readonly engine: EngineDefinition;
	/** Exact definitions used to validate remote results. */
	readonly activities: readonly ActivityDefinition[];
	/** HTTPS endpoint; redirects are rejected to prevent forwarding credentials. */
	readonly url: string | URL;
	/** Return request credentials; never persisted in attempt envelopes. */
	readonly headers: (attempt: ActivityAttemptType) => HeadersInit | Promise<HeadersInit>;
	/** Permit plain HTTP only on localhost or loopback addresses for local deployments. */
	readonly allowLoopbackHttp?: boolean;
}

/** Admission and authority belong to the receiving application. */
export interface HandlerOptions extends Limits {
	/** Borrowed provider; the handler never disposes it or its resources. */
	readonly provider: EngineProvider;
	/** Exact definitions advertised by that provider. */
	readonly activities: readonly ActivityDefinition[];
	/** Authenticate credentials before reading the body or reserving execution capacity. */
	readonly authenticate: (request: Request) => boolean | Promise<boolean>;
	/** Authorize this exact fenced attempt after authentication and structural validation. */
	readonly authorize: (request: Request, attempt: ActivityAttemptType) => boolean | Promise<boolean>;
	/** Maximum active request bodies and attempts; default 16. Excess requests receive 503. */
	readonly concurrency?: number;
	/**
	 * Resolve the authoritative services for this exact attempt. Omit only for
	 * activities that never heartbeat or emit/check attempt-owned services. The
	 * fallback heartbeat throws: a local acknowledgement cannot renew a remote lease.
	 */
	readonly control?: (attempt: ActivityAttemptType) => ActivityAttemptControl | Promise<ActivityAttemptControl>;
}

/** An HTTP failure with no proof that a remote side effect did or did not commit. */
export class HttpActivityError extends Error {
	/** HTTP status, when a response was received. */
	readonly status?: number;
	/** Create safe transport diagnostics without retaining credentials or response bodies. */
	constructor(message: string, status?: number) {
		super(message);
		this.name = 'HttpActivityError';
		this.status = status;
	}
}

/** Create an inert client. A failed request is `lost`, never an automatic retry. */
export function create(options: ClientOptions): EngineProvider {
	remote.engine(options.engine, 'HTTP provider');
	const definitions = remote.definitions(options.activities, 'HTTP provider');
	const maximum = limit(options.maximumBytes, 1_048_576, 16_777_216);
	const url = new URL(options.url);
	const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
	if (
		url.username || url.password ||
		(url.protocol !== 'https:' && !(options.allowLoopbackHttp && loopback && url.protocol === 'http:'))
	) {
		throw new TypeError('HTTP activity endpoint requires HTTPS without URL credentials, or explicit loopback HTTP.');
	}
	return Object.freeze({
		activities: Object.freeze([...definitions.values()]),
		async run(
			ctx: Context,
			attempt: ActivityAttemptType,
			_control: ActivityAttemptControl,
		): Promise<ActivityAttemptResultType> {
			if (attempt.location?.host) {
				return { type: 'lost', reason: new HttpActivityError('HTTP provider does not select physical hosts.') };
			}
			if (ctx.signal.aborted) return { type: 'cancelled', reason: ctx.signal.reason };
			const definition = remote.definition(
				definitions,
				options.engine,
				attempt,
				(id, version) => new TypeError(`Unknown HTTP activity ${id}@${version}.`),
			);
			try {
				const body = json.encode(attempt, maximum);
				const headers = new Headers(await options.headers(attempt));
				headers.set('content-type', 'application/json');
				headers.set('x-okikio-activity-version', '1');
				const response = await fetch(url, {
					method: 'POST',
					body: new Uint8Array(body),
					headers,
					signal: ctx.signal,
					redirect: 'error',
				});
				if (!response.ok) {
					await response.body?.cancel();
					throw new HttpActivityError('HTTP activity service rejected the request.', response.status);
				}
				if (response.headers.get('x-okikio-activity-version') !== '1') {
					await response.body?.cancel();
					throw new HttpActivityError('Unsupported HTTP activity protocol.');
				}
				return await transport.result(
					definition,
					await schema.parse(transport.ResultSchema, await read(response.body, maximum, ctx.signal)),
				);
			} catch (error) {
				// Cancellation stops waiting. It is not evidence that remote cleanup or a side effect finished.
				return { type: 'lost', reason: error };
			}
		},
	});
}

/**
 * Create a Fetch handler without opening a listener. Mount it at one dedicated
 * route. Authentication errors are safe 500 responses, never bypasses. Capacity
 * remains reserved until provider execution and Context disposal finish.
 */
export function handler(options: HandlerOptions): (request: Request) => Promise<Response> {
	const maximum = limit(options.maximumBytes, 1_048_576, 16_777_216);
	const concurrency = limit(options.concurrency, 16, 10_000);
	const definitions = remote.definitions(options.activities, 'HTTP handler');
	// Count body readers as well as running attempts, so slow uploads consume admission.
	let active = 0;
	return async (request) => {
		if (request.method !== 'POST') return response(405);
		try {
			if (!await options.authenticate(request)) return response(401);
		} catch {
			return response(500);
		}
		if (active >= concurrency) return response(503);
		active++;
		try {
			if (
				request.headers.get('x-okikio-activity-version') !== '1' ||
				request.headers.get('content-type')?.split(';')[0] !== 'application/json'
			) return response(415);
			let attempt: ActivityAttemptType;
			try {
				attempt = await schema.parse(transport.AttemptSchema, await read(request.body, maximum, request.signal));
			} catch (error) {
				return response(error instanceof RangeError ? 413 : 400);
			}
			// The envelope's admitted flag comes from a trusted Scheduler only after this policy accepts it.
			if (!await options.authorize(request, attempt)) return response(403);
			const definition = definitions.get(remote.identity(attempt.activityId, attempt.activityVersion));
			if (!definition) return response(404);
			await using ctx = context.restore(attempt.context, { signal: request.signal });
			const control = options.control ? await options.control(attempt) : {
				async heartbeat(): Promise<void> {
					throw new HttpActivityError('HTTP heartbeat requires authoritative control.');
				},
			};
			const value = await transport.wire(definition, await options.provider.run(ctx, attempt, control));
			let body: Uint8Array;
			try {
				body = json.encode(value, maximum);
			} catch {
				return response(507);
			}
			return new Response(new Uint8Array(body), {
				headers: { 'content-type': 'application/json', 'x-okikio-activity-version': '1', 'cache-control': 'no-store' },
			});
		} catch {
			return response(500);
		} finally {
			active--;
		}
	};
}

/** Validate finite bounds once, before any request can acquire resources. */
function limit(value: number | undefined, fallback: number, maximum: number): number {
	const selected = value ?? fallback;
	if (!Number.isSafeInteger(selected) || selected < 1 || selected > maximum) {
		throw new TypeError(`Expected a positive integer no greater than ${maximum}.`);
	}
	return selected;
}

/** Reuse the Streams package's bounded JSON reader; no second parser lives here. */
async function read(body: ReadableStream<Uint8Array> | null, maximum: number, signal: AbortSignal): Promise<unknown> {
	if (!body) throw new TypeError('Missing JSON body.');
	return await json.read(body, maximum, signal);
}

/** Keep public errors body-free so application diagnostics cannot leak credentials or payloads. */
function response(status: number): Response {
	return new Response(null, { status, headers: { 'cache-control': 'no-store' } });
}

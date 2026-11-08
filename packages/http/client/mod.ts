/** Bounded Fetch transport with explicit credentials, deadlines and response ownership. @module */
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { readText } from '../response/body.ts';
import { ownBody } from './body.ts';
import { discard } from '../response/discard.ts';

/** A transport failure before a usable HTTP response, without credential values. */
export class ClientTransportError extends Error {
	constructor(message = 'The service could not be reached.', options?: ErrorOptions) {
		super(message, options);
		this.name = 'ClientTransportError';
	}
}

/** A response or request that does not satisfy its declared wire contract. */
export class ClientContractError extends Error {
	/** Number of schema issues without retaining credential-bearing payloads. */
	readonly issueCount: number;
	constructor(issueCount: number, message = 'The service response did not satisfy its contract.') {
		super(message);
		this.name = 'ClientContractError';
		this.issueCount = issueCount;
	}
}

/** Safe RFC 9457 details retained for application policy and diagnostics. */
export interface ClientProblem {
	readonly type?: string;
	readonly title?: string;
	readonly detail?: string;
	readonly instance?: string;
}

/** An HTTP failure is distinct from cancellation, transport failure, and invalid payloads. */
export class ClientResponseError extends Error {
	readonly status: number;
	readonly requestId?: string;
	readonly problemType?: string;
	readonly retryAfterMs?: number;
	readonly problem?: ClientProblem;
	constructor(response: Response, problem?: ClientProblem) {
		super(problem?.detail ?? problem?.title ?? `Service request failed with HTTP ${response.status}.`);
		this.name = 'ClientResponseError';
		this.status = response.status;
		this.requestId = response.headers.get('x-request-id') ?? undefined;
		this.problem = problem;
		this.problemType = problem?.type;
		this.retryAfterMs = retryAfterMilliseconds(response.headers.get('retry-after'));
	}
}

/** HTTP request mechanics; domain schemas, tenant constraints, and retries belong to callers. */
export interface ClientRequest {
	/** Same-origin absolute path with optional query; fragments and network-path URLs are rejected. */
	readonly path: string;
	readonly method: string;
	readonly headers?: HeadersInit;
	/** Bytes or a readable byte stream. The transport consumes this body once. */
	readonly body?: BodyInit;
	/** Caller cancellation. An aborted request rejects with this signal's original reason. */
	readonly signal?: AbortSignal;
}

/** A client instance has one explicitly supplied deployment and credential boundary. */
export interface HttpClientOptions {
	/** Empty for same-origin browser requests; absolute HTTP(S) origin for SSR. */
	readonly origin?: string;
	/** Owner-supplied credentials and headers. Per-call headers cannot replace these values. */
	readonly headers?: HeadersInit;
	/** Fetch cookie policy. Defaults to same-origin. */
	readonly credentials?: RequestCredentials;
	/** Total timeout in milliseconds. Defaults to 15,000; remains active through decoding or streamed delivery. */
	readonly timeoutMs?: number;
	/** Maximum bytes read by the bounded response decoders. Defaults to 8 MiB. */
	readonly maximumResponseBytes?: number;
	/** Fetch implementation supplied by the host. Defaults to globalThis.fetch. */
	readonly fetch?: typeof globalThis.fetch;
}

/** HTTP operations with explicit credentials, response limits and cancellation. */
export interface HttpClient {
	/** Response byte limit configured at client creation. Streaming success bodies are not buffered. */
	readonly maximumResponseBytes: number;
	/** Decode within the total timeout. Cancellation stops waiting even if the decoder is still pending. */
	request<Value>(
		input: ClientRequest,
		read: (response: Response, signal: AbortSignal) => Promise<Value>,
	): Promise<Value>;
	/** Return headers and transfer the body to the caller. The client deadline and caller linkage end here. */
	fetch(input: ClientRequest): Promise<Response>;
	/** Keep the deadline and caller cancellation active until the returned body ends, fails or is cancelled. */
	stream(input: ClientRequest): Promise<Response>;
}

/** Construct a small, framework-neutral HTTP client without discovering configuration or credentials. */
export function create(options: HttpClientOptions = {}): HttpClient {
	const origin = options.origin ?? '';
	if (origin !== '') {
		const url = new URL(origin);
		if (
			!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' ||
			url.search || url.hash
		) {
			throw new TypeError('Client origin must be an HTTP(S) origin without credentials or a path.');
		}
	}
	const timeoutMs = options.timeoutMs ?? 15_000;
	const maximumResponseBytes = options.maximumResponseBytes ?? 8 * 1024 * 1024;
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) {
		throw new RangeError('Client timeoutMs must be a positive timer-sized integer.');
	}
	if (!Number.isSafeInteger(maximumResponseBytes) || maximumResponseBytes < 0) {
		throw new RangeError('Client maximumResponseBytes must be a non-negative safe integer.');
	}
	const authentication = new Headers(options.headers);
	const fetch = options.fetch ?? globalThis.fetch;
	/** Start a transport whose caller must finish or transfer its cancellation and timer ownership. */
	async function send(input: ClientRequest) {
		if (
			!input.path.startsWith('/') || input.path.startsWith('//') || input.path.includes('\\') ||
			input.path.includes('#')
		) {
			throw new TypeError('Client requests require a same-origin absolute path without a fragment.');
		}
		const headers = new Headers(authentication);
		for (const [name, value] of new Headers(input.headers)) {
			if (
				['authorization', 'cookie', 'x-api-key'].includes(name) && authentication.has(name) &&
				authentication.get(name) !== value
			) {
				throw new TypeError('Request headers cannot replace client authentication.');
			}
			headers.set(name, value);
		}
		input.signal?.throwIfAborted();
		const controller = new AbortController();
		const abort = () => controller.abort(input.signal?.reason);
		input.signal?.addEventListener('abort', abort, { once: true });
		const timeout = setTimeout(
			() => controller.abort(new DOMException('Service request timed out.', 'TimeoutError')),
			timeoutMs,
		);
		/** Remove caller linkage and the timer; a supplied failure also cancels transport I/O. */
		function finish(reason?: unknown): void {
			clearTimeout(timeout);
			input.signal?.removeEventListener('abort', abort);
			if (reason !== undefined) controller.abort(reason);
		}
		// A response can arrive after cancellation. Keep it available for disposal
		// even if cancellation wins the promise race at the same time.
		let received: Response | undefined;
		try {
			let response: Response;
			try {
				const pending = fetch(`${origin.replace(/\/$/u, '')}${input.path}`, {
					method: input.method,
					headers,
					body: input.body,
					...(input.body instanceof ReadableStream ? { duplex: 'half' as const } : {}),
					credentials: options.credentials ?? 'same-origin',
					redirect: 'manual',
					signal: controller.signal,
				}).then((value) => {
					received = value;
					if (controller.signal.aborted) void discard(value, controller.signal.reason);
					return value;
				});
				response = await readWithSignal(pending, controller.signal);
			} catch (cause) {
				if (controller.signal.aborted) throw controller.signal.reason;
				throw new ClientTransportError(undefined, { cause });
			}
			controller.signal.throwIfAborted();
			return { response, signal: controller.signal, finish };
		} catch (cause) {
			const error = controller.signal.aborted ? controller.signal.reason : cause;
			finish(error);
			if (received) await discard(received, error);
			throw error;
		}
	}
	async function request<Value>(
		input: ClientRequest,
		read: (response: Response, signal: AbortSignal) => Promise<Value>,
	): Promise<Value> {
		const operation = await send(input);
		try {
			const value = await readWithSignal(read(operation.response, operation.signal), operation.signal);
			operation.signal.throwIfAborted();
			return value;
		} catch (cause) {
			if (operation.signal.aborted) throw operation.signal.reason;
			throw cause;
		} finally {
			operation.finish();
		}
	}
	return Object.freeze({
		maximumResponseBytes,
		request,
		fetch: (input: ClientRequest) => request(input, async (response) => response),
		async stream(input: ClientRequest) {
			const operation = await send(input);
			if (!operation.response.body) {
				operation.finish();
				return operation.response;
			}
			return new Response(ownBody(operation.response.body, operation.signal, operation.finish), {
				status: operation.response.status,
				statusText: operation.response.statusText,
				headers: operation.response.headers,
			});
		},
	});
}

/**
 * Stop waiting when decoding finishes or the request is canceled.
 *
 * A schema decoder can finish after cancellation because it has no cancellation
 * input. Observe its later result to prevent an unhandled rejection. The body
 * reader owns stream cleanup. This observer removes its abort listener after
 * the first result.
 */
function readWithSignal<Value>(pending: Promise<Value>, signal: AbortSignal): Promise<Value> {
	return new Promise((resolve, reject) => {
		let settled = false;
		const finish = (callback: () => void): void => {
			if (settled) return;
			settled = true;
			signal.removeEventListener('abort', abort);
			callback();
		};
		const abort = (): void => finish(() => reject(signal.reason));
		pending.then(
			(value) => finish(() => resolve(value)),
			(cause) => finish(() => reject(cause)),
		);
		signal.addEventListener('abort', abort, { once: true });
		if (signal.aborted) abort();
	});
}

/** Read a bounded JSON success; hostile error payloads never turn an HTTP failure into a success. */
export async function json(response: Response, maximumBytes: number, signal?: AbortSignal): Promise<unknown> {
	let text: string;
	try {
		text = await readText(response, maximumBytes, signal);
	} catch (cause) {
		signal?.throwIfAborted();
		if (!response.ok) throw new ClientResponseError(response);
		if (cause instanceof RangeError) throw new ClientContractError(1, 'The service response exceeded the body limit.');
		throw cause;
	}
	let value: unknown;
	try {
		value = text === '' ? undefined : JSON.parse(text);
	} catch {
		if (!response.ok) throw new ClientResponseError(response);
		throw new ClientContractError(1, 'The service returned invalid JSON.');
	}
	if (!response.ok) throw new ClientResponseError(response, parseProblem(value, response.status));
	const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
	if (text !== '' && contentType !== 'application/json' && !contentType?.endsWith('+json')) {
		throw new ClientContractError(1, 'The service returned an unexpected content type.');
	}
	return value;
}

/** Validator-neutral decoding; application adapters can explicitly supply response-only compatibility policy. */
export async function validate<Schema extends StandardSchemaV1>(
	schema: Schema,
	value: unknown,
): Promise<StandardSchemaV1.InferOutput<Schema>> {
	const result = await schema['~standard'].validate(value);
	if (result.issues) throw new ClientContractError(result.issues.length);
	return result.value;
}

/** Retain only bounded RFC 9457 strings and require its status to match the wire status. */
function parseProblem(value: unknown, status: number): ClientProblem | undefined {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
	const input = value as Record<string, unknown>;
	if (input.status !== undefined && input.status !== status) return undefined;
	const output: Record<string, string> = {};
	for (const name of ['type', 'title', 'detail', 'instance']) {
		if (input[name] !== undefined && (typeof input[name] !== 'string' || input[name].length > 4096)) return undefined;
		if (typeof input[name] === 'string') output[name] = input[name];
	}
	return Object.freeze(output);
}

/** Interpret standard Retry-After delta seconds or an HTTP date without automatic retries. */
function retryAfterMilliseconds(value: string | null, now = Date.now()): number | undefined {
	if (value === null) return undefined;
	if (/^\d+$/u.test(value)) {
		const delay = Number(value) * 1000;
		return Number.isSafeInteger(delay) ? delay : undefined;
	}
	const date = Date.parse(value);
	return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

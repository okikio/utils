/** Static contracts and explicit protocol doubles; scenarios own all live resources. @module */
import * as codecs from '@okikio/schema/codec';
import * as schemaCore from '@okikio/schema';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import * as context from '@okikio/context';
import * as worker from '../mod.ts';
import type { RawWorker } from '../types.ts';

export function schema<Value>(
	check: (value: unknown) => value is Value,
	message: string,
): StandardSchemaV1<unknown, Value> {
	return schemaCore.guard(check, message);
}

export const RequestSchema = schema(
	(value): value is Readonly<{ readonly value: string }> =>
		typeof value === 'object' && value !== null && typeof (value as { value?: unknown }).value === 'string',
	'Expected a request value.',
);

export const ResponseSchema = schema(
	(value): value is Readonly<{ readonly upper: string }> =>
		typeof value === 'object' && value !== null && typeof (value as { upper?: unknown }).upper === 'string',
	'Expected an uppercase response.',
);

/**
 * Expose submitted frames and synchronous native events to each scenario.
 * This double never launches a thread; native-host suites test physical execution.
 */
export class FakeWorker implements RawWorker {
	/** Retain frame identity and transfer intent for protocol assertions. */
	readonly posted: Array<Readonly<{ readonly message: unknown; readonly transfer?: readonly Transferable[] }>> = [];
	/** Deliver only the listeners currently owned by the real protocol client. */
	readonly listeners = {
		message: new Set<(event: MessageEvent<unknown>) => void>(),
		error: new Set<(event: ErrorEvent) => void>(),
		messageerror: new Set<(event: MessageEvent<unknown>) => void>(),
	};
	/** Test-owned observers wait for request submission instead of guessing event-loop turns. */
	readonly #postWaiters = new Set<() => void>();
	/** Count physical termination requests separately from cooperative shutdown frames. */
	terminated = 0;
	onPost?: (message: unknown) => void;

	postMessage(message: unknown, transfer?: readonly Transferable[]): void {
		this.posted.push(Object.freeze({ message, ...(transfer === undefined ? {} : { transfer }) }));
		for (const resolve of this.#postWaiters) resolve();
		this.#postWaiters.clear();
		this.onPost?.(message);
	}

	/** Wait until the parent sent the requested number of protocol frames. */
	async waitForPosts(count: number): Promise<void> {
		while (this.posted.length < count) {
			await new Promise<void>((resolve) => this.#postWaiters.add(resolve));
		}
	}

	terminate(): void {
		this.terminated += 1;
	}

	addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
	addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
	addEventListener(type: 'messageerror', listener: (event: MessageEvent<unknown>) => void): void;
	addEventListener(
		type: keyof FakeWorker['listeners'],
		listener: ((event: MessageEvent<unknown>) => void) | ((event: ErrorEvent) => void),
	): void {
		(this.listeners[type] as Set<typeof listener>).add(listener);
	}

	removeEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
	removeEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
	removeEventListener(type: 'messageerror', listener: (event: MessageEvent<unknown>) => void): void;
	removeEventListener(
		type: keyof FakeWorker['listeners'],
		listener: ((event: MessageEvent<unknown>) => void) | ((event: ErrorEvent) => void),
	): void {
		(this.listeners[type] as Set<typeof listener>).delete(listener);
	}

	message(data: unknown): void {
		for (const listener of this.listeners.message) listener(new MessageEvent('message', { data }));
	}

	error(reason: unknown): void {
		for (const listener of this.listeners.error) {
			listener(new ErrorEvent('error', { error: reason, message: String(reason) }));
		}
	}
}

/** Open the real protocol client on a deterministic fake host; these tests control frames rather than launching an OS worker. */
export function open(fake: FakeWorker, ctx: context.Context, requestId = 'request-1') {
	return worker.open(ctx, {
		module: new URL('file:///analysis-thread.ts'),
		id: 'analysis-thread-1',
		requestId: () => requestId,
		protocol: worker.protocol({ request: RequestSchema, response: ResponseSchema }),
		create: () => fake,
		shutdownMs: 10,
	});
}

/** Refuse a malformed fixture frame rather than inventing a correlation identity. */
export function requestId(message: unknown): string {
	if (typeof message !== 'object' || message === null || !('id' in message) || typeof message.id !== 'string') {
		throw new TypeError('Expected a request envelope.');
	}
	return message.id;
}

/** Server-side frame surface; each test pairs it explicitly with its client or supplies messages directly. */
export class FakeWorkerScope implements worker.RawWorkerScope {
	readonly posted: Array<Readonly<{ readonly message: unknown; readonly transfer?: readonly Transferable[] }>> = [];
	readonly listeners = {
		message: new Set<(event: MessageEvent<unknown>) => void>(),
		messageerror: new Set<(event: MessageEvent<unknown>) => void>(),
	};
	/** Test-owned observers wait for protocol output instead of guessing event-loop turns. */
	readonly #postWaiters = new Set<() => void>();

	postMessage(message: unknown, transfer?: readonly Transferable[]): void {
		this.posted.push(Object.freeze({ message, ...(transfer === undefined ? {} : { transfer }) }));
		for (const resolve of this.#postWaiters) resolve();
		this.#postWaiters.clear();
	}

	/** Wait until the worker produced the requested number of protocol frames. */
	async waitForPosts(count: number): Promise<void> {
		while (this.posted.length < count) {
			await new Promise<void>((resolve) => this.#postWaiters.add(resolve));
		}
	}

	addEventListener(type: 'message' | 'messageerror', listener: (event: MessageEvent<unknown>) => void): void {
		this.listeners[type].add(listener);
	}

	removeEventListener(type: 'message' | 'messageerror', listener: (event: MessageEvent<unknown>) => void): void {
		this.listeners[type].delete(listener);
	}

	message(data: unknown): void {
		for (const listener of this.listeners.message) listener(new MessageEvent('message', { data }));
	}
}

export const NoticeSchema = schema(
	(value): value is Readonly<{ readonly phase: string }> =>
		typeof value === 'object' && value !== null && typeof (value as { phase?: unknown }).phase === 'string',
	'Expected a notice phase.',
);

export const CallRequestSchema = schema(
	(value): value is Readonly<{ readonly permission: string }> =>
		typeof value === 'object' && value !== null && typeof (value as { permission?: unknown }).permission === 'string',
	'Expected a permission request.',
);

export const CallResponseSchema = schema(
	(value): value is Readonly<{ readonly allowed: boolean }> =>
		typeof value === 'object' && value !== null && typeof (value as { allowed?: unknown }).allowed === 'boolean',
	'Expected a permission decision.',
);

/** Hold the first validation until a test chooses the ordering of control frames. */
export function admission() {
	const entered = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	let validations = 0;
	const contract: StandardSchemaV1<unknown, Readonly<{ value: string }>> = {
		'~standard': {
			version: 1,
			vendor: 'test-admission',
			async validate(value) {
				if (validations++ === 0) {
					entered.resolve();
					await release.promise;
				}
				return { value: value as Readonly<{ value: string }> };
			},
		},
	};
	return { contract: codecs.identity(contract), entered: entered.promise, release };
}

export const admissionContext = { id: 'admission', startedAt: '2026-01-01T00:00:00Z' };

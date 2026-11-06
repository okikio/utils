/** Browser-owned attempt controls used unchanged by the container tests and timings. @module */
import '@okikio/dispose/polyfill';
import '@okikio/duration/polyfill';
import * as context from '@okikio/context';
import * as duplex from '@okikio/activity/http/duplex';
import type { ActivityAttemptControl, ActivityAttemptResultType } from '@okikio/workflow';
import { attempt, Engine, Work } from '../fixtures/duplex/contracts.ts';
import type { InputType } from '../fixtures/duplex/contracts.ts';

/** One invocation borrows the test endpoint and its deliberately disposable credential. */
export interface Options {
	/** Dedicated loopback route exposed by the owned container. */
	readonly url: string;
	/** Per-run fixture credential; never a durable identity or a report field. */
	readonly token: string;
	/** Unique scenario identity and finite workload selected by the test. */
	readonly input: InputType;
}

/** Receipts belong to original browser controls, independently of the remote activity's result. */
export interface Receipt {
	readonly type: ActivityAttemptResultType['type'];
	readonly value?: unknown;
	readonly reason?: string;
	readonly heartbeats: readonly unknown[];
	readonly permissions: readonly unknown[];
	readonly effects: readonly unknown[];
	readonly milliseconds: number;
}

/** Pending browser work keeps its Context until the result and explicit disposal both finish. */
interface Pending {
	/** This document owns cancellation and explicit disposal of its caller scope. */
	readonly ctx: context.Owned;
	/** Completion includes the transport result and caller disposal. */
	readonly result: Promise<Receipt>;
	/** True only after the browser result and its Context disposal have settled. */
	readonly settled: boolean;
}
const pending = new Map<string, Pending>();

/** Construct the real Fetch transport; loopback HTTP is restricted to this local fixture. */
function open(options: Options): Pending {
	const ctx = context.create({ id: options.input.id });
	const heartbeats: unknown[] = [], permissions: unknown[] = [], effects: unknown[] = [];
	const control: ActivityAttemptControl = {
		async heartbeat(value) {
			heartbeats.push(value);
		},
		permission: {
			maximumChecks: 64,
			async check(_ctx, requests) {
				permissions.push(...requests.map((request) => request.target));
				return requests.map(() => ({ allowed: true }));
			},
		},
		effect: {
			async emit(_ctx, value) {
				effects.push(value.value);
			},
		},
	};
	const client = duplex.create({
		engine: Engine,
		activities: [Work],
		url: options.url,
		headers: () => ({ authorization: `Bearer ${options.token}` }),
		allowLoopbackHttp: true,
		timeoutMs: 10_000,
		cleanupMs: 5000,
	});
	const started = performance.now();
	const result = (async (): Promise<Receipt> => {
		try {
			const outcome = await client.run(ctx, attempt(ctx, options.input), control);
			return {
				type: outcome.type,
				...(outcome.type === 'success' ? { value: outcome.value } : {}),
				...('reason' in outcome ? { reason: String(outcome.reason) } : {}),
				heartbeats,
				permissions,
				effects,
				milliseconds: performance.now() - started,
			};
		} finally {
			await ctx[Symbol.asyncDispose]();
		}
	})();
	// Navigation can destroy the document before a test joins this promise. Observe
	// rejection here while retaining the original promise for explicit completion.
	let settled = false;
	void result.then(() => {
		settled = true;
	}, () => {
		settled = true;
	});
	return {
		ctx,
		result,
		get settled() {
			return settled;
		},
	};
}

/** Complete one attempt, including original controls and owned Context disposal. */
export async function run(options: Options): Promise<Receipt> {
	return await open(options).result;
}

/** Start a wait-mode attempt so the host test can observe or destroy its real document. */
export function start(options: Options): void {
	if (pending.has(options.input.id)) throw new Error('This browser already owns the attempt.');
	pending.set(options.input.id, open(options));
}

/** Request cancellation without pretending that the remote provider has already cleaned up. */
export function cancel(id: string): void {
	const value = pending.get(id);
	if (!value) throw new Error('No browser attempt owns this identifier.');
	context.cancel(value.ctx, 'browser cancellation');
}

/** Observe the caller's completion independently of the host's held cleanup resource. */
export function settled(id: string): boolean {
	const value = pending.get(id);
	if (!value) throw new Error('No browser attempt owns this identifier.');
	return value.settled;
}

/** Join the original result after the host test releases the provider's cleanup gate. */
export async function join(id: string): Promise<Receipt> {
	const value = pending.get(id);
	if (!value) throw new Error('No browser attempt owns this identifier.');
	try {
		return await value.result;
	} finally {
		pending.delete(id);
	}
}

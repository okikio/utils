/** Profile compiled service ownership with actual middleware resource borrowing. @module */
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Context } from '@okikio/context';
import { create as createResponse, ok } from '@okikio/http/response';
import { define as definePermission, interpreter, require as requirePermission } from '@okikio/permission';
import { define as defineResource, implement as implementResource, implementations } from '@okikio/resource';
import { get, handler as endpointHandler } from '@okikio/server/endpoint';
import { afterValidation, define as defineMiddleware, handler as middlewareHandler } from '@okikio/server/middleware';
import { compile, create, define, implement, observer } from '@okikio/server/service';

/** Output independently specified for each middleware count. */
interface ServiceProfileObservationType {
	readonly status: number;
	readonly body: { readonly score: number; readonly visits: number };
	readonly permissionChecks: number;
	readonly requestScopeClosed: boolean;
}

/** A serial workload owner. Setup and final owner disposal are outside the measured callback. */
export interface ServiceProfileCaseType {
	readonly id: string;
	readonly scope: string;
	readonly expected: ServiceProfileObservationType;
	readonly open: () => {
		readonly run: () => Promise<ServiceProfileObservationType>;
		readonly close: () => Promise<void>;
	};
}

const ScoreSchema: StandardSchemaV1<unknown, { readonly score: number; readonly visits: number }> = {
	'~standard': {
		version: 1,
		vendor: 'service-profile',
		validate(value) {
			if (
				typeof value !== 'object' || value === null || !('score' in value) || typeof value.score !== 'number' ||
				!('visits' in value) || typeof value.visits !== 'number'
			) return { issues: [{ message: 'Expected numeric score and visits.' }] };
			return { value: { score: value.score, visits: value.visits } };
		},
	},
};

/**
 * Return literal preflight expectations, not outputs derived from the service candidate.
 *
 * The zero case measures the same service response lifecycle without middleware or
 * resources. Other cases borrow one shared value through a three-resource dependency
 * graph. Acquisitions stay cached, but each request still owns its permission checks,
 * context and cleanup. Call run() serially; profiling concurrent traffic is a different
 * workload. These cases do not establish a performance threshold or a Hono comparison.
 */
export function profileServiceCases(): readonly ServiceProfileCaseType[] {
	return [
		serviceCase(0, { status: 200, body: { score: 0, visits: 0 }, permissionChecks: 0, requestScopeClosed: true }),
		serviceCase(4, { status: 200, body: { score: 12, visits: 4 }, permissionChecks: 4, requestScopeClosed: true }),
		serviceCase(16, { status: 200, body: { score: 48, visits: 16 }, permissionChecks: 16, requestScopeClosed: true }),
	];
}

/** Build independent definitions and implementations before any measured request starts. */
function serviceCase(count: number, expected: ServiceProfileObservationType): ServiceProfileCaseType {
	return {
		id: `service-middleware-${count}`,
		scope:
			`Compiled service, ${count} middleware resource borrows with per-use permission checks and response cleanup.`,
		expected,
		open() {
			const Use = definePermission({ id: `profile.${count}.use`, description: 'Borrow the profile store.' });
			const Base = defineResource<{ readonly score: number }>()({
				id: `profile.${count}.base`,
				description: 'Base value for the dependency graph.',
			});
			const Middle = defineResource<{ readonly score: number }>()({
				id: `profile.${count}.middle`,
				description: 'Intermediate value derived from the base.',
				dependencies: { base: Base },
			});
			const Store = defineResource<{ readonly score: number }>()({
				id: `profile.${count}.store`,
				description: 'Shared store borrowed by each middleware.',
				dependencies: { middle: Middle },
				requirements: [requirePermission(Use)],
			});
			const bindings = Array.from({ length: count }, (_, index) => {
				const definition = defineMiddleware({
					id: `profile.${count}.middleware.${index}`,
					description: 'Borrow the store under the current request authority.',
					resources: [Store],
				});
				return middlewareHandler(definition, async ({ request, resources }, next) => {
					const state = states.get(request) ?? { score: 0, visits: 0 };
					states.set(request, state);
					const store = await resources.get(Store);
					state.score += store.score;
					state.visits++;
					return await next();
				});
			});
			const states = new WeakMap<Request, { score: number; visits: number }>();
			const Score = ok(ScoreSchema, { id: `profile.${count}.score`, description: 'Observed middleware work.' });
			const Read = get({ id: `profile.${count}.read`, path: '/work', responses: [Score] });
			const Completion = observer.define({
				id: `profile.${count}.completion`,
				description: 'Join completed request cleanup.',
				events: ['completed'],
			});
			const Definition = define({
				id: `profile.${count}.service`,
				path: '/profile',
				endpoints: [Read],
				middleware: bindings.map((binding) => afterValidation(binding.definition)),
				observers: [Completion],
			});
			let requestId = '';
			let permissions = 0;
			let sequence = 0;
			let previousContext: Context | undefined;
			const requestLifetime: { signal?: AbortSignal } = {};
			const isClosed = (): boolean => requestLifetime.signal?.aborted === true;
			let complete: (() => void) | undefined;
			let running = false;
			let closed = false;
			const runtime = create(
				compile(implement(Definition, {
					endpoints: [endpointHandler(Read, async ({ request, ctx }) => {
						if (ctx.id !== requestId || ctx === previousContext) throw new Error('Request context was reused.');
						previousContext = ctx;
						requestLifetime.signal = ctx.signal;
						const state = states.get(request) ?? { score: 0, visits: 0 };
						states.delete(request);
						return createResponse(Score, state);
					})],
					middleware: bindings,
					resources: count === 0 ? implementations() : implementations(
						implementResource(Base, { create: () => ({ score: 1 }) }),
						implementResource(Middle, { create: ({ dependencies }) => ({ score: dependencies.base.score + 1 }) }),
						implementResource(Store, { create: ({ dependencies }) => ({ score: dependencies.middle.score + 1 }) }),
					),
				})),
				{
					host: {},
					requestId: () => requestId,
					observers: [observer.handler(Completion, () => {
						complete?.();
					})],
					adapters: {
						requirements: {
							unknown: 'reject',
							interpreters: {
								permission: interpreter({
									maximumChecks: 32,
									async check(ctx, requests) {
										if (ctx.id !== requestId || requests.some((entry) => entry.definition !== Use)) {
											throw new Error('Permission check escaped the current request.');
										}
										permissions += requests.length;
										return requests.map(() => ({ allowed: true as const }));
									},
								}),
							},
						},
					},
				},
			);
			return {
				async run() {
					if (closed || running) throw new Error('Service profile owner must be open and serial.');
					running = true;
					requestId = `profile-${count}-${++sequence}`;
					permissions = 0;
					requestLifetime.signal = undefined;
					const cleanup = new Promise<void>((resolve) => {
						complete = resolve;
					});
					try {
						const result = await runtime.fetch(new Request('https://profile.invalid/profile/work'));
						const body: unknown = await result.json();
						if (result.status !== 200) throw new Error('Service profile did not reach its declared handler.');
						const validated = await ScoreSchema['~standard'].validate(body);
						if (validated.issues !== undefined) throw new Error('Service profile returned an invalid response.');
						await cleanup;
						return {
							status: result.status,
							body: validated.value,
							permissionChecks: permissions,
							requestScopeClosed: isClosed(),
						};
					} finally {
						complete = undefined;
						running = false;
					}
				},
				async close() {
					if (running) throw new Error('Join the service profile request before closing its owner.');
					closed = true;
					await runtime[Symbol.asyncDispose]();
				},
			};
		},
	};
}

/** Identical programs for a local service and a replaceable background worker. */
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import * as schemaCore from '@okikio/schema';
import postgresjs from 'postgres';
import * as workflow from '@okikio/workflow';
import * as activity from '@okikio/activity';
import * as engine from '@okikio/activity/engine';
import * as failure from '@okikio/result/failure';
import * as context from '@okikio/context';
import * as resource from '@okikio/capability/resource';
import * as postgres from '@okikio/storage/workflow/postgres';
import { Approved, Engine, Policy as Base } from './events.ts';

export const Busy = failure.define({
	id: 'execution.busy',
	description: 'The recipient is temporarily busy.',
	data: schemaCore.object({ value: schemaCore.number() }),
});
const InputSchema = schemaCore.object({
	value: schemaCore.number(),
	fail: schemaCore.optional(schemaCore.boolean()),
	hold: schemaCore.optional(schemaCore.boolean()),
});
export const Work = activity.define({
	id: 'execution.write',
	version: '1',
	input: InputSchema,
	result: schemaCore.number(),
	failures: [Busy],
	placement: engine.require(Engine),
});
/** Waiting code observes cancellation. Durable permission checks also reject a replaced attempt's writes. */
export async function write(signal: AbortSignal, input: schemaCore.Output<typeof InputSchema>): Promise<number> {
	if (input.hold) {
		await new Promise<void>((_resolve, reject) => {
			if (signal.aborted) reject(signal.reason);
			else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
		});
	}
	if (input.fail) throw await failure.create(Busy, { data: { value: input.value } });
	return input.value;
}
export const WorkLive = activity.implement(Work, {
	run: (ctx) => write(ctx.signal, ctx.attempt > 1 ? { ...ctx.input, hold: false } : ctx.input),
});
export const Program = workflow.define({
	id: 'execution.import',
	version: '1',
	activities: [Work],
	input: schemaCore.object({
		mode: schemaCore.oneOf([
			'parallel',
			'map',
			'settle',
			'retry',
			'race',
			'events',
			'timer',
			'until',
			'fail-fast',
			'recover',
			'nested',
			'capacity',
		]),
		milliseconds: schemaCore.optional(schemaCore.number()),
		until: schemaCore.optional(schemaCore.string()),
	}),
	result: schemaCore.array(schemaCore.number()),
	failures: [Busy],
});
/** This two-step branch lets the recovery suite simulate removing a saved nested step. */
function nested(short: boolean): workflow.WorkflowOperation<number, failure.Occurrence<typeof Busy>> {
	return {
		*[Symbol.iterator]() {
			const value = yield* activity.request(Work, { value: 1 });
			if (!short) yield* workflow.wait({ event: Approved, key: 'nested' });
			return value;
		},
	};
}
/** Deliberately incompatible code under the same version. The worker must block it rather than skip saved work. */
const ShortLive = workflow.implement(Program, function* () {
	return [(yield* workflow.parallel({ first: nested(true) })).first];
});
/** Small import batches and external approval use the same operations in either host. */
export const ProgramLive = workflow.implement(Program, function* (ctx) {
	switch (ctx.input.mode) {
		case 'recover':
		case 'parallel': {
			const values = yield* workflow.parallel({
				first: activity.request(Work, { value: 1, ...(ctx.input.mode === 'recover' ? { hold: true } : {}) }),
				second: activity.request(Work, { value: 2 }),
			});
			return [values.first, values.second];
		}
		case 'map':
			return [
				...(yield* workflow.map([1, 2, 3, 4], (value) => activity.request(Work, { value }), {
					concurrency: 2,
					key: String,
				})),
			];
		case 'settle': {
			const values = yield* workflow.parallel({
				first: activity.request(Work, { value: 1, fail: true }),
				second: activity.request(Work, { value: 2 }),
			}, { failure: 'settle' });
			return [
				values.first.ok
					? values.first.value
					: failure.is(values.first.failure, Busy)
					? values.first.failure.data.value
					: -1,
				values.second.ok ? values.second.value : -1,
			];
		}
		case 'retry': {
			try {
				yield* workflow.retry(activity.request(Work, { value: 3, fail: true }), {
					maximumAttempts: 3,
					delay: { milliseconds: 20 },
					backoff: 2,
				});
				return [];
			} catch (error) {
				if (!failure.is(error, Busy)) throw error;
				return [error.data.value];
			}
		}
		case 'race': {
			const winner = yield* workflow.race({
				slow: activity.request(Work, { value: 1, hold: true }),
				fast: activity.request(Work, { value: 2 }),
			});
			return [winner.value];
		}
		case 'nested':
			return [(yield* workflow.parallel({ first: nested(false) })).first];
		case 'capacity': {
			const values = yield* workflow.map(
				[1, 2, 3],
				(value) => workflow.wait({ event: Approved, key: `capacity:${value}` }),
				{ concurrency: 2, key: String },
			);
			return values.map((value) => value.type === 'received' ? Number(value.value) : -1);
		}
		case 'events': {
			const values = yield* workflow.parallel({
				first: workflow.wait({ event: Approved, key: 'first' }),
				second: workflow.wait({ event: Approved, key: 'second' }),
			});
			return [
				values.first.type === 'received' ? Number(values.first.value) : -1,
				values.second.type === 'received' ? Number(values.second.value) : -1,
			];
		}
		case 'until': {
			const instant = yield* workflow.wait({ until: ctx.input.until ?? '2000-01-01T00:00:00Z' });
			if (!(instant instanceof Temporal.Instant)) throw new Error('Absolute waits must return an Instant.');
			return [1];
		}
		case 'timer': {
			const instant = yield* workflow.wait({ duration: { milliseconds: ctx.input.milliseconds ?? 10 } });
			if (!(instant instanceof Temporal.Instant)) {
				throw new Error('Timer waits must return an Instant in either host.');
			}
			return [1];
		}
		case 'fail-fast':
			yield* workflow.parallel({
				slow: activity.request(Work, { value: 1, hold: true }),
				fast: activity.request(Work, { value: 2, fail: true }),
			});
			return [];
	}
});
export const Policy = workflow.PolicySchema.parse({
	...Base,
	id: 'execution.policy',
	activities: [{ ...Base.activities[0]!, definition: Work, maxAttempts: 2, requires: [], deadlineMs: 30_000 }],
	workflows: [{ definition: Program, maxInstructions: 100, requires: ['workflow.controls'] }],
});

if (import.meta.main) {
	const sql = postgresjs(process.env.DATABASE_URL!, {
		max: 8,
		debug: process.env.TRACE_QUERIES ? (_connection, query) => console.log(JSON.stringify({ query })) : undefined,
		connection: { application_name: process.env.EXECUTION_NAMESPACE! },
		onnotice() {},
	});
	await using store = postgres.open({
		database: sql,
		namespace: process.env.EXECUTION_NAMESPACE!,
		notifications: process.env.NOTIFICATIONS !== 'false',
	});
	await using ctx = context.create({ id: 'execution-host' });
	await using resources = resource.create(resource.implementations(), { ctx, host: {} });
	await using worker = await workflow.serve({
		store,
		resources,
		engine: Engine,
		policies: [Policy],
		workflows: [process.env.SHORT_BRANCH === 'true' ? ShortLive : ProgramLive],
		activities: [WorkLive],
		hostId: 'execution-host',
		shutdown: new AbortController().signal,
		pollIntervalMs: Number(process.env.POLL_INTERVAL ?? 60_000),
		capacity: { activations: 2, activities: 2, finalizers: 1, control: 1 },
	});
	console.log(JSON.stringify({ ready: true }));
	await worker.closed;
	await sql.end();
}

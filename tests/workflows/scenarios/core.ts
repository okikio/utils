/** Core-style immutable import, correction-safe batches, and successor admission. @module */
import * as activity from '@okikio/activity';
import * as engine from '@okikio/activity/engine';
import * as csv from '@okikio/format/csv';
import * as workflow from '@okikio/workflow';
import {
	BatchInputSchema,
	BatchResultSchema,
	Database,
	digest,
	ExitResultSchema,
	Gate,
	IdentitySchema,
	SourceResultSchema,
	Store,
} from './contracts.ts';

/** Allowed environment for fixture database work. This value starts no worker. */
export const CoreEngine = engine.define({ id: 'fixture.core' });
/** Save the intended exit before a run is reported as finished. */
export const RecordExit = activity.define({
	id: 'fixture.record-exit',
	version: '1',
	input: workflow.FinalizationSchema,
	result: ExitResultSchema,
	placement: engine.require(CoreEngine),
	resources: [Store, Gate],
});
export const RecordExitLive = activity.implement(RecordExit, {
	async run(ctx) {
		const store = await ctx.get(Store);
		const gate = await ctx.get(Gate);
		await gate.reach('exit.before-write', { job: ctx.jobId });
		const saved = await store.transaction(ctx.claim, {
			key: 'exit-v1',
			input: ctx.input,
			result: ExitResultSchema,
		}, async (tx, receipt) => {
			const prior = await receipt.get();
			if (prior !== undefined) return prior;
			await tx`insert into exits (run, scope, definition, outcome)
        values (${ctx.input.run.id}, ${ctx.input.run.scope},
          ${ctx.input.run.definition.id}, ${tx.json(ctx.input.exit)})
        on conflict (run) do nothing`;
			return await receipt.save({ recorded: true });
		});
		await gate.reach('exit.committed', { job: ctx.jobId });
		return saved.value;
	},
});
/** Resolve at most 1,000 source rows using the current revision and any customer correction. */
export const Resolve = activity.define({
	id: 'fixture.core.resolve-batch',
	version: '1',
	input: BatchInputSchema,
	result: BatchResultSchema,
	placement: engine.require(CoreEngine),
	resources: [Store, Gate],
});
export const ResolveLive = activity.implement(Resolve, {
	async run(ctx) {
		const store = await ctx.get(Store);
		const gate = await ctx.get(Gate);
		const input = ctx.input;
		await gate.reach('core.batch.before-write', { job: ctx.jobId, after: input.after });
		const saved = await store.transaction(ctx.claim, {
			key: 'batch-v1',
			input,
			result: BatchResultSchema,
		}, async (tx, receipt) => {
			const prior = await receipt.get();
			if (prior !== undefined) return prior;
			const sources = await tx`select revision, digest, parsed from sources
        where scope = ${input.scope} and id = ${input.source} for update`;
			const source = sources[0];
			if (!source || source.revision !== input.revision || source.digest !== input.digest) {
				return await receipt.save({ status: 'superseded', after: input.after, count: 0, complete: true });
			}
			if (!source.parsed) throw new Error('invariant: resolution before source publication');
			const rows = await tx`insert into accounts (scope, source, position, revision, value)
        select scope, source, position, ${input.revision}, coalesce(correction, original[1], '')
          from source_rows where scope = ${input.scope} and source = ${input.source}
          and position > ${input.after} order by position limit 1000
        on conflict (scope, source, position) do update
          set revision = excluded.revision, value = excluded.value
        returning position`;
			return await receipt.save({
				status: 'current',
				after: rows.reduce((after, row) => Math.max(after, row.position), input.after),
				count: rows.length,
				complete: rows.length < 1000,
			});
		});
		await gate.reach('core.batch.committed', { job: ctx.jobId, after: saved.value.after });
		return saved.value;
	},
});
/** Request bounded Resolve batches until all source rows have been considered. */
export const Resolution = workflow.define({
	id: 'fixture.core.resolve',
	version: '1',
	input: IdentitySchema,
	result: BatchResultSchema,
	activities: [Resolve],
});
export const ResolutionLive = workflow.implement(Resolution, function* (ctx) {
	let after = 0;
	for (let batch = 0; batch <= 1000; batch++) {
		const result = yield* activity.request(Resolve, { ...ctx.input, after }, { key: `batch:${batch}` });
		if (result.status === 'superseded' || result.complete) return result;
		if (result.after <= after) throw new Error('invariant: resolution made no progress');
		after = result.after;
	}
	throw new Error('invariant: source exceeds the declared row bound');
});
/** Verify original source bytes independently, including after malformed CSV input. */
export const Verify = activity.define({
	id: 'fixture.core.verify',
	version: '1',
	input: IdentitySchema,
	result: SourceResultSchema,
	placement: engine.require(CoreEngine),
	resources: [Database, Store],
});
export const VerifyLive = activity.implement(Verify, {
	async run(ctx) {
		const { sql } = await ctx.get(Database);
		const store = await ctx.get(Store);
		const input = ctx.input;
		const write = { key: 'verify-v1', input, result: SourceResultSchema };
		const prior = await store.getReceipt(ctx.claim, write);
		if (prior !== undefined) return prior.value;
		const rows = await sql`select body from sources where scope = ${input.scope}
      and id = ${input.source} and digest = ${input.digest}`;
		const source = rows[0];
		if (!source || await digest(source.body) !== input.digest) throw new Error('invariant: original bytes differ');
		const saved = await store.transaction(ctx.claim, write, async (tx, receipt) => {
			const existing = await receipt.get();
			if (existing !== undefined) return existing;
			const current = await tx`select revision, digest from sources
        where scope = ${input.scope} and id = ${input.source} for update`;
			if (current[0]?.revision !== input.revision || current[0]?.digest !== input.digest) {
				return await receipt.save({ status: 'superseded', rows: 0, next: null });
			}
			await tx`update sources set verified = true where scope = ${input.scope} and id = ${input.source}`;
			return await receipt.save({ status: 'verified', rows: 0, next: null });
		});
		return saved.value;
	},
});
/** Read one immutable source and save original rows without assigning customer corrections. */
export const Parse = activity.define({
	id: 'fixture.core.parse',
	version: '1',
	input: IdentitySchema,
	result: SourceResultSchema,
	placement: engine.require(CoreEngine),
	resources: [Database, Store, Gate],
});

/** Bind the client used to accept resolution or verification inside the final source transaction. */
export function bindParse(coreClient: workflow.ClientType) {
	return activity.implement(Parse, {
		async run(ctx) {
			const { sql } = await ctx.get(Database);
			const store = await ctx.get(Store);
			const gate = await ctx.get(Gate);
			ctx.defer(() => gate.reach('core.cleanup', { job: ctx.jobId }));
			const input = ctx.input;
			const publication = { key: 'source-v1', input, result: SourceResultSchema };
			const completed = await store.getReceipt(ctx.claim, publication);
			if (completed !== undefined) return completed.value;
			const sources = await sql`select body from sources
        where scope = ${input.scope} and id = ${input.source} and digest = ${input.digest}`;
			const source = sources[0];
			if (!source || await digest(source.body) !== input.digest) throw new Error('invariant: original bytes differ');
			let document: csv.CsvDocument | undefined;
			try {
				document = csv.parse(source.body, {
					headerRow: 1,
					maximumRows: 1_000_000,
					maximumColumns: 32,
					maximumCellCharacters: 65_536,
				});
			} catch (cause) {
				if (!(cause instanceof csv.CsvParseError)) throw cause;
				// Malformed CSV still needs its original bytes verified. Accept that separate job in the final transaction.
			}
			const rows = document?.rows ?? [];
			for (let start = 0; start < rows.length; start += 1000) {
				const batch = rows.slice(start, start + 1000).map((row, index) => ({
					scope: input.scope,
					source: input.source,
					position: start + index + 1,
					original: row.values,
				}));
				const saved = await store.transaction(ctx.claim, {
					key: `rows-v1:${start}`,
					input: { ...input, batchDigest: await digest(JSON.stringify(batch)) },
					result: BatchResultSchema,
				}, async (tx, receipt) => {
					const prior = await receipt.get();
					if (prior !== undefined) return prior;
					const current = await tx`select revision, digest from sources
            where scope = ${input.scope} and id = ${input.source} for update`;
					if (current[0]?.revision !== input.revision || current[0]?.digest !== input.digest) {
						return await receipt.save({ status: 'superseded', after: start, count: 0, complete: true });
					}
					const inserted = await tx`insert into source_rows ${tx(batch, 'scope', 'source', 'position', 'original')}
            on conflict (scope, source, position) do update set original = excluded.original
              where source_rows.original = excluded.original`;
					if (inserted.count !== batch.length) throw new Error('invariant: immutable parsed row differs');
					await gate.reach('core.rows.before-commit', { job: ctx.jobId, after: start + batch.length });
					// correction is deliberately absent from the insert/update assignments.
					return await receipt.save({
						status: 'current',
						after: start + batch.length,
						count: batch.length,
						complete: start + batch.length === rows.length,
					});
				});
				if (saved.value.status === 'superseded') return { status: 'superseded' as const, rows: start, next: null };
				await gate.reach('core.rows.committed', { job: ctx.jobId, after: saved.value.after });
			}
			const saved = await store.transaction(ctx.claim, publication, async (tx, receipt) => {
				const prior = await receipt.get();
				if (prior !== undefined) return prior;
				const current = await tx`select revision, digest from sources
          where scope = ${input.scope} and id = ${input.source} for update`;
				if (current[0]?.revision !== input.revision || current[0]?.digest !== input.digest) {
					return await receipt.save({ status: 'superseded', rows: rows.length, next: null });
				}
				await tx`update sources set parsed = ${document !== undefined}, rejected = ${document === undefined},
          verified = ${document !== undefined} where scope = ${input.scope} and id = ${input.source}`;
				const next = await coreClient.in(tx, { claim: ctx.claim }).submit(
					document === undefined ? Verify : Resolution,
					input,
					{
						scope: input.scope,
						key: `${document === undefined ? 'verify' : 'resolve'}:${input.source}:${input.revision}:${input.digest}`,
					},
				);
				return await receipt.save({
					status: document === undefined ? 'rejected' : 'verified',
					rows: rows.length,
					next,
				});
			});
			await gate.reach('core.source.committed', { job: ctx.jobId, rows: saved.value.rows });
			return saved.value;
		},
	});
}

const WriteAttempt = {
	maxAttempts: 5,
	deadlineMs: 10_000,
	recovery: 'retry',
	retry: 'transient',
	delay: { initialMs: 100, maximumMs: 1000 },
	requires: ['postgres.transactions', 'postgres.receipts'],
};
/** Explicit test bounds and retry rules. The short renewal timings accelerate crash tests. */
export const CorePolicy = workflow.PolicySchema.parse({
	id: 'fixture.core.policy',
	version: '1',
	limits: {
		inputBytes: 65_536,
		resultBytes: 65_536,
		historyBytes: 8_388_608,
		pendingRoots: 20,
		reservedSuccessors: 20,
		pendingChildren: 0,
		pendingFinalizers: 40,
	},
	claims: { leaseMs: 600, renewEveryMs: 100, recoverEveryMs: 25 },
	activities: [
		{
			...WriteAttempt,
			definition: Parse,
			deadlineMs: 60_000,
			requires: [...WriteAttempt.requires, 'reserved.successors'],
		},
		{ ...WriteAttempt, definition: Resolve },
		{ ...WriteAttempt, definition: Verify },
	],
	workflows: [{ definition: Resolution, maxInstructions: 1001, requires: ['workflow.activities'] }],
	successors: [{ from: Parse, maximum: 1, choices: [Resolution, Verify] }],
	finalizers: [{
		roots: [Parse, Resolution, Verify],
		activity: RecordExit,
		maxAttempts: 3,
		deadlineMs: 5000,
		retry: 'transient',
		delay: { initialMs: 100, maximumMs: 1000 },
	}],
	retention: { dedupeMs: 604_800_000, resultsMs: 604_800_000, auditMs: 2_592_000_000 },
});

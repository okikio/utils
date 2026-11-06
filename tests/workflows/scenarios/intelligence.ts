/** Intelligence-style acquisition, publication, independent child, and retention. @module */
import * as activity from '@okikio/activity';
import * as engine from '@okikio/activity/engine';
import * as workflow from '@okikio/workflow';
import * as schemaCore from '@okikio/schema';
import {
	CaptureRejected,
	CaptureUnavailable,
	Database,
	digest,
	ExpiryResultSchema,
	Gate,
	KnowledgeInputSchema,
	KnowledgeResultSchema,
	ManifestSchema,
	Provider,
	ResearchInputSchema,
	Store,
} from './contracts.ts';
import { CoreEngine, RecordExit } from './core.ts';

export const ExtractionSchema = schemaCore.extend(KnowledgeInputSchema, {
	claimDigest: schemaCore.refine(
		schemaCore.string(),
		(value) => new RegExp(/^[0-9a-f]{64}$/).test(value),
		'String does not match the required pattern.',
	),
});
export const AnalysisSchema = schemaCore.extend(ExtractionSchema, {
	characters: schemaCore.refine(
		schemaCore.refine(
			schemaCore.refine(schemaCore.number(), Number.isSafeInteger, 'Expected a safe integer.'),
			(value) => value >= 0,
			'Value is below the minimum.',
		),
		(value) => value <= 4096,
		'Value exceeds the maximum.',
	),
});
export const StageResultSchema = schemaCore.object({
	stage: schemaCore.refine(
		schemaCore.string(),
		(value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),
		'Expected a UUID.',
	),
});
export const CommitInputSchema = schemaCore.extend(AnalysisSchema, {
	stage: schemaCore.refine(
		schemaCore.string(),
		(value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),
		'Expected a UUID.',
	),
});
/** Check business permission before accepting raw-data expiry and capture work. */
export const Authorize = activity.define({
	id: 'fixture.intelligence.verify',
	version: '1',
	input: ResearchInputSchema,
	result: ResearchInputSchema,
	placement: engine.require(CoreEngine),
	resources: [Database],
});
export const AuthorizeLive = activity.implement(Authorize, {
	async run(ctx) {
		const { sql } = await ctx.get(Database);
		const input = ctx.input;
		const rows = await sql`select id from research where scope = ${input.scope} and id = ${input.research}
      and grant_id = ${input.grant} and not closed and expires_at > clock_timestamp()
      and expires_at = ${input.expiresAt}::timestamptz`;
		if (rows.length !== 1) throw new Error('authorization: grant unavailable');
		return input;
	},
});
/** A worker with this engine can call the capture receiver without registering the other research implementations. */
export const CaptureEngine = engine.define({ id: 'fixture.capture' });
/** Call the receiver with one stable research key, then save its manifest under current attempt permission. */
export const Capture = activity.define({
	id: 'fixture.intelligence.capture',
	version: '1',
	input: ResearchInputSchema,
	result: ManifestSchema,
	failures: [CaptureUnavailable, CaptureRejected],
	placement: engine.oneOf(engine.allow(CoreEngine), engine.allow(CaptureEngine)),
	resources: [Provider, Store, Gate],
});
export const CaptureLive = activity.implement(Capture, {
	async run(ctx) {
		const provider = await ctx.get(Provider);
		const store = await ctx.get(Store);
		const gate = await ctx.get(Gate);
		const input = ctx.input;
		const write = { key: 'capture-v1', input, result: ManifestSchema };
		const prior = await store.getReceipt(ctx.claim, write);
		if (prior !== undefined) return prior.value;
		await gate.reach('intelligence.capture.before-call', { job: ctx.jobId });
		// No database transaction is held while HTTP is in flight.
		const manifest = await provider.capture(input, ctx.signal);
		await gate.reach('intelligence.remote.committed', { job: ctx.jobId, version: manifest.version });
		const saved = await store.transaction(ctx.claim, write, async (tx, receipt) => {
			const existing = await receipt.get();
			if (existing !== undefined) return existing;
			const rows = await tx`select id from research where scope = ${input.scope} and id = ${input.research}
        and grant_id = ${input.grant} and not closed and expires_at > clock_timestamp() for update`;
			if (rows.length !== 1) throw new Error('authorization: capture scope closed');
			if (manifest.scope !== input.scope || manifest.research !== input.research) {
				throw new Error('invariant: provider returned another raw scope');
			}
			const objects = await tx`select version from captures where scope = ${input.scope}
        and research = ${input.research} and version = ${manifest.version} and digest = ${manifest.digest}
        and body is not null`;
			if (objects.length !== 1) throw new Error('invariant: manifest is no longer readable');
			return await receipt.save(manifest);
		});
		return saved.value;
	},
});
/** Read the accepted capture version. Missing bytes fail rather than triggering a new capture. */
export const Extract = activity.define({
	id: 'fixture.intelligence.extract',
	version: '1',
	input: KnowledgeInputSchema,
	result: ExtractionSchema,
	placement: engine.require(CoreEngine),
	resources: [Database, Gate],
});
export const ExtractLive = activity.implement(Extract, {
	async run(ctx) {
		await (await ctx.get(Gate)).reach('intelligence.extract.before-read', { job: ctx.jobId });
		const { sql } = await ctx.get(Database);
		const { request, manifest } = ctx.input;
		const rows = await sql`select c.body from captures c join research r
      on r.scope = c.scope and r.id = c.research where c.scope = ${request.scope}
      and c.research = ${request.research} and c.version = ${manifest.version} and c.digest = ${manifest.digest}
      and r.grant_id = ${request.grant} and not r.closed and c.body is not null`;
		if (rows.length !== 1) throw new Error('authorization: artifact unavailable');
		return { ...ctx.input, claimDigest: await digest(rows[0]!.body) };
	},
});
/** Produce a small checked analysis result without calling an external model in this fixture. */
export const Analyze = activity.define({
	id: 'fixture.intelligence.analyze',
	version: '1',
	input: ExtractionSchema,
	result: AnalysisSchema,
	placement: engine.require(CoreEngine),
	resources: [Database],
});
export const AnalyzeLive = activity.implement(Analyze, {
	async run(ctx) {
		const { sql } = await ctx.get(Database);
		const { request, manifest } = ctx.input;
		const rows = await sql`select c.body from captures c join research r on r.scope = c.scope and r.id = c.research
      where c.scope = ${request.scope} and c.research = ${request.research}
      and c.version = ${manifest.version} and c.digest = ${manifest.digest}
      and r.grant_id = ${request.grant} and not r.closed and c.body is not null`;
		if (rows.length !== 1 || await digest(rows[0]!.body) !== ctx.input.claimDigest) {
			throw new Error('invariant: analysis artifact unavailable or changed');
		}
		return { ...ctx.input, characters: rows[0]!.body.length };
	},
});
/** Save the unpublished contribution once while the research grant remains valid. */
export const Stage = activity.define({
	id: 'fixture.intelligence.stage',
	version: '1',
	input: AnalysisSchema,
	result: StageResultSchema,
	placement: engine.require(CoreEngine),
	resources: [Store, Gate],
});
export const StageLive = activity.implement(Stage, {
	async run(ctx) {
		await (await ctx.get(Gate)).reach('intelligence.stage.before-write', { job: ctx.jobId });
		const store = await ctx.get(Store);
		const { request, manifest } = ctx.input;
		const saved = await store.transaction(ctx.claim, {
			key: 'stage-v1',
			input: ctx.input,
			result: StageResultSchema,
		}, async (tx, receipt) => {
			const prior = await receipt.get();
			if (prior !== undefined) return prior;
			const owners = await tx`select id from research where scope = ${request.scope} and id = ${request.research}
        and grant_id = ${request.grant} and not closed and expires_at > clock_timestamp() for update`;
			if (owners.length !== 1 || manifest.scope !== request.scope || manifest.research !== request.research) {
				throw new Error('authorization: publication grant unavailable');
			}
			const rows = await tx`insert into contributions (scope, research, digest, stage)
        values (${request.scope}, ${request.research}, ${manifest.digest}, ${crypto.randomUUID()})
        on conflict (scope, research, digest) do update set digest = excluded.digest returning stage`;
			return await receipt.save({ stage: rows[0]!.stage });
		});
		return saved.value;
	},
});
/** Publish the staged contribution once and return its stable commit ID. */
export const Commit = activity.define({
	id: 'fixture.intelligence.commit',
	version: '1',
	input: CommitInputSchema,
	result: KnowledgeResultSchema,
	placement: engine.require(CoreEngine),
	resources: [Store, Gate],
});
export const CommitLive = activity.implement(Commit, {
	async run(ctx) {
		const store = await ctx.get(Store);
		const gate = await ctx.get(Gate);
		const { request, manifest } = ctx.input;
		const saved = await store.transaction(ctx.claim, {
			key: 'commit-v1',
			input: ctx.input,
			result: KnowledgeResultSchema,
		}, async (tx, receipt) => {
			const prior = await receipt.get();
			if (prior !== undefined) return prior;
			const owners = await tx`select id from research where scope = ${request.scope} and id = ${request.research}
        and grant_id = ${request.grant} and not closed and expires_at > clock_timestamp() for update`;
			if (owners.length !== 1) throw new Error('authorization: publication grant unavailable');
			const rows = await tx`update contributions set commit = coalesce(commit, ${crypto.randomUUID()})
        where scope = ${request.scope} and research = ${request.research}
        and digest = ${manifest.digest} and stage = ${ctx.input.stage} returning commit`;
			if (rows.length !== 1) throw new Error('invariant: staged contribution unavailable');
			return await receipt.save({ commit: rows[0]!.commit });
		});
		await gate.reach('intelligence.publication.committed', { job: ctx.jobId, commit: saved.value.commit });
		return saved.value;
	},
});
/** Stage then publish one contribution. Acquire waits for this child to finish. */
export const Knowledge = workflow.define({
	id: 'fixture.intelligence.knowledge',
	version: '1',
	input: AnalysisSchema,
	result: KnowledgeResultSchema,
	activities: [Stage, Commit],
});
export const KnowledgeLive = workflow.implement(Knowledge, function* (ctx) {
	const staged = yield* activity.request(Stage, ctx.input, { key: 'stage-v1' });
	return yield* activity.request(Commit, { ...ctx.input, stage: staged.stage }, { key: 'commit-v1' });
});
/** Close the raw-data scope and remove bodies while preserving duplicate-request metadata. */
export const Delete = activity.define({
	id: 'fixture.intelligence.delete',
	version: '1',
	input: ResearchInputSchema,
	result: ExpiryResultSchema,
	placement: engine.require(CoreEngine),
	resources: [Store, Gate],
});
export const DeleteLive = activity.implement(Delete, {
	async run(ctx) {
		const gate = await ctx.get(Gate);
		const store = await ctx.get(Store);
		const input = ctx.input;
		const saved = await store.transaction(ctx.claim, {
			key: 'delete-v1',
			input,
			result: ExpiryResultSchema,
		}, async (tx, receipt) => {
			const prior = await receipt.get();
			if (prior !== undefined) return prior;
			// Keep raw bytes for at least two seconds after the last write in this small fixture.
			const owners = await tx`select *, greatest(expires_at, latest_at + interval '2 seconds') as eligible
        from research where scope = ${input.scope} and id = ${input.research} for update`;
			const owner = owners[0];
			if (!owner || owner.grant_id !== input.grant) throw new Error('authorization: raw scope unavailable');
			const clocks = await tx`select clock_timestamp() as now`;
			if (owner.eligible > clocks[0]!.now) {
				return await receipt.save({ deleted: false, nextEligibleAt: owner.eligible.toISOString() });
			}
			// Provider writes lock this same row. Closing wins before deletion; subsequent new writes fail.
			await tx`update research set closed = true where scope = ${input.scope} and id = ${input.research}`;
			await tx`update captures set body = null where scope = ${input.scope} and research = ${input.research}`;
			// Keep the receiver receipt, digest and version. Retrying capture cannot recreate deleted raw bytes.
			return await receipt.save({ deleted: true, nextEligibleAt: null });
		});
		await gate.reach('intelligence.expiry.committed', { job: ctx.jobId, deleted: Number(saved.value.deleted) });
		return saved.value;
	},
});
/** Keep a deletion obligation that can wait without an active worker or in-memory timer. */
export const Expire = workflow.define({
	id: 'fixture.intelligence.expire',
	version: '1',
	input: ResearchInputSchema,
	result: ExpiryResultSchema,
	activities: [Delete],
});
export const ExpireLive = workflow.implement(Expire, function* (ctx) {
	let until = ctx.input.expiresAt;
	for (let pass = 0; pass < 8; pass++) {
		yield* workflow.wait({ until, key: `retention:${pass}` });
		const result = yield* activity.request(Delete, ctx.input, { key: `delete:${pass}` });
		if (result.deleted) return result;
		if (result.nextEligibleAt === null) throw new Error('invariant: deletion deferred without eligibility');
		until = result.nextEligibleAt;
	}
	throw new Error('invariant: retention repair required after eight deferrals');
});
/** Accept expiry before capture, then wait for extraction, analysis, and publication. */
export const Acquire = workflow.define({
	id: 'fixture.intelligence.acquire',
	version: '1',
	input: ResearchInputSchema,
	result: KnowledgeResultSchema,
	activities: [Authorize, Capture, Extract, Analyze],
	workflows: [Expire, Knowledge],
});
export const AcquireLive = workflow.implement(Acquire, function* (ctx) {
	const request = yield* activity.request(Authorize, ctx.input, { key: 'grant-v1' });
	// Save the independent deletion job before any capture can create raw bytes. Parent cancellation keeps that job.
	yield* workflow.child(Expire, request, { key: 'fallback-v1', result: 'discard', cancellation: 'independent' });
	const manifest = yield* activity.request(Capture, request, { key: 'capture-v1' });
	const extracted = yield* activity.request(Extract, { request, manifest }, { key: 'extract-v1' });
	const analyzed = yield* activity.request(Analyze, extracted, { key: 'analyze-v1' });
	return yield* workflow.child(Knowledge, analyzed, {
		key: 'knowledge-v1',
		result: 'wait',
		cancellation: 'independent',
	});
});
const ReadAttempt = {
	maxAttempts: 3,
	deadlineMs: 5000,
	recovery: 'retry',
	retry: 'transient',
	delay: { initialMs: 100, maximumMs: 1000 },
	requires: [],
};
const WriteAttempt = {
	...ReadAttempt,
	maxAttempts: 5,
	requires: ['postgres.transactions', 'postgres.receipts'],
};
/** Explicit test bounds, receiver guarantees, and child limits. The timings are not production defaults. */
export const IntelligencePolicy = workflow.PolicySchema.parse({
	id: 'fixture.intelligence.policy',
	version: '1',
	limits: {
		inputBytes: 65_536,
		resultBytes: 65_536,
		historyBytes: 1_048_576,
		pendingRoots: 20,
		reservedSuccessors: 0,
		pendingChildren: 40,
		pendingFinalizers: 60,
	},
	claims: { leaseMs: 600, renewEveryMs: 100, recoverEveryMs: 25 },
	failures: [
		{ definition: CaptureUnavailable, disposition: 'transient' },
		{ definition: CaptureRejected, disposition: 'permanent' },
	],
	activities: [
		{ ...ReadAttempt, definition: Authorize },
		{
			...WriteAttempt,
			definition: Capture,
			deadlineMs: 10_000,
			requires: [...WriteAttempt.requires, 'provider.idempotency'],
		},
		{ ...ReadAttempt, definition: Extract },
		{ ...ReadAttempt, definition: Analyze },
		{ ...WriteAttempt, definition: Stage },
		{ ...WriteAttempt, definition: Commit },
		{ ...WriteAttempt, definition: Delete },
	],
	workflows: [
		{
			definition: Acquire,
			maxInstructions: 6,
			maximumChildren: 2,
			children: [{ definition: Expire, maximum: 1 }, { definition: Knowledge, maximum: 1 }],
			requires: ['workflow.activities', 'workflow.children'],
		},
		{ definition: Knowledge, maxInstructions: 2, maximumChildren: 0, requires: ['workflow.activities'] },
		{
			definition: Expire,
			maxInstructions: 16,
			maximumChildren: 0,
			requires: ['workflow.activities', 'workflow.timers'],
		},
	],
	successors: [],
	finalizers: [{
		roots: [Acquire, Knowledge, Expire],
		activity: RecordExit,
		maxAttempts: 3,
		deadlineMs: 5000,
		retry: 'transient',
		delay: { initialMs: 100, maximumMs: 1000 },
	}],
	retention: { dedupeMs: 604_800_000, resultsMs: 604_800_000, auditMs: 2_592_000_000 },
});

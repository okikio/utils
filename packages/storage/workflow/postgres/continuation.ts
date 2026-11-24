/** Bounded root-chain rollover. Every function that writes requires the adapter's guarded transaction. @module */
import * as sql from '@okikio/sql';
import type { Executor } from '@okikio/sql';
import * as execution from '@okikio/workflow/execution';
import type { ContinuationType, IdentityType, PolicyType } from '@okikio/workflow/execution';
import { chain, cleanups, history, shared } from './statements/mod.ts';

/** Structural view of the locked owner; the adapter retains authority and row validation. */
interface Run {
	readonly id: string;
	readonly scope: string;
	readonly kind: 'activity' | 'workflow';
	readonly definition: string;
	readonly version: string;
	readonly family: string;
	readonly parent: string | null;
	readonly policy: PolicyType;
	readonly state: string;
	readonly outcome: unknown | null;
	readonly chain_root: string;
	readonly chain_index: number;
	readonly continued_to: string | null;
	readonly continuation: unknown | null;
}

/** Existing acyclic admission promise, before adding a finite number of root segments. */
interface Reservation {
	readonly successors: number;
	readonly children: number;
	readonly finalizers: number;
}

/** Wrap only the outermost acyclic reservation; nested child/successor runs cannot continue. */
export function reservation(policy: PolicyType, definition: IdentityType, base: Reservation): Reservation {
	const maximum =
		policy.workflows.find((entry) => execution.address(entry.definition) === execution.address(definition))
			?.maxContinuations ?? 0;
	if (maximum === 0) return base;
	const segments = maximum + 1;
	const result = {
		successors: maximum + segments * base.successors,
		children: segments * base.children,
		finalizers: segments * base.finalizers,
	};
	if (Object.values(result).some((value) => !Number.isSafeInteger(value) || value < 0)) {
		throw new execution.ExecutionError('reservation_capacity');
	}
	return result;
}

/** Reject unsupported ownership and finalization before freezing a new segment's input. */
function rules(run: Run): void {
	if (run.kind !== 'workflow' || run.chain_root !== run.family) {
		throw new execution.ExecutionError('continuation_scope', 'Only an externally admitted root chain can continue.');
	}
	const definition = { kind: run.kind, id: run.definition, version: run.version };
	const rule = run.policy.workflows.find((entry) =>
		execution.address(entry.definition) === execution.address(definition)
	);
	if (rule === undefined) throw new execution.ExecutionError('definition_policy');
	if (run.chain_index >= (rule.maxContinuations ?? 0)) {
		throw new execution.ExecutionError('continuation_limit', 'The accepted continuation budget is exhausted.');
	}
	if (
		run.policy.finalizers.some((entry) =>
			entry.roots.some((root) => execution.address(root) === execution.address(definition))
		)
	) {
		throw new execution.ExecutionError(
			'continuation_finalizer',
			'Configured business finalizers require a terminal run.',
		);
	}
}

/** A continued segment cannot abandon ordinary attempts or unfinished child/successor obligations. */
async function quiescent(tx: Executor, namespace: string, run: Run): Promise<void> {
	const pending = (await sql.one(tx, chain.busy(namespace, run)))!;
	if (pending.jobs || pending.relatives) {
		throw new execution.ExecutionError('continuation_pending', 'Join unfinished family work before continuing.');
	}
}

/**
 * Freeze the root instruction and input under the activation's existing owner lock.
 * No successor is visible yet when registered cleanup must still run. No business outcome is fabricated.
 */
export async function request(
	tx: Executor,
	options: {
		readonly namespace: string;
		readonly run: Run;
		readonly request: ContinuationType;
		readonly instructions: number;
	},
): Promise<void> {
	const { namespace, run, instructions } = options;
	rules(run);
	if (run.state !== 'advancing' || run.outcome !== null || run.continuation !== null || run.continued_to !== null) {
		throw new execution.ExecutionError('continuation_state');
	}
	const request = execution.ContinuationSchema.parse(options.request);
	const intent = {
		...request,
		input: execution.encode(execution.decode(request.input), run.policy.limits.inputBytes),
	};
	const rule = run.policy.workflows.find((entry) =>
		execution.address(entry.definition) ===
			execution.address({ kind: run.kind, id: run.definition, version: run.version })
	)!;
	if (!Number.isSafeInteger(instructions) || instructions < 1 || instructions > rule.maxInstructions) {
		throw new execution.ExecutionError('instruction_limit');
	}
	const roots = (await sql.one(tx, history.count(namespace, run.id, null)))!.count;
	const total = (await sql.one(tx, history.count(namespace, run.id)))!.count;
	if (roots !== instructions - 1) throw new execution.ExecutionError('replay_conflict');
	if (total >= rule.maxInstructions) throw new execution.ExecutionError('instruction_limit');
	await quiescent(tx, namespace, run);
	const bytes = new TextEncoder().encode(JSON.stringify({ ...intent, type: 'continue' })).byteLength;
	const used = (await sql.one(tx, shared.history(namespace, run.id)))!.bytes;
	if (used + bytes > run.policy.limits.historyBytes) throw new execution.ExecutionError('history_limit');
	await sql.execute(
		tx,
		history.add({
			namespace,
			run: run.id,
			path: intent.path,
			fingerprint: intent.fingerprint,
			type: 'continue',
			bytes,
			parent: null,
		}),
	);
	await sql.execute(tx, chain.request(namespace, run.id, intent));
}

/**
 * Publish a fresh run and the previous segment's link in one transaction after durable cleanup.
 * The owner row, not an unrelated submit/dedupe lookup, serializes this transition.
 */
export async function rollover(
	tx: Executor,
	options: { readonly namespace: string; readonly run: Run },
): Promise<void> {
	const { namespace, run } = options;
	rules(run);
	if (run.state !== 'settling' || run.outcome !== null || run.continuation === null || run.continued_to !== null) {
		throw new execution.ExecutionError('continuation_state');
	}
	const request = execution.ContinuationSchema.parse(run.continuation);
	if (await sql.one(tx, cleanups.unfinished(namespace, run.id))) {
		throw new execution.ExecutionError('continuation_cleanup');
	}
	await quiescent(tx, namespace, run);
	const id = crypto.randomUUID();
	const digest = await execution.fingerprint(execution.decode(request.input));
	await sql.execute(tx, chain.next(namespace, run.id, { id, input: request.input, fingerprint: digest }));
	await sql.execute(tx, chain.link(namespace, run.id, id));
}

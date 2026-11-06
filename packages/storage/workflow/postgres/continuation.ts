/** Bounded root-chain rollover. Every function that writes requires the adapter's guarded transaction. @module */
import type { TransactionSql } from 'postgres';
import * as execution from '@okikio/workflow/execution';
import type { ContinuationType, IdentityType, PolicyType } from '@okikio/workflow/execution';

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
async function quiescent(tx: TransactionSql, namespace: string, run: Run): Promise<void> {
	const pending = await tx`select
 exists(select 1 from utils_workflow.jobs where namespace=${namespace} and run=${run.id}
 and not finalizer and state in ('ready','claimed','blocked')) as jobs,
 exists(select 1 from utils_workflow.runs where namespace=${namespace} and family=${run.family}
 and id!=${run.id} and state not in ('completed','failed','cancelled','continued')) as relatives`;
	if (pending[0]!.jobs || pending[0]!.relatives) {
		throw new execution.ExecutionError('continuation_pending', 'Join unfinished family work before continuing.');
	}
}

/**
 * Freeze the root instruction and input under the activation's existing owner lock.
 * No successor is visible yet when registered cleanup must still run. No business outcome is fabricated.
 */
export async function request(
	tx: TransactionSql,
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
	const counts = await tx`select count(*)::integer as roots,
 (select count(*)::integer from utils_workflow.instructions where namespace=${namespace} and run=${run.id}) as total
 from utils_workflow.instructions where namespace=${namespace} and run=${run.id} and parent is null`;
	if (counts[0]!.roots !== instructions - 1) throw new execution.ExecutionError('replay_conflict');
	if (counts[0]!.total >= rule.maxInstructions) throw new execution.ExecutionError('instruction_limit');
	await quiescent(tx, namespace, run);
	const bytes = new TextEncoder().encode(JSON.stringify({ ...intent, type: 'continue' })).byteLength;
	const history = await tx`select (
 (select coalesce(sum(bytes),0) from utils_workflow.instructions where namespace=${namespace} and run=${run.id}) +
 (select coalesce(sum(bytes),0) from utils_workflow.events where namespace=${namespace} and run=${run.id}) +
 (select coalesce(sum(bytes),0) from utils_workflow.progress where namespace=${namespace} and run=${run.id})
 )::integer as bytes`;
	if (history[0]!.bytes + bytes > run.policy.limits.historyBytes) throw new execution.ExecutionError('history_limit');
	await tx`insert into utils_workflow.instructions(namespace,run,path,fingerprint,type,bytes,parent)
 values (${namespace},${run.id},${intent.path},${intent.fingerprint},'continue',${bytes},null)`;
	await tx`update utils_workflow.runs set state='settling',continuation=${tx.json(intent)},expires=null,reason=null
 where namespace=${namespace} and id=${run.id}`;
}

/**
 * Publish a fresh run and the previous segment's link in one transaction after durable cleanup.
 * The owner row, not an unrelated submit/dedupe lookup, serializes this transition.
 */
export async function rollover(
	tx: TransactionSql,
	options: { readonly namespace: string; readonly run: Run },
): Promise<void> {
	const { namespace, run } = options;
	rules(run);
	if (run.state !== 'settling' || run.outcome !== null || run.continuation === null || run.continued_to !== null) {
		throw new execution.ExecutionError('continuation_state');
	}
	const request = execution.ContinuationSchema.parse(run.continuation);
	const pending = await tx`select path from utils_workflow.cleanups where namespace=${namespace} and run=${run.id}
 and state!='completed' limit 1`;
	if (pending.length) throw new execution.ExecutionError('continuation_cleanup');
	await quiescent(tx, namespace, run);
	const id = crypto.randomUUID();
	const digest = await execution.fingerprint(execution.decode(request.input));
	await tx`insert into utils_workflow.runs
 (namespace,id,scope,key,kind,definition,version,input,fingerprint,policy,policyhash,state,family,parent,cancellation,
 reservation,trace,paused,control_revision,chain_root,chain_index,location)
 select namespace,${id},scope,${`continue:${id}`},kind,definition,version,${tx.json(request.input)},${digest},
 policy,policyhash,'ready',family,id,'independent',reservation,trace,paused,control_revision,chain_root,chain_index+1,location
 from utils_workflow.runs where namespace=${namespace} and id=${run.id}`;
	await tx`update utils_workflow.runs set state='continued',continued_to=${id},continuation=null,expires=null,reason=null
 where namespace=${namespace} and id=${run.id}`;
}

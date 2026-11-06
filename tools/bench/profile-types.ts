/** Types shared by diagnostic controllers; these do not make untrusted inspector bytes authoritative. @module */
import type { Debugger, Profiler, Runtime } from 'node:inspector';

/** A complete CPU graph after the controller checks that sample and delta arrays are present. */
export type ProfileType = Profiler.Profile & {
	/** Stack-node ids in sampling order. Each id must exist in the retained node graph. */
	samples: number[];
	/** Microseconds since the previous sample. Negative values stay visible as diagnostic evidence. */
	timeDeltas: number[];
};

/** Native close receipt. A signal or a missing zero code prevents a successful diagnostic result. */
export type ExitType = { code: number | null; signal: NodeJS.Signals | null };

/** One outstanding inspector request; disconnection rejects every entry before clearing the table. */
export type PendingType = { resolve(value: unknown): void; reject(reason: unknown): void };

/** Raw responses are correlated by id before their method-specific payload is read. */
export type InspectorType = {
	/** Sequence number assigned by this controller, not an identifier from the workload. */
	id?: number;
	method?: string;
	error?: { message: string; code?: number };
	/** Only the outstanding request knows which response contract applies. */
	result?: unknown;
	params?: unknown;
};

/** Method-specific response contracts used by the profilers. Other control methods return no useful fields. */
export type ResponseType = {
	'Profiler.stop': { profile: ProfileType };
	'Debugger.getScriptSource': Debugger.GetScriptSourceReturnType;
	'Debugger.evaluateOnCallFrame': Debugger.EvaluateOnCallFrameReturnType;
	'Runtime.evaluate': Runtime.EvaluateReturnType;
};

/** Concrete workload membership from the HTTP fixture's listing command. */
export type WorkloadType = { id: string; candidates: string[] };

/** Ready identifies the actual workload and runtime before the controller begins sampling. */
export type ReadyType = {
	phase: 'ready';
	id: string;
	candidate: string;
	runtime: Record<string, string>;
	/** Completed operations in one calibrated batch; construction and warmup precede this gate. */
	units: number;
};

/** Done ends one sampling interval. The owner still has to acknowledge stop and join the child. */
export type DoneType = {
	phase: 'done';
	/** Total operations across all completed batches. */
	units: number;
	batches: number;
	/** Diagnostic wall time includes profiler and gate overhead. It is not a throughput estimate. */
	elapsedMs: number;
	/** Ordinary suite workloads retain their native benchmark result rather than an HTTP operation count. */
	result?: { alias: string; args: unknown; runs: { name: string; args: unknown; error?: unknown }[] };
};

/** Gates come from the owned workload. Runtime checks establish phase order and measurement counts. */
export type HttpGateType = ReadyType | DoneType | { phase: 'finished' };

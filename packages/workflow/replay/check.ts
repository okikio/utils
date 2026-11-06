/** Replay completed fixtures through the production interpreter without external command dispatch. @module */
import type { Context } from '@okikio/context';
import * as workflow from '../mod.ts';
import { ReplayError } from '../history.ts';
import { freeze } from '../testing.ts';
import type { FixtureType, LimitsType } from '../testing.ts';
import type { History, WorkflowDefinition, WorkflowImplementation, WorkflowResult } from '../types.ts';
/** Replay stops at the first missing, changed or extra authoritative instruction. */
export class ReplayCheckError extends Error {
	/** Exact diagnostic category; program/codec defects retain their original errors. */
	readonly code: 'definition' | 'missing' | 'extra';
	/** Deterministic instruction path, if the mismatch belongs to an instruction. */
	readonly path: string | undefined;
	constructor(code: ReplayCheckError['code'], path?: string) {
		super(`Workflow replay ${code}${path === undefined ? '' : ` at ${path}`}.`);
		this.name = 'ReplayCheckError';
		this.code = code;
		this.path = path;
	}
}
/**
 * Replay one bounded complete fixture using only saved instruction completions. Missing steps never call next().
 * As with native memory history, a saved control completion is atomic: nested programs beneath a completed
 * control are not reinterpreted. The returned opaqueControls makes this coverage limit visible. Generator and
 * schema code is trusted application code and must not perform external effects outside yielded instructions.
 */
export async function check<Definition extends WorkflowDefinition>(
	implementation: WorkflowImplementation<Definition>,
	input: FixtureType,
	options: LimitsType & { readonly ctx: Context },
): Promise<Readonly<{ value: WorkflowResult<Definition>; matched: number; opaqueControls: readonly string[] }>> {
	const fixture = freeze(input, options);
	if (
		fixture.definition.id !== implementation.definition.id ||
		fixture.definition.version !== implementation.definition.version
	) throw new ReplayCheckError('definition');
	const entries = new Map(fixture.history.entries.map((entry) => [entry.path, entry]));
	const visited = new Set<string>(), opaqueControls: string[] = [];
	const records: History = {
		async schedule(input) {
			const entry = entries.get(input.path);
			if (entry === undefined) throw new ReplayCheckError('missing', input.path);
			if (entry.fingerprint !== input.identity.fingerprint) {
				throw new ReplayError(
					input.ctx.runId,
					input.path,
					entry.fingerprint,
					input.identity.fingerprint,
				);
			}
			visited.add(input.path);
			if (input.instruction.category === 'control') opaqueControls.push(input.path);
			return await input.decode(entry.completion!);
		},
		async close() {},
		async [Symbol.asyncDispose]() {},
	};
	await using scheduler = workflow.scheduler({ history: records });
	await using ctx = await workflow.context({
		definition: implementation.definition,
		input: fixture.input.kind === 'undefined' ? undefined : fixture.input.value,
		runId: fixture.history.runId,
		ctx: options.ctx,
	});
	let value: WorkflowResult<Definition>;
	try {
		value = await workflow.run({ ctx, implementation, scheduler });
	} catch (error) {
		// The interpreter wraps scheduler defects. Unwrap only our documented mismatch categories;
		// cleanup failures and unrelated application/codec errors retain their production error boundary.
		if (
			error instanceof workflow.FaultError &&
			(error.fault instanceof ReplayError || error.fault instanceof ReplayCheckError)
		) throw error.fault;
		throw error;
	}
	for (const entry of fixture.history.entries) {
		if (!visited.has(entry.path) && !opaqueControls.some((parent) => entry.path.startsWith(parent + '/'))) {
			throw new ReplayCheckError('extra', entry.path);
		}
	}
	return Object.freeze({ value, matched: visited.size, opaqueControls: Object.freeze(opaqueControls) });
}

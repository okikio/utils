/**
 * Rebuild a workflow by feeding saved answers back into its generator.
 *
 * A generator describes the next operation; it must not perform an external write
 * while being rebuilt. When a requested answer is absent, storage retains the wait
 * and this replay turn returns. A later turn starts the generator again and reuses
 * the earlier answers instead of retaining its JavaScript stack.
 * @module
 */

import * as result from '@okikio/result';
import { CancelledError, FaultError } from './errors.ts';
import { sleep } from './instructions.ts';
import { ExecutionError } from './execution.ts';
import * as retry from './retry.ts';
import type {
	WorkflowCompletionAny,
	WorkflowControlInstruction,
	WorkflowInstruction,
	WorkflowOperation,
} from './types.ts';

/** A suspended program retains paths, not live promises or worker slots. */
type Turn = { readonly done: true; readonly value: unknown } | {
	readonly done: false;
	readonly pending: readonly string[];
};
/** Storage boundary. Only leaf requests and race decisions need database ownership. */
interface Steps {
	step(command: WorkflowInstruction, path: string, parent?: string): Promise<WorkflowCompletionAny | undefined>;
	choose(path: string, key: string): Promise<string>;
	verify(parent: string, instructions: number): Promise<void>;
	close?(parent: string): Promise<boolean>;
}

/**
 * Replay completed steps as values. Save every eligible sibling before parking.
 * Keep generator code free of external writes: suspension discards its JS stack.
 */
export async function replay(
	iterator: Generator<WorkflowInstruction, unknown, WorkflowCompletionAny>,
	steps: Steps,
): Promise<Turn> {
	/** Walk one sequential branch. Root positions retain the existing stored path format. */
	async function walk(
		program: Generator<WorkflowInstruction, unknown, WorkflowCompletionAny>,
		parent?: string,
	): Promise<Turn> {
		let resume: WorkflowCompletionAny | undefined;
		// The authored position forms part of the saved instruction path. Reordering changes replay identity.
		let index = 0;
		const keys = new Set<string>();
		try {
			for (;;) {
				if (resume?.type === 'fault') throw new FaultError(resume.fault);
				if (resume?.type === 'cancelled') throw new CancelledError(resume.reason);
				// Resume authored code only with the recorded completion for its prior request.
				// The generator may calculate local values, then yields the next operation to save.
				const next = resume === undefined ? program.next() : program.next(resume);
				if (next.done) {
					if (parent !== undefined) {
						await steps.verify(parent, index);
						if (steps.close && !await steps.close(parent)) return { done: false, pending: [`@cleanup:${parent}`] };
					}
					return { done: true, value: next.value };
				}
				const command = next.value;
				if (command.key !== undefined) {
					if (keys.has(command.key)) throw new ExecutionError('duplicate_instruction');
					keys.add(command.key);
				}
				const position = `${index++}:${command.key ?? ''}`;
				const path = parent === undefined ? position : `${parent}/${position}`;
				if (command.category === 'control') {
					const saved = await steps.step(command, path, parent);
					try {
						const turn = await control(command, path, saved);
						if (!turn.done) return turn;
						resume = { type: 'success', value: turn.value };
					} catch (failure) {
						if (terminal(failure)) throw failure;
						resume = { type: 'failure', failure };
					}
				} else {
					resume = await steps.step(command, path, parent);
					if (resume === undefined) return { done: false, pending: [path] };
				}
			}
		} catch (error) {
			if (parent !== undefined && !(error instanceof ExecutionError)) {
				await steps.verify(parent, index);
				if (steps.close && !await steps.close(parent)) return { done: false, pending: [`@cleanup:${parent}`] };
			}
			throw error;
		}
	}
	/** A fault or cancellation must not become a settled business failure or a logical retry. */
	function terminal(reason: unknown): boolean {
		return reason instanceof FaultError || reason instanceof CancelledError || reason instanceof ExecutionError;
	}
	/** Each branch rebuilds its own iterator. Its first unfinished leaf is the saved continuation point. */
	function branch(operation: WorkflowOperation<unknown, unknown>, path: string, key: string): Promise<Turn> {
		return walk(
			operation[Symbol.iterator](),
			`${path}/${encodeURIComponent(key)}`,
		);
	}
	/** Controls share the public operation shape with local execution; storage replaces live branch promises. */
	async function control(
		command: WorkflowControlInstruction,
		path: string,
		saved?: WorkflowCompletionAny,
	): Promise<Turn> {
		if (command.type === 'retry') {
			for (let attempt = 1;; attempt++) {
				try {
					return await branch(command.operation, path, `attempt:${attempt}`);
				} catch (error) {
					if (terminal(error) || attempt >= command.maximumAttempts) throw error;
					if (command.delay !== undefined) {
						const turn = await branch(
							sleep(retry.delay(command, path, attempt).toString()),
							path,
							`retry-delay:${attempt}`,
						);
						if (!turn.done) return turn;
					}
				}
			}
		}
		if (command.type === 'race') {
			// A saved winner is authoritative on replay. Finish loser cleanup before returning that winner.
			if (saved?.type === 'success') {
				const key = saved.value as string;
				const winner = command.operations[key];
				if (!winner) throw new ExecutionError('race_binding');
				for (const loser of Object.keys(command.operations).filter((entry) => entry !== key)) {
					const scope = `${path}/${encodeURIComponent(loser)}`;
					if (steps.close && !await steps.close(scope)) return { done: false, pending: [`@cleanup:${scope}`] };
				}
				const turn = await branch(winner, path, key);
				return turn.done ? { done: true, value: { key, value: turn.value } } : turn;
			}
			const pending: string[] = [];
			let first:
				| { key: string; type: 'success'; value: unknown }
				| { key: string; type: 'failure'; error: unknown }
				| undefined;
			for (const [key, operation] of Object.entries(command.operations).sort(([a], [b]) => a.localeCompare(b))) {
				try {
					const turn = await branch(operation, path, key);
					if (turn.done) first ??= { key, type: 'success', value: turn.value };
					else pending.push(...turn.pending);
				} catch (failure) {
					if (failure instanceof ExecutionError) throw failure;
					first ??= { key, type: 'failure', error: failure };
				}
			}
			if (!first) return { done: false, pending };
			// Persist the winner before closing losers so another replay cannot select a different result.
			await steps.choose(path, first.key);
			for (const loser of Object.keys(command.operations).filter((entry) => entry !== first.key)) {
				const scope = `${path}/${encodeURIComponent(loser)}`;
				if (steps.close && !await steps.close(scope)) return { done: false, pending: [`@cleanup:${scope}`] };
			}
			if (first.type === 'failure') throw first.error;
			return { done: true, value: { key: first.key, value: first.value } };
		}
		const entries = command.type === 'map'
			? command.entries.map((entry) => [entry.key, entry.operation] as const)
			: Object.entries(command.operations);
		const concurrency = command.concurrency ?? entries.length;
		const values: unknown[] = [];
		const pending: string[] = [];
		let active = 0;
		let queued = false;
		// Visit each branch until its next saved wait. Unfinished branches consume the
		// declared branch budget; replayed completed branches can make room immediately.
		for (const [key, operation] of entries) {
			if (active >= concurrency) {
				queued = true;
				continue;
			}
			try {
				const turn = await branch(operation, path, key);
				if (!turn.done) {
					active++;
					pending.push(...turn.pending);
				} else values.push(command.failure === 'settle' ? result.ok(turn.value) : turn.value);
			} catch (failure) {
				if (terminal(failure) || command.failure !== 'settle') throw failure;
				values.push(result.fail(failure));
			}
		}
		if (pending.length || queued) return { done: false, pending };
		return {
			done: true,
			value: command.type === 'map' ? values : Object.fromEntries(entries.map(([key], index) => [key, values[index]])),
		};
	}
	return await walk(iterator);
}

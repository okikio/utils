import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import * as failures from '@okikio/result/failure';
import * as workflow from './mod.ts';
import { expected, history, operation, runProgram } from './fixtures/program.ts';

describe('workflow cancellation and cleanup', () => {
	it('runs registered cleanups in reverse order after cancellation', async () => {
		const calls: string[] = [];
		await expect(runProgram(function* () {
			yield* workflow.defer(operation('cleanup:first'));
			yield* workflow.defer(operation('cleanup:second'));
			yield* operation('cancel');
			return 'unreachable';
		}, {
			activity: async (_ctx, attempt) => {
				if (attempt.input === 'cancel') return workflow.cancelled('cancelled by test');
				calls.push(String(attempt.input));
				return workflow.success(undefined);
			},
		})).rejects.toThrow(workflow.CancelledError);
		expect(calls).toEqual(['cleanup:second', 'cleanup:first']);
	});

	it('preserves primary and cleanup failures together', async () => {
		const primary = await expected({ phase: 'primary' }, 'primary');
		const cleanup = await expected({ phase: 'cleanup' }, 'cleanup');
		try {
			await runProgram(function* () {
				yield* workflow.defer(operation('cleanup'));
				yield* operation('primary');
				return 'unreachable';
			}, {
				activity: async (_ctx, attempt) =>
					attempt.input === 'primary' ? workflow.failed(primary) : workflow.failed(cleanup),
			});
			throw new Error('Expected workflow execution to fail.');
		} catch (error) {
			expect(error).toBeInstanceOf(workflow.CleanupFailureError);
			if (error instanceof workflow.CleanupFailureError) {
				expect(failures.isOccurrence(error.primary)).toBe(true);
				if (failures.isOccurrence(error.primary)) expect(error.primary.data).toEqual({ phase: 'primary' });
				expect(error.cleanupFailures).toHaveLength(1);
				const cleanupFailure = error.cleanupFailures[0];
				expect(failures.isOccurrence(cleanupFailure)).toBe(true);
				if (failures.isOccurrence(cleanupFailure)) expect(cleanupFailure.data).toEqual({ phase: 'cleanup' });
			}
		}
	});

	it('keeps faults, cancellation, and continue-as-new outside program catch blocks while running finally', async () => {
		for (const mode of ['fault', 'cancel', 'continue'] as const) {
			let caught = false;
			let finalized = false;
			const execution = runProgram(function* () {
				try {
					if (mode === 'continue') yield* workflow.continue({ cursor: 2 });
					else yield* operation(mode);
				} catch {
					caught = true;
				} finally {
					finalized = true;
				}
				return 'unreachable';
			}, {
				activity: async () => mode === 'fault' ? workflow.fault(new Error('fault')) : workflow.cancelled('cancelled'),
			});
			if (mode === 'fault') await expect(execution).rejects.toThrow(workflow.FaultError);
			else if (mode === 'cancel') await expect(execution).rejects.toThrow(workflow.CancelledError);
			else await expect(execution).rejects.toThrow(workflow.ContinueAsNewError);
			expect(caught).toBe(false);
			expect(finalized).toBe(true);
		}
	});

	it('persists cleanup registration before the workflow body advances', async () => {
		let bodyAdvanced = false;
		let sawRegistration = false;
		const calls: string[] = [];
		const output = await runProgram(function* () {
			yield* workflow.defer(operation('cleanup', 'cleanup-command'), { key: 'register-cleanup' });
			bodyAdvanced = true;
			return 'done';
		}, {
			history: history(async ({ instruction, next }) => {
				if (instruction.type === 'defer') sawRegistration = !bodyAdvanced;
				return await next();
			}),
			activity: async (_ctx, attempt) => {
				calls.push(String(attempt.input));
				return workflow.success(undefined);
			},
		});
		expect(output).toBe('done');
		expect(sawRegistration).toBe(true);
		expect(calls).toEqual(['cleanup']);
		expect(() => workflow.defer(workflow.sleep('PT1S'))).toThrow(TypeError);
	});
});

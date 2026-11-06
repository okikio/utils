import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import * as failures from '@okikio/result/failure';
import * as workflow from './mod.ts';
import { deferred, expected, history, operation, runProgram, TestFailure } from './fixtures/program.ts';

describe('deterministic workflow composition', () => {
	it('uses deterministic sequential paths and lets programs catch declared failures', async () => {
		const paths: string[] = [];
		const expectedFailure = await expected({ operation: 'fail' }, 'expected failure');
		const output = await runProgram(function* () {
			const first = yield* operation<string>('first');
			try {
				yield* operation('fail');
			} catch (error) {
				expect(failures.isOccurrence(error)).toBe(true);
				if (failures.isOccurrence(error)) {
					expect(error.definition).toBe(TestFailure);
					expect(error.data).toEqual({ operation: 'fail' });
				}
			}
			const third = yield* operation<string>('third', 'stable-third');
			return `${first}:${third}`;
		}, {
			activity: async (_ctx, attempt) => {
				paths.push(attempt.origin.instructionPath);
				return attempt.input === 'fail' ? workflow.failed(expectedFailure) : workflow.success(attempt.input);
			},
		});
		expect(output).toBe('first:third');
		expect(paths).toEqual([
			'test.workflow@1/0:activity',
			'test.workflow@1/1:activity',
			'test.workflow@1/stable-third:activity',
		]);
	});

	it('passes every nested instruction through one lifecycle wrapper', async () => {
		const paths: string[] = [];
		const output = await runProgram(function* () {
			const values = yield* workflow.parallel({
				first: operation<string>('first'),
				second: workflow.retry(operation<string, failures.Occurrence<typeof TestFailure>>('second'), {
					maximumAttempts: 1,
				}),
			});
			return `${values.first}:${values.second}`;
		}, {
			history: history(async ({ path, next }) => {
				paths.push(path);
				return await next();
			}),
		});
		expect(output).toBe('first:second');
		expect([...paths].sort()).toEqual([
			'test.workflow@1/0:parallel',
			'test.workflow@1/0:parallel/first/0:activity',
			'test.workflow@1/0:parallel/second/0:retry',
			'test.workflow@1/0:parallel/second/0:retry/attempt:1/0:activity',
		].sort());
	});

	it('preserves undefined as an explicit workflow-command failure value', async () => {
		let rejected = false;
		try {
			await runProgram(function* () {
				yield* workflow.sleep('PT0.001S');
				return 'unreachable';
			}, { command: async () => workflow.failed(undefined) });
		} catch (error) {
			rejected = true;
			expect(error).toBe(undefined);
		}
		expect(rejected).toBe(true);
	});

	it('retains an undefined failure in a losing race branch', async () => {
		const winner: workflow.WorkflowOperation<string> = {
			// This fixture settles before requesting any instruction.
			// deno-lint-ignore require-yield
			*[Symbol.iterator]() {
				return 'winner';
			},
		};
		const loser: workflow.WorkflowOperation<never> = {
			// This fixture settles before requesting any instruction.
			// deno-lint-ignore require-yield
			*[Symbol.iterator]() {
				throw undefined;
			},
		};
		let rejected = false;
		try {
			await runProgram(function* () {
				yield* workflow.race({ a: winner, b: loser });
				return 'must not erase loser failure';
			});
		} catch (error) {
			rejected = true;
			// A control-interpreter defect crosses the public boundary as a fault.
			expect(error).toBeInstanceOf(workflow.FaultError);
			if (error instanceof workflow.FaultError) {
				expect(error.fault).toBeInstanceOf(workflow.CleanupFailureError);
				if (error.fault instanceof workflow.CleanupFailureError) {
					expect(error.fault.cleanupFailures).toEqual([undefined]);
				}
			}
		}
		expect(rejected).toBe(true);
	});

	it('keeps an undefined race primary beside a secondary failure', async () => {
		const secondary = new Error('secondary branch failed');
		const primary: workflow.WorkflowOperation<never> = {
			// This fixture settles before requesting any instruction.
			// deno-lint-ignore require-yield
			*[Symbol.iterator]() {
				throw undefined;
			},
		};
		const loser: workflow.WorkflowOperation<never> = {
			// This fixture settles before requesting any instruction.
			// deno-lint-ignore require-yield
			*[Symbol.iterator]() {
				throw secondary;
			},
		};
		let rejected = false;
		try {
			await runProgram(function* () {
				yield* workflow.race({ a: primary, b: loser });
				return 'unreachable';
			});
		} catch (error) {
			rejected = true;
			expect(error).toBeInstanceOf(workflow.FaultError);
			if (error instanceof workflow.FaultError) {
				expect(error.fault).toBeInstanceOf(workflow.CleanupFailureError);
				if (error.fault instanceof workflow.CleanupFailureError) {
					expect(error.fault.primary).toBe(undefined);
					expect(error.fault.cleanupFailures).toEqual([secondary]);
				}
			}
		}
		expect(rejected).toBe(true);
	});

	it('preserves an undefined primary from bounded map without admitting later items', async () => {
		const admitted: number[] = [];
		let rejected = false;
		try {
			await runProgram(function* () {
				yield* workflow.map([0, 1, 2], (value): workflow.WorkflowOperation<never> => ({
					*[Symbol.iterator]() {
						admitted.push(value);
						throw undefined;
					},
				}), { concurrency: 1, key: String });
				return 'unreachable';
			});
		} catch (error) {
			rejected = true;
			expect(error).toBe(undefined);
		}
		expect(rejected).toBe(true);
		expect(admitted).toEqual([0]);
	});

	it('settles parallel branches without cancelling expected failures', async () => {
		const branchFailure = await expected({ branch: 'second' }, 'branch failed');
		const output = await runProgram(function* () {
			const values = yield* workflow.parallel({
				first: operation<string>('first'),
				second: operation<string, failures.Occurrence<typeof TestFailure>>('fail'),
			}, { failure: 'settle' });
			return values.first.ok && !values.second.ok
				? `${values.first.value}:${values.second.failure.message}`
				: 'invalid';
		}, {
			activity: async (_ctx, attempt) =>
				attempt.input === 'fail' ? workflow.failed(branchFailure) : workflow.success(attempt.input),
		});
		expect(output).toBe('first:branch failed');
	});

	it('cancels and awaits active siblings before fail-fast parallel resumes', async () => {
		const blockerStarted = deferred();
		let blockerStopped = false;
		const primaryFailure = await expected({ branch: 'failure' }, 'primary branch failure');
		const output = await runProgram(function* () {
			try {
				yield* workflow.parallel({ blocker: operation('block'), failure: operation('fail') });
			} catch (error) {
				expect(failures.isOccurrence(error)).toBe(true);
				if (failures.isOccurrence(error)) expect(error.definition).toBe(TestFailure);
			}
			expect(blockerStopped).toBe(true);
			return 'cancelled and awaited';
		}, {
			activity: async (ctx, attempt) => {
				if (attempt.input === 'block') {
					blockerStarted.resolve();
					if (!ctx.signal.aborted) {
						await new Promise<void>((resolve) => ctx.signal.addEventListener('abort', () => resolve(), { once: true }));
					}
					blockerStopped = true;
					return workflow.cancelled(ctx.signal.reason);
				}
				await blockerStarted.promise;
				return workflow.failed(primaryFailure);
			},
		});
		expect(output).toBe('cancelled and awaited');
	});

	it('returns one deterministic race winner and stops losing branches', async () => {
		const loserStarted = deferred();
		let loserStopped = false;
		const output = await runProgram(function* () {
			const winner = yield* workflow.race({ loser: operation('lose'), winner: operation('win') });
			expect(loserStopped).toBe(true);
			return `${String(winner.key)}:${String(winner.value)}`;
		}, {
			activity: async (ctx, attempt) => {
				if (attempt.input === 'lose') {
					loserStarted.resolve();
					if (!ctx.signal.aborted) {
						await new Promise<void>((resolve) => ctx.signal.addEventListener('abort', () => resolve(), { once: true }));
					}
					loserStopped = true;
					return workflow.cancelled(ctx.signal.reason);
				}
				await loserStarted.promise;
				return workflow.success('won');
			},
		});
		expect(output).toBe('winner:won');
	});

	it('preserves mapped output order and rejects duplicate keys before execution', async () => {
		let attempts = 0;
		const output = await runProgram(function* () {
			const values = yield* workflow.map([3, 1, 2], (value) => operation<number>(value), {
				concurrency: 2,
				key: (value) => String(value),
			});
			return values.join(',');
		}, {
			activity: async (_ctx, attempt) => {
				attempts++;
				return workflow.success(attempt.input);
			},
		});
		expect(output).toBe('3,1,2');
		expect(attempts).toBe(3);
		expect(() =>
			workflow.map([1, 1], (value) => operation(value), {
				concurrency: 1,
				key: (value) => String(value),
			})
		).toThrow(TypeError);
	});

	it('uses fresh workflow retry paths and does not retry provider faults', async () => {
		const paths: string[] = [];
		let attempt = 0;
		const output = await runProgram(function* () {
			return String(
				yield* workflow.retry(operation<string, failures.Occurrence<typeof TestFailure>>('retry'), {
					maximumAttempts: 3,
					key: 'verification',
				}),
			);
		}, {
			activity: async (_ctx, activityAttempt) => {
				paths.push(activityAttempt.origin.instructionPath);
				attempt++;
				return attempt < 3
					? workflow.failed(await expected({ attempt }, `failure ${attempt}`))
					: workflow.success('verified');
			},
		});
		expect(output).toBe('verified');
		expect(paths).toEqual([
			'test.workflow@1/verification:retry/attempt:1/0:activity',
			'test.workflow@1/verification:retry/attempt:2/0:activity',
			'test.workflow@1/verification:retry/attempt:3/0:activity',
		]);

		let faults = 0;
		await expect(runProgram(function* () {
			yield* workflow.retry(operation('fault'), { maximumAttempts: 3 });
			return 'unreachable';
		}, {
			activity: async () => {
				faults++;
				return workflow.fault(new Error('fault'));
			},
		})).rejects.toThrow(workflow.FaultError);
		expect(faults).toBe(1);
	});

	it('persists deterministic workflow retry delays as sleep instructions', async () => {
		const sleeps: string[] = [];
		let attempts = 0;
		const output = await runProgram(function* () {
			return yield* workflow.retry(operation<string, failures.Occurrence<typeof TestFailure>>('retry-me'), {
				maximumAttempts: 3,
				delay: 'PT0.1S',
				backoff: 2,
				maximumDelay: 'PT0.25S',
				jitter: 0,
			});
		}, {
			activity: async () => {
				attempts++;
				return attempts < 3
					? workflow.failed(await expected({ attempt: attempts }, `attempt ${attempts}`))
					: workflow.success('done');
			},
			command: async (_ctx, command) => {
				if (command.type !== 'sleep') return workflow.fault(new Error('unexpected command'));
				sleeps.push(command.duration.toString());
				return workflow.success(Temporal.Instant.from('2026-08-08T00:00:00Z'));
			},
		});
		expect(output).toBe('done');
		expect(sleeps).toEqual(['PT0.1S', 'PT0.2S']);
	});
});

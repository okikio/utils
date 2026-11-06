import * as codecs from '@okikio/schema/codec';
import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import * as context from '@okikio/context';
import * as task from '@okikio/task';
import * as requirement from '@okikio/capability/requirement';
import * as workflow from './mod.ts';
import { temporal } from '@okikio/duration/temporal';
import { AnySchema, operation, runProgram, TestActivity, TestEngine } from './fixtures/program.ts';

describe('durable workflow declarations', () => {
	it('runs relative and absolute timers without reading global time or disposal constructors', async () => {
		const descriptors = ['Temporal', 'AsyncDisposableStack', 'DisposableStack'].map((name) =>
			[name, Object.getOwnPropertyDescriptor(globalThis, name)] as const
		);
		for (const [name] of descriptors) {
			Object.defineProperty(globalThis, name, {
				configurable: true,
				get() {
					throw new Error(`Workflow must not read global ${name}.`);
				},
			});
		}
		try {
			const until = '2026-01-01T00:00:00Z';
			const result = await runProgram(function* () {
				yield* workflow.sleep('PT1S');
				return (yield* workflow.wait({ until })).toString();
			}, {
				async command(_ctx, command) {
					if (command.type === 'sleep') return workflow.success(temporal.Instant.from(until));
					if (command.type === 'sleep-until') return workflow.success(command.until);
					throw new Error('Unexpected timer command.');
				},
			});
			expect(result).toBe(until);
		} finally {
			for (const [name, descriptor] of descriptors) {
				if (descriptor === undefined) Reflect.deleteProperty(globalThis, name);
				else Object.defineProperty(globalThis, name, descriptor);
			}
		}
	});
	it('rejects accessor-backed durable operation maps without invoking getters', () => {
		let reads = 0;
		const operations = Object.create(null) as Record<string, unknown>;
		Object.defineProperty(operations, 'unsafe', {
			enumerable: true,
			get() {
				reads++;
				return operation('unsafe');
			},
		});
		expect(() => workflow.parallel(operations as never)).toThrow(TypeError);
		expect(reads).toBe(0);
	});

	it('rejects invalid durable annotation values', () => {
		expect(() => workflow.sleep({ seconds: 1 }, { annotations: { valid: true, invalid: Number.POSITIVE_INFINITY } }))
			.toThrow(TypeError);
	});

	it('rejects accessor-backed workflow definitions before reading identity', () => {
		let reads = 0;
		const input = Object.create(null) as Record<string, unknown>;
		Object.defineProperty(input, 'id', {
			enumerable: true,
			get() {
				reads++;
				return 'unsafe';
			},
		});
		Object.defineProperty(input, 'version', { value: '1', enumerable: true });
		Object.defineProperty(input, 'input', { value: AnySchema, enumerable: true });
		Object.defineProperty(input, 'result', { value: AnySchema, enumerable: true });
		expect(() => workflow.define(input as never)).toThrow(TypeError);
		expect(reads).toBe(0);
	});

	it('applies active activity requirements before engine placement', async () => {
		const policy = Object.freeze({ kind: 'test-policy', id: 'test.admit' });
		const gate = requirement.define({ family: 'test', action: 'require', definition: policy });
		const gated = Object.freeze(
			{ ...TestActivity, id: 'test.gated', requirements: Object.freeze([gate]) } satisfies workflow.ActivityReference,
		);
		const contract = workflow.define({
			id: 'test.gated-workflow',
			version: '1',
			input: codecs.identity(AnySchema),
			result: codecs.identity(AnySchema),
			activities: [gated],
		});
		const implementation = workflow.implement(contract, function* () {
			return yield* workflow.activity(gated, 'value');
		});
		await using parent = context.create({ id: 'test-admission', clock: new context.TestClock() });
		await using ctx = await workflow.context({
			definition: contract,
			runId: 'test-admission-run',
			input: {},
			ctx: parent,
		});
		let placed = 0;
		await using scheduler = workflow.scheduler({
			requirements: {
				interpreters: {
					test: {
						async apply() {
							throw new Error('denied before placement');
						},
					},
				},
			},
		});
		await using registration = await scheduler.register({
			engine: TestEngine,
			hostId: 'test-host',
			provider: {
				activities: [gated],
				async run() {
					placed += 1;
					return workflow.success('unexpected');
				},
			},
		});
		void registration;
		await expect(workflow.run({ ctx, implementation, scheduler })).rejects.toThrow('denied before placement');
		expect(placed).toBe(0);
	});

	it('keeps local Task lifecycle outside the durable workflow contract', async () => {
		const events: string[] = [];
		await using work = task.start(async (ctx) => {
			ctx.defer(() => void events.push('deferred'));
			ctx.use({
				async [Symbol.asyncDispose]() {
					events.push('resource');
				},
			});
			return 7;
		}, { id: 'workflow-test-task' });
		expect(await work.done).toBe(7);
		expect(work.status).toBe('completed');
		expect(events).toEqual(['resource', 'deferred']);
	});

	it('snapshots activity affinity before it becomes durable placement identity', () => {
		const affinity: { region: string; weight: number } = { region: 'east', weight: 1 };
		const value = workflow.activity(TestActivity, 'input', { affinity });
		affinity.region = 'west';
		affinity.weight = 2;
		const step = value[Symbol.iterator]().next();
		expect(step.done).toBe(false);
		if (!step.done && step.value.type === 'activity') {
			expect(step.value.options.affinity).toEqual({ region: 'east', weight: 1 });
			expect(Object.isFrozen(step.value.options.affinity)).toBe(true);
		}
	});

	it('rejects non-scalar activity affinity values', () => {
		expect(() => workflow.activity(TestActivity, 'input', { affinity: { region: Number.POSITIVE_INFINITY } })).toThrow(
			'finite number',
		);
	});

	it('creates lazy activity instructions without starting external work', () => {
		const value = operation({ value: 1 }, 'operation:one');
		const step = value[Symbol.iterator]().next();
		expect(step.done).toBe(false);
		if (!step.done) {
			expect(step.value).toMatchObject({
				category: 'command',
				type: 'activity',
				key: 'operation:one',
				input: { value: 1 },
			});
		}
	});

	it('snapshots durable instruction data without executing or losing caller state', () => {
		const negativeZero = operation(-0)[Symbol.iterator]().next();
		if (negativeZero.done) throw new Error('Expected an activity instruction.');
		if (negativeZero.value.type !== 'activity') throw new Error('Expected an activity instruction.');
		expect(negativeZero.value.input).toBe(0);
		expect(Object.is(negativeZero.value.input, -0)).toBe(false);

		const sparse = new Array<unknown>(1);
		expect(() => operation(sparse)).toThrow(TypeError);

		const extended: unknown[] = ['kept'];
		Object.defineProperty(extended, 'note', { value: 'would be dropped', enumerable: true });
		expect(() => operation(extended)).toThrow(TypeError);

		let reads = 0;
		const accessor = Object.create(null) as Record<string, unknown>;
		Object.defineProperty(accessor, 'unsafe', {
			enumerable: true,
			get() {
				reads += 1;
				return 'executed';
			},
		});
		expect(() => operation(accessor)).toThrow(TypeError);
		expect(reads).toBe(0);
	});

	it('rejects non-durable input before an instruction can enter history', () => {
		expect(() => operation(new Date('2026-01-01T00:00:00Z'))).toThrow(TypeError);
		expect(() => operation({ callback: () => undefined })).toThrow(TypeError);
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		expect(() => operation(cyclic)).toThrow(TypeError);
		expect(() => workflow.continue(Promise.resolve('not durable'))).toThrow(TypeError);
	});

	it('creates stable instruction fingerprints and exposes origin identity to providers', async () => {
		const firstStep = operation({ b: 2, a: 1 }, 'stable')[Symbol.iterator]().next();
		const secondStep = operation({ a: 1, b: 2 }, 'stable')[Symbol.iterator]().next();
		if (firstStep.done || secondStep.done) throw new Error('Expected activity instructions.');
		const first = await workflow.identify(firstStep.value, 'test.workflow@1/stable:activity');
		const second = await workflow.identify(secondStep.value, 'test.workflow@1/stable:activity');
		expect(first.fingerprint).toBe(second.fingerprint);
		expect(first.description.payload).toMatchObject({ activity: { id: 'test.operation', version: '1' } });

		let origin: workflow.ActivityOriginType | undefined;
		const output = await runProgram(function* () {
			return yield* operation<string>('value', 'stable');
		}, {
			activity: async (_ctx, attempt) => {
				origin = attempt.origin;
				return workflow.success(attempt.input);
			},
		});
		expect(output).toBe('value');
		expect(origin?.instructionPath).toBe('test.workflow@1/stable:activity');
		expect(origin?.instructionFingerprint.length).toBe(64);
	});

	it('rejects duplicate explicit instruction keys in one program scope', async () => {
		await expect(runProgram(function* () {
			yield* operation('first', 'same');
			yield* operation('second', 'same');
			return 'unreachable';
		})).rejects.toThrow(TypeError);
	});
});

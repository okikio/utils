/** Reusable feedback policy and joined ownership, independent of browser hardware availability. @module */
import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { ms } from '@okikio/duration';
import { SuppressedError } from '@okikio/dispose';
import * as feedback from './feedback.ts';

/** A real EventTarget graph with deterministic ended delivery; no wall-clock or autoplay policy is simulated. */
function audio() {
	const amplitudes: number[] = [];
	let allocations = 0;
	let disconnected = 0;
	const host: feedback.AudioHost = Object.assign(new EventTarget(), {
		state: 'running',
		currentTime: 1,
		destination: {},
		createOscillator() {
			allocations++;
			const oscillator = Object.assign(new EventTarget(), {
				type: 'sine' as const,
				frequency: { setValueAtTime() {} },
				connect() {},
				disconnect() {
					disconnected++;
				},
				start() {
					queueMicrotask(() => oscillator.dispatchEvent(new Event('ended')));
				},
				stop() {},
			});
			return oscillator;
		},
		createGain() {
			return {
				gain: {
					setValueAtTime(value: number) {
						amplitudes.push(value);
					},
					linearRampToValueAtTime(value: number) {
						amplitudes.push(value);
					},
				},
				connect() {},
				disconnect() {
					disconnected++;
				},
			};
		},
	});
	return {
		host,
		amplitudes,
		get allocations() {
			return allocations;
		},
		get disconnected() {
			return disconnected;
		},
	};
}

describe('reusable feedback definitions', () => {
	it('copies mutable inputs, normalizes duration and reuses an immutable definition', () => {
		const pattern = [ms(5), ms(10)];
		const options = { vibration: pattern, tone: { gain: 0.2 } };
		const cue = feedback.define(options);
		pattern.length = 0;
		options.tone.gain = 0.9;
		expect(cue.vibration).toEqual([5, 10]);
		expect(cue.tone?.gain).toBe(0.2);
		expect(Object.isFrozen(cue)).toBe(true);
		expect(Object.isFrozen(cue.tone)).toBe(true);
		expect(Object.isFrozen(cue.vibration)).toBe(true);
		expect(feedback.define(cue)).toBe(cue);
	});

	it('rejects malformed or unbounded effects before acquiring a host', () => {
		expect(() => feedback.define({ vibration: Array(129).fill(0) })).toThrow(RangeError);
		expect(() => feedback.define({ vibration: [40_000, 40_000] })).toThrow(RangeError);
		expect(() => feedback.define({ tone: { frequency: 0 } })).toThrow();
		expect(() => feedback.define({ rumble: { strong: 2 } })).toThrow();
		expect(() => feedback.define({ brightness: { duration: -1 } })).toThrow(RangeError);
		expect(() => Reflect.apply(feedback.define, undefined, [{ vibraton: [10] }])).toThrow('Unknown cue setting');
		expect(() => Reflect.apply(feedback.define, undefined, [{ tone: { volum: 0.2 } }])).toThrow('Unknown cue setting');
	});

	it('round trips normalized settings and applies the combined vibration bound after loading', () => {
		const original = feedback.define({ message: 'Saved', vibration: [ms(10)], tone: { duration: ms(20) } });
		const persisted: unknown = JSON.parse(JSON.stringify(original));
		expect(feedback.define(feedback.CueSchema.parse(persisted))).toEqual(original);
		expect(() =>
			feedback.CueSchema.parse({ tone: { duration: 10, frequency: 440, gain: 0.1, wave: 'sine', muted: true } })
		).toThrow();
		const excessive = feedback.CueSchema.parse({ vibration: [40_000, 40_000] });
		expect(() => feedback.define(excessive)).toThrow(RangeError);
	});
});

describe('interaction feedback policy', () => {
	it('keeps native event dispatch and status text when optional effects are disabled', async () => {
		const button = new EventTarget();
		const messages: string[] = [];
		let acquisitions = 0;
		await using player = feedback.create({
			status: {
				announce(message) {
					messages.push(message);
				},
			},
			visual: {
				animate() {
					acquisitions++;
					throw new Error('Disabled animation was acquired.');
				},
			},
		});
		const completed = Promise.withResolvers<feedback.CueResult>();
		const cue = feedback.define({ message: 'Saved', brightness: {} });
		button.addEventListener('click', () => {
			void player.play(cue, { enabled: false }).then(completed.resolve, completed.reject);
		}, { once: true });
		expect(button.dispatchEvent(new Event('click'))).toBe(true);
		expect(await completed.promise).toEqual({
			announced: true,
			brightness: { status: 'unavailable', reason: 'disabled' },
		});
		expect(messages).toEqual(['Saved']);
		expect(acquisitions).toBe(0);
	});

	it('reports missing devices separately and samples mute/volume on each play', async () => {
		const graph = audio();
		await using player = feedback.create({ audio: graph.host });
		const cue = feedback.define({ tone: { gain: 0.4 }, rumble: {}, vibration: [0] });
		const muted = await player.play(cue, { muted: true });
		expect(muted.tone).toEqual({ status: 'unavailable', reason: 'muted' });
		expect(muted.rumble).toEqual({ status: 'unavailable', reason: 'unsupported' });
		expect(muted.vibration).toEqual({ status: 'unavailable', reason: 'unsupported' });
		expect(graph.allocations).toBe(0);
		expect((await player.play(cue, { volume: 0.5 })).tone).toEqual({ status: 'completed' });
		expect(graph.amplitudes).toContain(0.2);
		expect(graph.disconnected).toBe(2);
		expect((await player.play(cue, { volume: 0 })).tone).toEqual({ status: 'unavailable', reason: 'muted' });
		expect(graph.host.state).toBe('running');
	});

	it('respects reduced motion without allocating an animation', async () => {
		let acquired = false;
		await using player = feedback.create({
			visual: {
				animate() {
					acquired = true;
					throw new Error('Motion should be disabled.');
				},
			},
		});
		expect((await player.play(feedback.define({ brightness: {} }), { reducedMotion: true })).brightness)
			.toEqual({ status: 'unavailable', reason: 'reduced-motion' });
		expect(acquired).toBe(false);
	});
});

describe('feedback playback ownership', () => {
	it('waits for a superseded actuator reset before starting its successor', async () => {
		const started = Promise.withResolvers<void>();
		const stopping = Promise.withResolvers<void>();
		const released = Promise.withResolvers<void>();
		let starts = 0;
		await using player = feedback.create({
			rumble: {
				playEffect() {
					starts++;
					started.resolve();
					return starts === 1 ? new Promise<'complete'>(() => {}) : Promise.resolve('complete' as const);
				},
				reset() {
					stopping.resolve();
					return released.promise;
				},
			},
		});
		const cue = feedback.define({ rumble: {} });
		const first = Promise.allSettled([player.play(cue)]);
		await started.promise;
		const second = player.play(cue);
		await stopping.promise;
		expect(starts).toBe(1);
		released.resolve();
		expect((await first)[0]).toMatchObject({
			status: 'rejected',
			reason: { name: 'AbortError', message: 'Feedback playback superseded.' },
		});
		expect((await second).rumble).toEqual({ status: 'completed' });
		expect(starts).toBe(2);
	});

	it('preserves an exact abort reason and joins animation cleanup before disposal returns', async () => {
		const started = Promise.withResolvers<void>();
		let cancellations = 0;
		const player = feedback.create({
			visual: {
				animate() {
					started.resolve();
					return {
						finished: new Promise(() => {}),
						cancel() {
							cancellations++;
						},
					};
				},
			},
		});
		const controller = new AbortController();
		const pending = Promise.allSettled([
			player.play(feedback.define({ brightness: {} }), { signal: controller.signal }),
		]);
		await started.promise;
		controller.abort(null);
		expect(await pending).toEqual([{ status: 'rejected', reason: null }]);
		await player.disposeAsync();
		await player.disposeAsync();
		expect(cancellations).toBe(1);
		expect(player.closed).toBe(true);
		await expect(player.play({})).rejects.toThrow('closed');
	});

	it('prevents reentrant status updates from allocating effects for the older play', async () => {
		let successor: Promise<feedback.CueResult> | undefined;
		let acquisitions = 0;
		const player = feedback.create({
			status: {
				announce() {
					successor = player.play({});
				},
			},
			visual: {
				animate() {
					acquisitions++;
					return { finished: Promise.resolve(), cancel() {} };
				},
			},
		});
		await expect(player.play({ message: 'Saved', brightness: {} })).rejects.toThrow('superseded');
		expect(await successor).toEqual({ announced: false });
		expect(acquisitions).toBe(0);
		await player.disposeAsync();
	});

	it('does not allocate effects on a pre-aborted call or dispose the borrowed announcer', async () => {
		let announcements = 0;
		let disposals = 0;
		const status = {
			announce() {
				announcements++;
			},
			dispose() {
				disposals++;
			},
		};
		const player = feedback.create({ status });
		await expect(player.play({ message: 'Saved' }, { signal: AbortSignal.abort('stop') })).rejects.toBe('stop');
		expect(announcements).toBe(0);
		await player.disposeAsync();
		status.announce();
		expect(announcements).toBe(1);
		expect(disposals).toBe(0);
	});

	it('joins an earlier asynchronous reset when disposal cancels a queued successor', async () => {
		const started = Promise.withResolvers<void>();
		const stopping = Promise.withResolvers<void>();
		const released = Promise.withResolvers<void>();
		let starts = 0;
		const player = feedback.create({
			rumble: {
				playEffect() {
					starts++;
					started.resolve();
					return new Promise<'complete'>(() => {});
				},
				reset() {
					stopping.resolve();
					return released.promise;
				},
			},
		});
		const first = Promise.allSettled([player.play({ rumble: {} })]);
		await started.promise;
		const second = Promise.allSettled([player.play({ rumble: {} })]);
		await stopping.promise;
		let closed = false;
		const closing = player.disposeAsync().then(() => {
			closed = true;
		});
		await Promise.resolve();
		expect(player.closed).toBe(true);
		expect(closed).toBe(false);
		expect(starts).toBe(1);
		released.resolve();
		await closing;
		expect((await first)[0]?.status).toBe('rejected');
		expect((await second)[0]).toMatchObject({
			status: 'rejected',
			reason: { name: 'AbortError', message: 'Feedback player closed.' },
		});
		expect(closed).toBe(true);
		expect(starts).toBe(1);
	});

	it('cancels siblings on a host error and retains failed sibling cleanup', async () => {
		const failed = new Error('Animation acquisition failed.');
		const reset = new Error('Actuator reset failed.');
		let resets = 0;
		await using player = feedback.create({
			rumble: {
				playEffect: () => new Promise<'complete'>(() => {}),
				reset() {
					resets++;
					return Promise.reject(reset);
				},
			},
			visual: {
				animate() {
					throw failed;
				},
			},
		});
		const [outcome] = await Promise.allSettled([player.play({ rumble: {}, brightness: {} })]);
		expect(resets).toBe(1);
		expect(outcome?.status).toBe('rejected');
		if (outcome?.status !== 'rejected') throw new Error('Expected the playback to reject.');
		expect(outcome.reason).toBeInstanceOf(AggregateError);
		const errors: unknown[] = outcome.reason.errors;
		expect(errors).toContain(failed);
		const cleanup = errors.find((error) => error instanceof SuppressedError);
		expect(cleanup).toBeInstanceOf(SuppressedError);
		if (!(cleanup instanceof SuppressedError)) throw new Error('Expected a preserved cleanup failure.');
		expect(cleanup.error).toBe(reset);
		expect(cleanup.suppressed).toBe(failed);
		expect(await player.play({})).toEqual({ announced: false });
	});
});

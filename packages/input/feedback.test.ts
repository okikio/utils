import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as feedback from './feedback.ts';
import { ms } from '@okikio/duration';
import { SuppressedError } from '@okikio/dispose';
import type { ListenerTarget } from './types.ts';

/** Event hub models observable ownership without assuming a Document or realm constructor. */
class Hub implements ListenerTarget {
	readonly listeners = new Map<string, Set<(event: unknown) => void>>();
	addEventListener(type: string, listener: (event: unknown) => void): void {
		const group = this.listeners.get(type) ?? new Set();
		group.add(listener);
		this.listeners.set(type, group);
	}
	removeEventListener(type: string, listener: (event: unknown) => void): void {
		this.listeners.get(type)?.delete(listener);
	}
	emit(type: string): void {
		for (const listener of this.listeners.get(type) ?? []) listener({ type });
	}
	get count(): number {
		return [...this.listeners.values()].reduce((sum, group) => sum + group.size, 0);
	}
}

/** Manual time makes supersession tests independent of machine load and preserves the method receiver. */
class Clock {
	readonly pending: Array<{ duration: number; resolve(): void }> = [];
	sleep(duration: number): Promise<void> {
		const deferred = Promise.withResolvers<void>();
		this.pending.push({ duration, resolve: deferred.resolve });
		return deferred.promise;
	}
}

/** A mock audio graph exposes exactly the allocations and nodes that a cue owns. */
function audioGraph() {
	const log: string[] = [];
	const oscillator = Object.assign(new Hub(), {
		type: 'sine' as feedback.Oscillator['type'],
		frequency: {
			setValueAtTime(value: number, time: number) {
				log.push(`frequency:${value}:${time}`);
			},
		},
		connect(_destination: unknown) {
			log.push('oscillator-connect');
		},
		disconnect() {
			log.push('oscillator-disconnect');
		},
		start(time?: number) {
			log.push(`start:${time}`);
		},
		stop(time?: number) {
			log.push(`stop:${time ?? 'now'}`);
		},
	});
	const gain: feedback.Gain = {
		gain: { setValueAtTime() {}, linearRampToValueAtTime() {} },
		connect() {
			log.push('gain-connect');
		},
		disconnect() {
			log.push('gain-disconnect');
		},
	};
	const host = Object.assign(new Hub(), {
		state: 'running',
		currentTime: 2,
		destination: {},
		createOscillator() {
			log.push('oscillator-create');
			return oscillator;
		},
		createGain() {
			log.push('gain-create');
			return gain;
		},
	});
	return { host, oscillator, gain, log };
}

describe('feedback capability and ownership', () => {
	describe('capability admission', () => {
		it('reports missing capabilities without disguising cancellation or malformed values', async () => {
			expect(await feedback.vibrate(undefined, 20)).toEqual({ status: 'unavailable', reason: 'unsupported' });
			expect(await feedback.rumble(undefined)).toEqual({ status: 'unavailable', reason: 'unsupported' });
			expect(await feedback.tone(undefined)).toEqual({ status: 'unavailable', reason: 'unsupported' });
			expect(await feedback.light(undefined)).toEqual({ status: 'unavailable', reason: 'unsupported' });
			const [aborted] = await Promise.allSettled([
				feedback.vibrate(undefined, 20, { signal: AbortSignal.abort(null) }),
			]);
			expect(aborted).toEqual({ status: 'rejected', reason: null });
			await expect(feedback.vibrate(undefined, Array(129).fill(0))).rejects.toThrow(RangeError);
			await expect(feedback.vibrate(undefined, [40_000, 40_000])).rejects.toThrow(RangeError);
			await expect(feedback.rumble(undefined, { strong: 2 })).rejects.toThrow(RangeError);
		});
	});

	describe('vibration lifetime', () => {
		it('uses named durations and the supplied clock receiver while distinguishing acceptance from elapsed time', async () => {
			const calls: Array<number | number[]> = [];
			const clock = new Clock();
			const playing = feedback.vibrate(
				{
					vibrate(pattern) {
						calls.push(pattern);
						return true;
					},
				},
				[ms(0.5), ms(4), ms(5)],
				{ clock },
			);
			expect(calls).toEqual([[1, 4, 5]]);
			expect(clock.pending[0]!.duration).toBe(10);
			clock.pending[0]!.resolve();
			expect(await playing).toEqual({ status: 'elapsed' });
			expect(calls).toHaveLength(1);
			expect(
				await feedback.vibrate({
					vibrate() {
						return false;
					},
				}, 10),
			).toEqual({ status: 'unavailable', reason: 'denied' });
		});

		it('does not let an older abort stop a newer vibration, and observes late clock settlement', async () => {
			const clock = new Clock();
			const calls: Array<number | number[]> = [];
			const host = {
				vibrate(pattern: number | number[]) {
					calls.push(pattern);
					return true;
				},
			};
			const older = new AbortController();
			const newer = new AbortController();
			const first = feedback.vibrate(host, 10, { signal: older.signal, clock });
			const second = feedback.vibrate(host, 20, { signal: newer.signal, clock });
			const secondOutcome = Promise.allSettled([second]);
			expect(await first).toEqual({ status: 'preempted' });
			older.abort('late');
			expect(calls).toEqual([[10], [20]]);
			newer.abort(null);
			expect(await secondOutcome).toEqual([{ status: 'rejected', reason: null }]);
			expect(calls).toEqual([[10], [20], 0]);
			for (const pending of clock.pending) pending.resolve();
		});

		it('stops a borrowed vibration when the selected clock fails after acquisition', async () => {
			const failure = new Error('clock stopped');
			const calls: Array<number | number[]> = [];
			const host = {
				vibrate(pattern: number | number[]) {
					calls.push(pattern);
					return true;
				},
			};
			const [result] = await Promise.allSettled([feedback.vibrate(host, 30, {
				clock: { sleep: () => Promise.reject(failure) },
			})]);
			expect(result).toEqual({ status: 'rejected', reason: failure });
			expect(calls).toEqual([[30], 0]);
		});

		it('rejects cancellation queued between native completion and async operation settlement', async () => {
			const controller = new AbortController();
			const cue = feedback.vibrate({ vibrate: () => true }, 1, {
				signal: controller.signal,
				clock: { sleep: () => Promise.resolve() },
			});
			const settled = Promise.allSettled([cue]);
			queueMicrotask(() => controller.abort(null));
			expect(await settled).toEqual([{ status: 'rejected', reason: null }]);
		});
	});

	describe('gamepad actuator ownership', () => {
		it('preserves gamepad completion and only resets the active actuator request', async () => {
			const plays: Array<ReturnType<typeof Promise.withResolvers<'complete' | 'preempted'>>> = [];
			let resets = 0;
			const host: feedback.HapticHost = {
				effects: ['dual-rumble'],
				playEffect(type, params) {
					expect(type).toBe('dual-rumble');
					expect(params.duration).toBe(100);
					const play = Promise.withResolvers<'complete' | 'preempted'>();
					plays.push(play);
					return play.promise;
				},
				reset() {
					resets++;
					return Promise.resolve();
				},
			};
			const first = feedback.rumble(host);
			const second = feedback.rumble(host);
			expect(await first).toEqual({ status: 'preempted' });
			plays[0]!.reject(new Error('late disconnect'));
			plays[1]!.resolve('complete');
			expect(await second).toEqual({ status: 'completed' });
			expect(resets).toBe(0);
			const controller = new AbortController();
			const third = Promise.allSettled([feedback.rumble(host, { signal: controller.signal })]);
			controller.abort('released');
			expect(await third).toEqual([{ status: 'rejected', reason: 'released' }]);
			expect(resets).toBe(1);
			plays[2]!.resolve('preempted');
		});

		it('retains both an abort reason and a failed actuator reset', async () => {
			const controller = new AbortController();
			const resetFailure = new Error('reset failed');
			const settled = Promise.allSettled([feedback.rumble({
				playEffect: () => new Promise(() => {}),
				reset: () => Promise.reject(resetFailure),
			}, { signal: controller.signal })]);
			controller.abort(null);
			const [result] = await settled;
			expect(result.status).toBe('rejected');
			if (result.status === 'rejected') {
				expect(result.reason).toBeInstanceOf(SuppressedError);
				expect(result.reason.error).toBe(resetFailure);
				expect(result.reason.suppressed).toBe(null);
			}
		});

		it('joins a prior async reset before any newer cue, including a superseded waiter, can play', async () => {
			const resetStarted = Promise.withResolvers<void>();
			const resetFinished = Promise.withResolvers<void>();
			const nextPlayed = Promise.withResolvers<void>();
			const calls: string[] = [];
			let finishPlay: (() => void) | undefined;
			const host: feedback.HapticHost = {
				playEffect() {
					calls.push('play');
					if (calls.includes('reset-end')) nextPlayed.resolve();
					const playing = Promise.withResolvers<'complete' | 'preempted'>();
					finishPlay = () => playing.resolve('complete');
					return playing.promise;
				},
				async reset() {
					calls.push('reset-start');
					resetStarted.resolve();
					await resetFinished.promise;
					calls.push('reset-end');
				},
			};
			const firstController = new AbortController();
			const first = Promise.allSettled([feedback.rumble(host, { signal: firstController.signal })]);
			firstController.abort('first stopped');
			await resetStarted.promise;
			const waiterController = new AbortController();
			const waiter = Promise.allSettled([feedback.rumble(host, { signal: waiterController.signal })]);
			waiterController.abort('waiter stopped');
			const last = feedback.rumble(host);
			await Promise.resolve();
			expect(calls).toEqual(['play', 'reset-start']);
			resetFinished.resolve();
			await first;
			await waiter;
			await nextPlayed.promise;
			expect(calls).toEqual(['play', 'reset-start', 'reset-end', 'play']);
			finishPlay!();
			expect(await last).toEqual({ status: 'completed' });
			expect(await first).toEqual([{ status: 'rejected', reason: 'first stopped' }]);
			expect(await waiter).toEqual([{ status: 'rejected', reason: 'waiter stopped' }]);
		});
	});

	describe('borrowed audio graphs', () => {
		it('plays an amplitude-shaped tone then releases its graph without closing the borrowed context', async () => {
			const { host, oscillator, log } = audioGraph();
			const cue = feedback.tone(host, { duration: ms(100), frequency: 880 });
			expect(log).toContain('frequency:880:2');
			expect(log).toContain('stop:2.1');
			oscillator.emit('ended');
			expect(await cue).toEqual({ status: 'completed' });
			expect(log.slice(-3)).toEqual(['stop:now', 'gain-disconnect', 'oscillator-disconnect']);
			expect(host.count + oscillator.count).toBe(0);
			expect(host.state).toBe('running');
		});

		it('refuses a suspended context and cleans audio nodes after cancellation or partial acquisition', async () => {
			const { host, oscillator, log } = audioGraph();
			host.state = 'suspended';
			expect(await feedback.tone(host)).toEqual({ status: 'unavailable', reason: 'inactive' });
			expect(log).toHaveLength(0);
			host.state = 'running';
			const controller = new AbortController();
			const cue = Promise.allSettled([feedback.tone(host, { signal: controller.signal })]);
			controller.abort(null);
			expect(await cue).toEqual([{ status: 'rejected', reason: null }]);
			expect(host.count + oscillator.count).toBe(0);
			const failure = new Error('gain unavailable');
			host.createGain = () => {
				throw failure;
			};
			const [failed] = await Promise.allSettled([feedback.tone(host)]);
			expect(failed).toEqual({ status: 'rejected', reason: failure });
			expect(log.at(-1)).toBe('oscillator-disconnect');
		});

		it('does not hang a cue when its audio context is suspended during playback', async () => {
			const { host, oscillator, log } = audioGraph();
			const cue = feedback.tone(host);
			host.state = 'suspended';
			host.emit('statechange');
			await expect(cue).rejects.toMatchObject({ name: 'InvalidStateError' });
			expect(log).toContain('stop:now');
			expect(host.count + oscillator.count).toBe(0);
		});

		it('stops a structural oscillator that begins playback before its start call throws', async () => {
			const { host, oscillator } = audioGraph();
			const failure = new Error('partial start');
			let running = false;
			oscillator.start = () => {
				running = true;
				throw failure;
			};
			oscillator.stop = () => {
				running = false;
			};
			const [result] = await Promise.allSettled([feedback.tone(host)]);
			expect(result).toEqual({ status: 'rejected', reason: failure });
			expect(running).toBe(false);
			expect(host.count + oscillator.count).toBe(0);
		});

		it('retains an undefined start failure and every stop or graph-release failure in disposal order', async () => {
			const { host, oscillator, gain } = audioGraph();
			const stopped = new Error('stop failed');
			const disconnected = new Error('oscillator disconnect failed');
			const attempts: string[] = [];
			oscillator.start = () => {
				throw undefined;
			};
			oscillator.stop = () => {
				attempts.push('stop');
				throw stopped;
			};
			gain.disconnect = () => {
				attempts.push('gain');
				throw null;
			};
			oscillator.disconnect = () => {
				attempts.push('oscillator');
				throw disconnected;
			};
			const [result] = await Promise.allSettled([feedback.tone(host)]);
			expect(result.status).toBe('rejected');
			if (result.status === 'rejected') {
				expect(result.reason).toBeInstanceOf(SuppressedError);
				expect(result.reason.suppressed).toBe(undefined);
				expect(result.reason.error).toMatchObject({
					suppressed: stopped,
					error: { error: disconnected, suppressed: null },
				});
			}
			expect(attempts).toEqual(['stop', 'gain', 'oscillator']);
			expect(host.count + oscillator.count).toBe(0);
		});
	});

	describe('element animation', () => {
		it('respects the borrowed element window and cancels only its own finite animation', async () => {
			const animations: Array<{ done: ReturnType<typeof Promise.withResolvers<void>>; cancelled: number }> = [];
			const host: feedback.VisualHost = {
				ownerDocument: { defaultView: { matchMedia: () => ({ matches: true }) } },
				animate(frames, options) {
					expect(frames).toHaveLength(3);
					expect(options).toEqual({ duration: 160, easing: 'ease-out', iterations: 1, fill: 'none' });
					const animation = { done: Promise.withResolvers<void>(), cancelled: 0 };
					animations.push(animation);
					return {
						finished: animation.done.promise,
						cancel() {
							animation.cancelled++;
						},
					};
				},
			};
			expect(await feedback.rotate(host)).toEqual({ status: 'unavailable', reason: 'reduced-motion' });
			expect(animations).toHaveLength(0);
			const older = new AbortController();
			const first = Promise.allSettled([feedback.rotate(host, 6, { reducedMotion: false, signal: older.signal })]);
			const second = feedback.brightness(host, 1.1, { reducedMotion: false });
			older.abort('replaced');
			expect(await first).toEqual([{ status: 'rejected', reason: 'replaced' }]);
			expect(animations.map((entry) => entry.cancelled)).toEqual([1, 0]);
			animations[1]!.done.resolve();
			expect(await second).toEqual({ status: 'completed' });
			expect(animations.map((entry) => entry.cancelled)).toEqual([1, 1]);
			animations[0]!.done.reject('late native cancellation');
		});
	});

	describe('live-region text ownership', () => {
		it('writes plain live-region text, restores owned values, and preserves external updates', () => {
			const attributes = new Map([['aria-live', 'off']]);
			const region: feedback.LiveRegion = {
				textContent: 'Ready',
				getAttribute: (key) => attributes.get(key) ?? null,
				setAttribute: (key, value) => {
					attributes.set(key, value);
				},
				removeAttribute: (key) => {
					attributes.delete(key);
				},
			};
			const first = feedback.announcer(region);
			first.announce('<b>Saved</b>');
			expect(region.textContent).toBe('<b>Saved</b>');
			expect(attributes.get('aria-live')).toBe('polite');
			first.dispose();
			first.dispose();
			expect(region.textContent).toBe('Ready');
			expect([...attributes]).toEqual([['aria-live', 'off']]);
			expect(() => first.announce('too late')).toThrow(TypeError);
			const controller = new AbortController();
			const second = feedback.announcer(region, { signal: controller.signal });
			second.announce('Saved');
			region.textContent = 'Application updated';
			attributes.set('aria-live', 'assertive');
			controller.abort();
			expect(region.textContent).toBe('Application updated');
			expect(attributes.get('aria-live')).toBe('assertive');
			expect(second.closed).toBe(true);
		});

		it('joins a structural text setter that aborts before committing its write', () => {
			for (const action of ['announce', 'clear'] as const) {
				const controller = new AbortController();
				const attributes = new Map<string, string>();
				let text = 'Ready';
				let abortDuringWrite = false;
				const region: feedback.LiveRegion = {
					get textContent() {
						return text;
					},
					set textContent(value) {
						if (abortDuringWrite) controller.abort();
						text = value!;
					},
					getAttribute: (name) => attributes.get(name) ?? null,
					setAttribute: (name, value) => {
						attributes.set(name, value);
					},
					removeAttribute: (name) => {
						attributes.delete(name);
					},
				};
				const status = feedback.announcer(region, { signal: controller.signal });
				status.announce('Saved');
				abortDuringWrite = true;
				if (action === 'announce') status.announce('Updated');
				else status.clear();
				expect(status.closed).toBe(true);
				expect(text).toBe('Ready');
				expect(attributes.size).toBe(0);
			}
		});
	});
});

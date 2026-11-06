import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as gestures from './gestures.ts';
import { Surface } from './fixtures/target.ts';

describe('geometric interaction', () => {
	it('distinguishes a click from a drag and releases capture before terminal feedback', () => {
		const target = new Surface();
		const seen: gestures.Drag[] = [];
		let time = 0;
		using _stop = gestures.drag(target, (sample) => {
			if (sample.phase === 'end') expect(target.releases).toEqual([1, 1]);
			seen.push(sample);
		}, { capture: true, now: () => time });
		target.point('pointerdown', 0);
		target.point('pointerup', 2);
		expect(seen).toEqual([]);
		target.point('pointerdown', 10);
		time = 20;
		target.point('pointermove', 20);
		time = 40;
		target.point('pointermove', 30);
		target.point('pointerup', 40);
		expect(seen.map(({ phase }) => phase)).toEqual(['start', 'move', 'end']);
		expect(seen[1]).toMatchObject({
			delta: { x: 20, y: 0 },
			position: { x: 30, y: 0 },
			elapsed: 40,
			velocity: { x: 0.5, y: 0 },
		});
	});

	it('reports physical swipe direction for mouse, pen and touch without cancelling defaults', () => {
		const target = new Surface();
		const directions: string[] = [];
		using _stop = gestures.swipe(target, (sample) => directions.push(sample.direction), { now: () => 0 });
		for (const pointerType of ['mouse', 'pen', 'touch']) {
			expect(target.emit('pointerdown', { pointerId: 1, pointerType, clientX: 100, clientY: 0 }).defaultPrevented).toBe(
				false,
			);
			target.emit('pointerup', { pointerId: 1, pointerType, clientX: 0, clientY: 0 });
		}
		expect(directions).toEqual(['left', 'left', 'left']);
		target.point('pointerdown', 100);
		target.point('pointercancel', 0);
		expect(directions).toHaveLength(3);
	});

	it('owns one hold timer and cancels it when the contact drifts or the owner closes', async () => {
		const target = new Surface();
		let held = 0;
		using stop = gestures.press(target, () => {
			held++;
		}, { duration: 5, distance: 2 });
		target.point('pointerdown', 0);
		target.point('pointermove', 3);
		await new Promise((resolve) => setTimeout(resolve, 12));
		expect(held).toBe(0);
		target.point('pointerup', 3);
		target.point('pointerdown', 0);
		await new Promise((resolve) => setTimeout(resolve, 12));
		expect(held).toBe(1);
		target.point('pointerup', 0);
		target.point('pointerdown', 0);
		stop();
		await new Promise((resolve) => setTimeout(resolve, 12));
		expect(held).toBe(1);
		expect(target.size).toBe(0);
	});

	it('measures pinch, translation and continuous rotation while retaining only two contacts', () => {
		const target = new Surface();
		const seen: gestures.Transform[] = [];
		using _stop = gestures.transform(target, (sample) => seen.push(sample), { capture: true });
		target.point('pointerdown', 0, 0, 1);
		target.point('pointerdown', 10, 0, 2);
		target.point('pointermove', 0, 20, 2);
		expect(seen[0]).toMatchObject({ phase: 'start', scale: 1, rotation: 0 });
		expect(seen[1]).toMatchObject({
			phase: 'move',
			scale: 2,
			rotation: 90,
			center: { x: 0, y: 10 },
			translation: { x: -5, y: 10 },
		});
		target.point('pointerdown', 20, 20, 3);
		expect(seen.at(-1)).toMatchObject({ phase: 'cancel', reason: 'multiple-pointers' });
		expect(target.releases).toEqual([1, 2]);
		target.point('pointerup', 0, 0, 1);
		target.point('pointerup', 0, 20, 2);
		target.point('pointerup', 20, 20, 3);
		target.point('pointerdown', 0, 0, 1);
		target.point('pointerdown', -10, 1, 2);
		target.point('pointermove', -10, -1, 2);
		expect(seen.at(-1)!.rotation).toBeGreaterThan(0);
		expect(seen.at(-1)!.rotation).toBeLessThan(20);
	});

	it('releases both captures if the final pointer update callback fails', () => {
		const target = new Surface();
		const failure = new Error('render failed');
		using _stop = gestures.transform(target, ({ phase }) => {
			if (phase === 'move') throw failure;
		}, { capture: true });
		target.point('pointerdown', 0, 0, 1);
		target.point('pointerdown', 10, 0, 2);
		expect(() => target.point('pointerup', 20, 0, 2)).toThrow(failure);
		expect(target.releases).toEqual([1, 2]);
	});
});

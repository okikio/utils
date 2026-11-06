/** Liveness keeps wall timestamps separate from elapsed host uptime and explicit injected clocks. @module */
import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { health } from './mod.ts';

describe('health clock ownership', () => {
	it('seeds historical uptime once and then follows monotonic host time', async () => {
		const originalPerformance = Object.getOwnPropertyDescriptor(performance, 'now');
		const now = Date.now;
		let wall = 10_000;
		let elapsed = 100;
		Date.now = () => wall;
		Object.defineProperty(performance, 'now', { configurable: true, value: () => elapsed });
		try {
			const historical = health({ startedAt: 9_000 });
			const fresh = health();
			const request = new Request('https://service.invalid/health');
			wall += 86_400_000;
			elapsed += 250;
			expect(await (await historical(request)).json()).toMatchObject({ uptimeMs: 1250 });
			expect(await (await fresh(request)).json()).toMatchObject({ uptimeMs: 250 });
			wall -= 2 * 86_400_000;
			elapsed += 100;
			expect(await (await historical(request)).json()).toMatchObject({ uptimeMs: 1350 });
			expect(await (await fresh(request)).json()).toMatchObject({ uptimeMs: 350 });
		} finally {
			Date.now = now;
			if (originalPerformance === undefined) Reflect.deleteProperty(performance, 'now');
			else Object.defineProperty(performance, 'now', originalPerformance);
		}
	});

	it('keeps an explicit Date clock in charge of both timestamp and uptime', async () => {
		let current = new Date('2026-11-01T00:00:05Z');
		const handler = health({ startedAt: Date.parse('2026-11-01T00:00:00Z'), now: () => current });
		const request = new Request('https://service.invalid/health');
		expect(await (await handler(request)).json()).toMatchObject({
			timestamp: '2026-11-01T00:00:05.000Z',
			uptimeMs: 5000,
		});
		current = new Date('2026-10-31T23:59:59Z');
		expect(await (await handler(request)).json()).toMatchObject({ uptimeMs: 0 });
	});
});

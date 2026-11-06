/** Cross-origin Fetch policy, original authority and document lifetimes against a real container. @module */
import { after, before, describe, it } from 'node:test';
import { expect } from '@std/expect';
import type { Page } from 'playwright';
import * as fixture from '../fixtures/duplex/browser.ts';
import type { BrowserName } from '../fixtures/duplex/browser.ts';

type Environment = Awaited<ReturnType<typeof fixture.open>>;
type Engine = Awaited<ReturnType<Environment['browser']>>;

describe('real browsers calling a duplex HTTP container', { timeout: 240_000, concurrency: false }, () => {
	let environment: Environment;
	before(async () => {
		environment = await fixture.open();
	});
	after(async () => {
		await environment?.[Symbol.asyncDispose]();
	});
	for (const name of ['chromium', 'firefox', 'webkit'] as const satisfies readonly BrowserName[]) {
		describe(name, { concurrency: false }, () => {
			let engine: Engine;
			let page: Page;
			const pageErrors: string[] = [];
			const receipts: unknown[] = [];
			before(async () => {
				engine = await environment.browser(name);
				page = await engine.page();
				page.on('pageerror', (error) => pageErrors.push(error.message));
			});
			after(async () => {
				try {
					if (engine) {
						await fixture.report(`${name}.json`, {
							browser: engine.browser.version(),
							origin: environment.origin,
							metrics: await environment.host.metrics(),
							receipts,
							pageErrors,
						});
					}
				} finally {
					await engine?.[Symbol.asyncDispose]();
				}
			});

			it('streams authority calls through CORS preflight before accepting a terminal result', async () => {
				const id = `${name}:authority`;
				const result = await fixture.run(page, {
					url: environment.host.url,
					token: environment.host.token,
					input: { id, mode: 'authority', cleanup: 'automatic', calls: 8 },
				});
				expect(result.type).toBe('success');
				expect(result.value).toMatchObject({ id });
				expect(result.heartbeats).toEqual(Array.from({ length: 8 }, (_, index) => ({ id, index })));
				expect(result.permissions).toEqual([id]);
				expect(result.effects).toEqual([{ id }]);
				await fixture.until(
					async () => (await environment.host.metrics()).closed.includes(id),
					'Success left its host resource open.',
				);
				const metrics = await environment.host.metrics();
				expect(result.value).toEqual({ id, pid: metrics.pid });
				expect(metrics.preflights).toBeGreaterThan(0);
				expect(metrics.authenticatedPosts).toBeGreaterThanOrEqual(11);
				receipts.push(result);
			});

			it('keeps the remote resource owned until explicit cancellation cleanup finishes', async () => {
				const id = `${name}:cancel`;
				await page.evaluate(async (options) => {
					const path = '/duplex.mjs';
					(await import(path)).start(options);
				}, {
					url: environment.host.url,
					token: environment.host.token,
					input: { id, mode: 'wait', cleanup: 'manual' },
				});
				try {
					await fixture.until(
						async () => (await environment.host.metrics()).active.includes(id),
						'Browser work never acquired its host resource.',
					);
					await page.evaluate(async (id) => {
						const path = '/duplex.mjs';
						(await import(path)).cancel(id);
					}, id);
					// Host abort is separate from resource release. A pending cancellation
					// cannot return the manually held borrow to another attempt.
					await fixture.until(
						async () => (await environment.host.metrics()).cleanup.includes(id),
						'Cancel POST did not reach the container.',
					);
					expect((await environment.host.metrics()).closed).not.toContain(id);
					const returned = await page.evaluate(async (id) => {
						const path = '/duplex.mjs';
						return (await import(path)).settled(id);
					}, id);
					expect(returned).toBe(false);
				} finally {
					await environment.host.release(id);
				}
				const result = await page.evaluate(async (id) => {
					const path = '/duplex.mjs';
					return await (await import(path)).join(id);
				}, id);
				expect(result.type).toBe('cancelled');
				expect((await environment.host.metrics()).closed).toContain(id);
				receipts.push(result);
			});

			it('aborts container work when its browser document disconnects', async () => {
				const id = `${name}:disconnect`;
				const document = await engine.page();
				try {
					await document.evaluate(async (options) => {
						const path = '/duplex.mjs';
						(await import(path)).start(options);
					}, {
						url: environment.host.url,
						token: environment.host.token,
						input: { id, mode: 'wait', cleanup: 'manual' },
					});
					await fixture.until(
						async () => (await environment.host.metrics()).active.includes(id),
						'Document never acquired the remote resource.',
					);
					await document.close();
					await fixture.until(
						async () => (await environment.host.metrics()).cleanup.includes(id),
						'Document close did not abort the host attempt.',
					);
					expect((await environment.host.metrics()).closed).not.toContain(id);
				} finally {
					await environment.host.release(id);
					await document.close();
				}
				await fixture.until(
					async () => (await environment.host.metrics()).closed.includes(id),
					'Disconnected attempt did not release after its cleanup gate.',
				);
			});

			it('denies invalid credentials before provider dispatch', async () => {
				const id = `${name}:credentials`;
				const result = await fixture.run(page, {
					url: environment.host.url,
					token: 'invalid-fixture-credential',
					input: { id, mode: 'authority', cleanup: 'automatic' },
				});
				expect(result.type).toBe('lost');
				expect(result.heartbeats).toEqual([]);
				expect((await environment.host.metrics()).started).not.toContain(id);
			});

			it('reports uncertainty when container cleanup throws after cancellation', async () => {
				const id = `${name}:failed-cleanup`;
				await page.evaluate(async (options) => {
					const path = '/duplex.mjs';
					(await import(path)).start(options);
				}, {
					url: environment.host.url,
					token: environment.host.token,
					input: { id, mode: 'wait', cleanup: 'failure' },
				});
				// Wait for the host to accept the heartbeat reply. This case isolates
				// failed cleanup rather than relying on a simultaneous reply conflict.
				await fixture.until(
					async () => (await environment.host.metrics()).waiting.includes(id),
					'Failure scenario never reached its acknowledged wait.',
				);
				const result = await page.evaluate(async (id) => {
					const path = '/duplex.mjs';
					const module = await import(path);
					module.cancel(id);
					return await module.join(id);
				}, id);
				expect(result.type).toBe('lost');
				const metrics = await environment.host.metrics();
				expect(metrics.failed).toContain(id);
				expect(metrics.closed).not.toContain(id);
				expect(metrics.active).not.toContain(id);
				receipts.push(result);
			});

			it('joins immediate cleanup when cancellation crosses an in-flight reply', async () => {
				// Repeat the native network race; the portable transport test controls
				// its exact order. Here real browser scheduling and sockets own the order.
				for (let index = 0; index < 8; index++) {
					const id = `${name}:quick-cancel:${index}`;
					await page.evaluate(async (options) => {
						const path = '/duplex.mjs';
						(await import(path)).start(options);
					}, {
						url: environment.host.url,
						token: environment.host.token,
						input: { id, mode: 'wait', cleanup: 'automatic' },
					});
					await fixture.until(
						async () => (await environment.host.metrics()).active.includes(id),
						'Quick cancellation never entered the provider.',
					);
					const result = await page.evaluate(async (id) => {
						const path = '/duplex.mjs';
						const module = await import(path);
						module.cancel(id);
						return await module.join(id);
					}, id);
					expect(result.type, result.reason).toBe('cancelled');
					expect((await environment.host.metrics()).closed).toContain(id);
				}
			});

			it('rejects a foreign browser origin without dispatching work', async () => {
				const id = `${name}:origin`;
				const denied = (await environment.host.metrics()).deniedOrigins;
				const foreign = await engine.page(false);
				try {
					const result = await fixture.run(foreign, {
						url: environment.host.url,
						token: environment.host.token,
						input: { id, mode: 'authority', cleanup: 'automatic' },
					});
					expect(result.type).toBe('lost');
					expect(result.heartbeats).toEqual([]);
					expect((await environment.host.metrics()).started).not.toContain(id);
					expect((await environment.host.metrics()).deniedOrigins).toBeGreaterThan(denied);
				} finally {
					await foreign.close();
				}
				expect(pageErrors).toEqual([]);
			});
		});
	}
});

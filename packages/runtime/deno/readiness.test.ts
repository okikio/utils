import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import * as readiness from './readiness.ts';

describe('loopback listener admission', () => {
	it('selects only caller-owned loopback URLs without retaining credentials', () => {
		expect(readiness.targets({
			storage: 'postgres://secret:password@127.0.0.1:15432/app',
			proxy: 'socks5h://localhost:1055',
			ipv6: 'http://[::1]:8787',
			peer: 'https://peer.example',
		})).toEqual([
			{ name: 'storage', hostname: '127.0.0.1', port: 15432 },
			{ name: 'proxy', hostname: 'localhost', port: 1055 },
			{ name: 'ipv6', hostname: '::1', port: 8787 },
		]);
	});

	it('retries independently delayed listeners', async () => {
		const attempts = new Map<number, number>();
		await readiness.wait(
			readiness.targets({ storage: 'postgres://localhost:15432/app', peer: 'http://localhost:18796' }),
			{
				signal: new AbortController().signal,
				timeoutMs: 1_000,
				intervalMs: 1,
				connect: ({ port }) => {
					const attempt = (attempts.get(port) ?? 0) + 1;
					attempts.set(port, attempt);
					if (attempt < (port === 15432 ? 2 : 3)) {
						return Promise.reject(new Deno.errors.ConnectionRefused('Not bound.'));
					}
					return Promise.resolve();
				},
			},
		);
		expect(attempts.get(15432)).toBe(2);
		expect(attempts.get(18796)).toBe(3);
	});

	it('rejects malformed URLs without including the original secret', () => {
		expect(() => readiness.targets({ storage: 'secret-password' })).toThrow(
			'storage must contain a valid transport URL.',
		);
		expect(() => readiness.targets({ storage: 'file:///secret/password' })).toThrow('unsupported transport protocol');
		expect(() => readiness.targets({ storage: 'postgres://localhost:0/app' })).toThrow('TCP port');
	});

	it('preserves shutdown during a refused connection', async () => {
		const controller = new AbortController();
		const stopped = new Error('Worker shutdown.');
		const pending = readiness.wait(readiness.targets({ storage: 'postgres://localhost/app' }), {
			signal: controller.signal,
			timeoutMs: 1_000,
			intervalMs: 10_000,
			connect: () => {
				controller.abort(stopped);
				return Promise.reject(new Deno.errors.ConnectionRefused('Not bound.'));
			},
		});
		await expect(pending).rejects.toBe(stopped);
	});

	it('bounds an unavailable listener with the caller budget', async () => {
		await expect(readiness.wait(readiness.targets({ storage: 'postgres://localhost/app' }), {
			signal: new AbortController().signal,
			timeoutMs: 10,
			intervalMs: 1,
			connect: () => Promise.reject(new Deno.errors.ConnectionRefused('Not bound.')),
		})).rejects.toMatchObject({ name: 'TimeoutError' });
	});

	it('cancels sibling probes after a permanent failure', async () => {
		const denied = new Deno.errors.PermissionDenied('Denied.');
		let sibling: AbortSignal | undefined;
		let attempts = 0;
		await expect(
			readiness.wait(readiness.targets({ storage: 'postgres://localhost/app', peer: 'http://localhost:8787' }), {
				signal: new AbortController().signal,
				timeoutMs: 1_000,
				connect: async ({ name }, signal) => {
					if (name === 'storage') {
						attempts++;
						throw denied;
					}
					sibling = signal;
					await new Promise<never>((_resolve, reject) => {
						signal.addEventListener('abort', () => reject(signal.reason), { once: true });
					});
				},
			}),
		).rejects.toBe(denied);
		expect(attempts).toBe(1);
		expect(sibling?.aborted).toBe(true);
	});

	it('rejects invalid budgets before attempting a connection', async () => {
		for (const timeoutMs of [0, -1, NaN, Infinity, 2 ** 32]) {
			await expect(readiness.wait([], { signal: new AbortController().signal, timeoutMs })).rejects.toBeInstanceOf(
				RangeError,
			);
		}
	});
});

it('startup cancellation returns before resources can be acquired while unrelated failures still reject', async () => {
	const controller = new AbortController();
	controller.abort(new DOMException('Requested worker shutdown', 'AbortError'));
	expect(await readiness.waitForStartup([], { signal: controller.signal, timeoutMs: 100 })).toBe(false);
	const failure = new Error('Transport failure');
	await expect(readiness.waitForStartup([{ name: 'db', hostname: '127.0.0.1', port: 1 }], {
		signal: new AbortController().signal,
		timeoutMs: 100,
		connect: () => Promise.reject(failure),
	})).rejects.toBe(failure);
	await expect(readiness.waitForStartup([{ name: 'db', hostname: '127.0.0.1', port: 1 }], {
		signal: new AbortController().signal,
		timeoutMs: 1,
		intervalMs: 1,
		connect: () => Promise.reject(new Deno.errors.ConnectionRefused()),
	})).rejects.toHaveProperty('name', 'TimeoutError');
});

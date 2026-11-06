/** Test finite streaming pressure and an independent nginx hop on real TCP sockets. @module */
import '@okikio/dispose/polyfill';
import { describe, it } from 'node:test';
import { get } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { expect } from '@std/expect';
import { GenericContainer, Wait } from 'testcontainers';
import * as events from '@okikio/http/events';
import { evidence, host, until } from './fixtures/evidence.ts';

const NginxImage = 'nginx:1.28-alpine@sha256:a8b39bd9cf0f83869a2162827a0caf6137ddf759d50a171451b335cecc87d236';
const Limits = {
	maximumBytes: 8 * 1024 * 1024,
	maximumChunkBytes: 256 * 1024,
	maximumEventBytes: 65536,
	maximumEvents: 128,
};

/** A paused native response does not let fetch prefetch into an unseen reader queue. */
async function stall(url: string): Promise<IncomingMessage> {
	return await new Promise((resolve, reject) => {
		const request = get(url, (response) => {
			response.on('error', () => {}); // Intentional socket destruction is owned by the caller.
			response.pause();
			resolve(response);
		});
		request.setTimeout(15000, () => request.destroy(new Error('Stalled client exceeded its fixture deadline.')));
		request.on('error', reject);
	});
}

/** Assert every event rather than counting arbitrary network chunks as complete messages. */
async function consume(url: string, delay = 0): Promise<number> {
	const signal = AbortSignal.timeout(15000);
	const response = await fetch(url, { signal });
	expect(response.status).toBe(200);
	let count = 0;
	for await (const event of events.read(response.body!, { ...Limits, signal })) {
		count += 1;
		expect(event.id).toBe(String(count));
		expect(event.data).toBe('x'.repeat(32768));
		if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
	}
	expect(count).toBe(64);
	return count;
}

describe('stream delivery checks', { timeout: 120000, concurrency: false }, () => {
	it('delivers at 1/4/8 readers, remains responsive with eight stalled readers, and releases every slot', async () => {
		const receipt = await evidence('stream-load');
		await using server = await host(receipt);
		const state = async () =>
			await (await fetch(`${server.origin}/state`, { signal: AbortSignal.timeout(2000) })).json();
		const baseline = await state();
		const measurements = [];
		try {
			for (const [concurrency, delay] of [[1, 0], [4, 0], [8, 0], [4, 2]] as const) {
				const started = performance.now();
				const counts = await Promise.all(
					Array.from(
						{ length: concurrency },
						(_, index) => consume(`${server.origin}/events?id=${crypto.randomUUID()}-${index}`, delay),
					),
				);
				await until(async () => (await state()).active === 0, 'completed readers release source slots');
				measurements.push({
					concurrency,
					delayPerEventMs: delay,
					events: counts.reduce((a, b) => a + b, 0),
					elapsedMs: performance.now() - started,
					state: await state(),
				});
			}
			const stalled: IncomingMessage[] = [];
			const ids = Array.from({ length: 8 }, () => crypto.randomUUID());
			try {
				for (const id of ids) stalled.push(await stall(`${server.origin}/events?id=${id}&count=16384`));
				await until(async () => (await state()).active === 8, 'all stalled sockets retain active producers');
				const denied = await fetch(`${server.origin}/events`, { signal: AbortSignal.timeout(2000) });
				expect(denied.status).toBe(503);
				expect(denied.headers.get('retry-after')).toBe('1');
				await denied.body?.cancel();
				let previous = '', stable = 0;
				await until(async () => {
					const current = await state();
					const counts = ids.map((id) => current.clients[id].generated);
					expect(counts.every((count) => count > 0 && count < 1024)).toBe(true);
					const value = JSON.stringify(counts);
					stable = value === previous ? stable + 1 : 0;
					previous = value;
					return stable >= 10;
				}, 'stalled sockets stop advancing well before the 32 MiB connection output budget');
				measurements.push({ kind: 'stalled', concurrency: 8, state: await state() });
			} finally {
				for (const response of stalled) response.destroy();
			}
			await until(async () => (await state()).active === 0, 'disconnect releases all stalled producers');
			await consume(`${server.origin}/events?id=${crypto.randomUUID()}`);
			const final = await state();
			expect(final.peak).toBeLessThanOrEqual(8);
			expect(final.refused).toBe(1);
			// A wide finite-run leak guard, not a production capacity or GC-stability claim.
			expect(final.peakRss - baseline.memory.rss).toBeLessThan(256 * 1024 * 1024);
			await receipt.save('measurements.json', { runtime: process.version, baseline, measurements, final });
		} finally {
			await receipt.save('last-state.json', await state());
		}
	});

	it('observes nginx buffering, forwards incremental events, and distinguishes idle expiry from heartbeat liveness', async () => {
		const receipt = await evidence('nginx-stream');
		// Docker Desktop reaches this owned host through host.docker.internal. Other
		// Docker hosts need that route too; the application is not a public service.
		await using server = await host(receipt, '0.0.0.0');
		const configuration = `events {}\nhttp { access_log /dev/stdout; error_log /dev/stderr info; gzip off;
server { listen 8080;
location /ready { return 200 'ready'; }
location /buffered/ { proxy_pass http://host.docker.internal:${server.port}/edge/; proxy_buffering on; proxy_read_timeout 5s; }
location /load/ { proxy_pass http://host.docker.internal:${server.port}/edge/; proxy_buffering off; proxy_read_timeout 5s; }
location /stream/ { proxy_pass http://host.docker.internal:${server.port}/edge/; proxy_buffering off; proxy_read_timeout 1s; }
}}`;
		await receipt.save('nginx.conf', configuration);
		const proxy = await new GenericContainer(NginxImage)
			.withExtraHosts([{ host: 'host.docker.internal', ipAddress: 'host-gateway' }])
			.withCopyContentToContainer([{ content: configuration, target: '/etc/nginx/nginx.conf' }])
			.withExposedPorts(8080).withWaitStrategy(Wait.forHttp('/ready', 8080)).start();
		let log = '';
		const logs = await proxy.logs();
		logs.on('data', (chunk) => {
			log += String(chunk);
		});
		const origin = `http://${proxy.getHost()}:${proxy.getMappedPort(8080)}`;
		const state = async () => await (await fetch(`${server.origin}/state`)).json();
		const release = async (id: string) => {
			const response = await fetch(`${server.origin}/release?id=${id}`, { method: 'POST' });
			expect(response.status).toBe(204);
		};
		try {
			await receipt.save('proxy.json', { image: NginxImage, origin, version: await proxy.exec(['nginx', '-v']) });
			const pressureStarted = performance.now();
			await Promise.all(
				Array.from(
					{ length: 8 },
					// Keep healthy-load admission separate from the deliberately short idle-expiry control.
					(_, index) => consume(`${origin}/load/events?id=${crypto.randomUUID()}`, index < 4 ? 0 : 2),
				),
			);
			await receipt.save('proxy-load.json', {
				concurrency: 8,
				events: 512,
				elapsedMs: performance.now() - pressureStarted,
			});
			await until(async () => (await state()).active === 0, 'proxy load releases origin sources');
			const missing = await fetch(`${origin}/stream/private`);
			expect(missing.status).toBe(404);
			await missing.body?.cancel();
			const bufferedId = crypto.randomUUID();
			let arrived = false;
			const buffered = fetch(`${origin}/buffered/events?gated=1&count=2&id=${bufferedId}`, {
				signal: AbortSignal.timeout(10000),
			})
				.then(async (response) => {
					const reader = response.body!.getReader();
					const first = await reader.read();
					arrived = true;
					const chunks = [first.value ?? new Uint8Array()];
					for (;;) {
						const next = await reader.read();
						if (next.done) break;
						chunks.push(next.value);
					}
					reader.releaseLock();
					return chunks.map((chunk) => new TextDecoder().decode(chunk)).join('');
				});
			await until(
				async () => (await state()).clients[bufferedId]?.generated === 1,
				'buffered origin generated its first event',
			);
			await new Promise((resolve) => setTimeout(resolve, 300));
			expect(arrived).toBe(false);
			await release(bufferedId);
			expect(await buffered).toContain('Hello 2');

			for (const heartbeat of [false, true]) {
				const id = crypto.randomUUID();
				const abort = new AbortController();
				const response = await fetch(
					`${origin}/stream/events?gated=1&count=2&id=${id}${heartbeat ? '&heartbeat=1' : ''}`,
					{ signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10000)]) },
				);
				expect(response.status).toBe(200);
				const reader = events.read(response.body!, { ...Limits });
				try {
					expect((await reader.next()).value?.id).toBe('1'); // First event arrives before the origin can finish.
					if (!heartbeat) await expect(reader.next()).rejects.toThrow();
					else {
						// Read for longer than two proxy idle windows. Heartbeats have no event ID.
						const started = performance.now();
						let comments = 0;
						while (performance.now() - started < 2200) {
							const message = (await reader.next()).value!;
							expect(message.comment).toBe('keep-alive');
							expect(message.id).toBeUndefined();
							comments += 1;
						}
						expect(comments).toBeGreaterThan(2);
						await release(id);
						let next = (await reader.next()).value;
						while (next?.comment) next = (await reader.next()).value;
						expect(next?.id).toBe('2');
						expect((await reader.next()).done).toBe(true);
					}
				} finally {
					abort.abort();
					await reader.return(undefined);
				}
				await until(async () => (await state()).active === 0, 'nginx closure cancels the origin producer');
			}
			const abort = new AbortController();
			const response = await fetch(`${origin}/stream/events?gated=1&heartbeat=1&count=2&id=${crypto.randomUUID()}`, {
				signal: abort.signal,
			});
			const reader = response.body!.getReader();
			await reader.read();
			abort.abort();
			await reader.cancel().catch(() => {});
			reader.releaseLock();
			await until(async () => (await state()).active === 0, 'caller abort crosses nginx and gateway to the producer');
			await receipt.save('result.json', {
				bufferingNegativeControl: true,
				incrementalDelivery: true,
				idleTimeoutClosed: true,
				heartbeatsPreservedConnection: true,
				state: await state(),
			});
		} finally {
			await receipt.save('nginx.log', log);
			await receipt.save('last-state.json', await state());
			await proxy.stop({ timeout: 0 });
		}
	});
});

/** Exercise real OTLP HTTP exports and native LogTape ownership in one process. @module */
import { describe, it } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Buffer } from 'node:buffer';
import { expect } from '@std/expect';
import { configure, getLogger, reset } from '@logtape/logtape';
import { trace } from '@opentelemetry/api';
import { open } from './node.ts';
import * as instrument from './instrument.ts';
import { create as backend } from './otel/instrument.ts';

/** Wire records use only fields asserted below; unneeded protocol fields stay outside the fixture. */
interface Item {
	name?: string;
	traceId?: string;
	spanId?: string;
	parentSpanId?: string;
	status?: { code: number };
	attributes?: Array<{ key: string; value: { stringValue?: string } }>;
	sum?: { dataPoints: Item[] };
	histogram?: { dataPoints: Item[] };
}
interface Envelope {
	resourceSpans?: Array<{ resource: { attributes: Item['attributes'] }; scopeSpans: Array<{ spans: Item[] }> }>;
	resourceLogs?: Array<{ scopeLogs: Array<{ logRecords: Item[] }> }>;
	resourceMetrics?: Array<{ scopeMetrics: Array<{ metrics: Item[] }> }>;
}

/** A real receiver acknowledges exports. Closing it also drops keep-alive sockets. */
async function collector(status = 200, hold = false) {
	const received: Envelope[] = [];
	const server = createServer(async (request, response) => {
		const chunks: Uint8Array[] = [];
		for await (const chunk of request) chunks.push(chunk);
		received.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Envelope);
		if (hold) return;
		response.writeHead(status, { 'content-type': 'application/json' }).end('{}');
	});
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	const address = server.address();
	if (address === null || typeof address === 'string') throw new Error('Expected collector listener.');
	return {
		received,
		endpoint: `http://127.0.0.1:${address.port}`,
		async [Symbol.asyncDispose]() {
			// Stop accepting before closing active sockets; the close callback owns completion.
			const closed = new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
			server.closeAllConnections();
			await closed;
		},
	};
}

describe('explicit Node collection', { concurrency: false }, () => {
	it('exports correlated native LogTape logs, nested spans, saved parents, and bounded metric labels', async () => {
		await using receiver = await collector();
		await using collection = await open({ service: 'imports', endpoint: receiver.endpoint, traces: { sample: 1 } });
		await configure({
			sinks: { otlp: collection.sink },
			contextLocalStorage: collection.storage,
			loggers: [{ category: ['fixture'], lowestLevel: 'info', sinks: ['otlp'] }, {
				category: ['utils'],
				lowestLevel: 'warning',
				sinks: ['otlp'],
			}],
		});
		try {
			let parent: instrument.TraceType | undefined;
			await collection.instrument.span('fixture.submit', { run_id: 'customer-1' }, async () => {
				parent = collection.instrument.capture();
				getLogger(['fixture']).info('accepted');
				await collection.instrument.span('fixture.write', {}, async () => 42);
			});
			expect(parent).toBeDefined();
			await collection.instrument.span(
				'fixture.attempt',
				{},
				async () => getLogger(['fixture']).info('resumed'),
				parent,
			);
		} finally {
			await reset();
		}
		await collection.close();
		const spans = receiver.received.flatMap((data) => data.resourceSpans ?? []).flatMap((data) => data.scopeSpans)
			.flatMap((data) => data.spans);
		const root = spans.find((span) => span.name === 'fixture.submit')!;
		expect(root).toBeDefined();
		for (const name of ['fixture.write', 'fixture.attempt']) {
			expect(spans.find((span) => span.name === name)).toMatchObject({
				traceId: root.traceId,
				parentSpanId: root.spanId,
			});
		}
		const logs = receiver.received.flatMap((data) => data.resourceLogs ?? []).flatMap((data) => data.scopeLogs).flatMap(
			(data) => data.logRecords,
		);
		expect(logs).toHaveLength(2);
		expect(logs.every((log) => log.traceId === root.traceId && log.spanId !== undefined)).toBe(true);
		const meters = receiver.received.flatMap((data) => data.resourceMetrics ?? []).flatMap((data) => data.scopeMetrics)
			.flatMap((data) => data.metrics);
		expect(meters.map((meter) => meter.name)).toContain('utils.operation.duration');
		for (const meter of meters) {
			for (const point of meter.sum?.dataPoints ?? meter.histogram?.dataPoints ?? []) {
				expect(point.attributes?.every((field) => ['operation', 'outcome'].includes(field.key))).toBe(true);
			}
		}
		expect(receiver.received.flatMap((data) => data.resourceSpans ?? [])[0]?.resource.attributes)
			.toContainEqual({ key: 'service.name', value: { stringValue: 'imports' } });
		expect(collection.errors).toBe(0);
	});

	it('never repeats a failing callback and preserves the exact thrown value', async () => {
		let calls = 0;
		let rejected = false;
		try {
			await backend().span('fixture.failure', {}, async () => {
				calls++;
				throw undefined;
			});
		} catch (reason) {
			rejected = true;
			expect(reason).toBeUndefined();
		}
		expect(rejected).toBe(true);
		expect(calls).toBe(1);
	});

	it('discards malformed saved metadata and copies no baggage', () => {
		expect(instrument.saved({ version: 2, traceparent: 'bad' })).toBeUndefined();
		expect(instrument.saved({ version: 1, traceparent: '00-' + '0'.repeat(32) + '-' + '1'.repeat(16) + '-01' }))
			.toBeUndefined();
		expect(
			instrument.saved({
				version: 1,
				traceparent: '00-' + '1'.repeat(32) + '-' + '2'.repeat(16) + '-01',
				baggage: 'secret',
			}),
		)
			.toEqual({ version: 1, traceparent: '00-' + '1'.repeat(32) + '-' + '2'.repeat(16) + '-01' });
	});

	it('rejects overlapping owners and allows reopening after idempotent close', async () => {
		await using receiver = await collector();
		const options = { service: 'fixture', endpoint: receiver.endpoint };
		const collection = await open(options);
		try {
			await expect(open(options)).rejects.toThrow('already open');
		} finally {
			await Promise.all([collection.close(), collection.close()]);
		}
		await using reopened = await open(options);
		expect(reopened.errors).toBe(0);
	});

	it('preserves an existing provider when startup conflicts', async () => {
		const { NodeTracerProvider } = await import('@opentelemetry/sdk-trace-node');
		const provider = new NodeTracerProvider();
		expect(trace.setGlobalTracerProvider(provider)).toBe(true);
		try {
			await expect(open({ service: 'conflict', endpoint: 'http://127.0.0.1:1' })).rejects.toThrow('already registered');
			expect(trace.getTracer('fixture')).toBe(provider.getTracer('fixture'));
		} finally {
			trace.disable();
			await provider.shutdown();
		}
	});

	it('reports rejected exports without changing the business result, even when onError throws', async () => {
		await using receiver = await collector(400);
		await using collection = await open({
			service: 'fixture',
			endpoint: receiver.endpoint,
			traces: { sample: 1 },
			shutdown: 1000,
			onError() {
				throw new Error('observer failed');
			},
		});
		expect(await collection.instrument.span('fixture.save', {}, async () => 'committed')).toBe('committed');
		await collection.close();
		expect(collection.errors).toBeGreaterThan(0);
	});

	it('validates policy before reserving a collection owner', async () => {
		for (
			const override of [
				{ service: '' },
				{ endpoint: 'http://user:password@localhost' },
				{ capacity: 0 },
				{ traces: { sample: 2 } },
				{ metrics: { interval: 1 } },
				{ shutdown: 0 },
			]
		) {
			await expect(open({ service: 'fixture', endpoint: 'http://127.0.0.1:1', ...override })).rejects.toThrow();
		}
		await using _collection = await open({
			service: 'fixture',
			endpoint: 'http://127.0.0.1:1',
			traces: false,
			metrics: false,
		});
		expect(_collection.instrument.capture()).toBeUndefined();
	});

	it('bounds shutdown when a collector accepts the request but never responds', { timeout: 3000 }, async () => {
		await using receiver = await collector(200, true);
		await using collection = await open({
			service: 'fixture',
			endpoint: receiver.endpoint,
			traces: { sample: 1 },
			metrics: false,
			shutdown: 100,
		});
		expect(await collection.instrument.span('fixture.save', {}, async () => 'saved')).toBe('saved');
		await collection.close();
		expect(receiver.received.length).toBeGreaterThan(0);
		expect(collection.errors).toBeGreaterThan(0);
	});

	it('records a handled failure without exporting its arbitrary message', async () => {
		await using receiver = await collector();
		await using collection = await open({ service: 'fixture', endpoint: receiver.endpoint, traces: { sample: 1 } });
		expect(
			await collection.instrument.span('fixture.reject', {}, async (observation) => {
				observation.fail(new Error('private customer payload'));
				return 'rejected';
			}),
		).toBe('rejected');
		await collection.close();
		const spans = receiver.received.flatMap((data) => data.resourceSpans ?? []).flatMap((data) => data.scopeSpans)
			.flatMap((data) => data.spans);
		expect(spans.find((span) => span.name === 'fixture.reject')?.status?.code).toBe(2);
		expect(JSON.stringify(receiver.received)).not.toContain('private customer payload');
	});

	it('counts handled failures when traces are disabled', async () => {
		await using receiver = await collector();
		await using collection = await open({ service: 'fixture', endpoint: receiver.endpoint, traces: false });
		await collection.instrument.span('fixture.reject', {}, async (observation) => {
			observation.fail('denied');
		});
		await collection.close();
		const meters = receiver.received.flatMap((data) => data.resourceMetrics ?? [])
			.flatMap((data) => data.scopeMetrics).flatMap((data) => data.metrics);
		const counts = meters.find((meter) => meter.name === 'utils.operation.count')?.sum?.dataPoints ?? [];
		expect(
			counts.some((point) =>
				point.attributes?.some((field) => field.key === 'outcome' && field.value.stringValue === 'error')
			),
		).toBe(true);
		expect(receiver.received.flatMap((data) => data.resourceSpans ?? [])).toHaveLength(0);
	});
});

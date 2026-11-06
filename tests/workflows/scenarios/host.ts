/** Explicit consumer assembly, health probes, test barriers, and process lifetime. @module */
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import { createServer } from 'node:http';
import { once } from 'node:events';
import process from 'node:process';
import postgresjs from 'postgres';
import * as context from '@okikio/context';
import * as failures from '@okikio/result/failure';
import * as resource from '@okikio/capability/resource';
import * as workflow from '@okikio/workflow';
import * as postgres from '@okikio/storage/workflow/postgres';
import { CaptureRejected, CaptureUnavailable, Database, Gate, ManifestSchema, Provider, Store } from './contracts.ts';
import { bindParse, CoreEngine, CorePolicy, RecordExitLive, ResolutionLive, ResolveLive, VerifyLive } from './core.ts';
import {
	AcquireLive,
	AnalyzeLive,
	AuthorizeLive,
	CaptureEngine,
	CaptureLive,
	CommitLive,
	DeleteLive,
	ExpireLive,
	ExtractLive,
	IntelligencePolicy,
	KnowledgeLive,
	StageLive,
} from './intelligence.ts';

import { configure, reset } from '@logtape/logtape';
import * as telemetry from '@okikio/telemetry/node';

// Each process owns its providers. LogTape borrows their sink and async context.
await using collection = process.env.TELEMETRY_URL
	? await telemetry.open({
		service: 'fixture.worker',
		endpoint: process.env.TELEMETRY_URL,
		traces: { sample: 1 },
		metrics: { interval: 1000 },
	})
	: undefined;
if (collection !== undefined) {
	await configure({
		sinks: { otlp: collection.sink },
		contextLocalStorage: collection.storage,
		loggers: [{ category: ['utils'], lowestLevel: 'info', sinks: ['otlp'] }, {
			category: ['logtape', 'meta'],
			lowestLevel: 'warning',
			sinks: [],
		}],
	});
}

const databaseUrl = process.env.DATABASE_URL;
const namespace = process.env.WORKFLOW_NAMESPACE;
const providerUrl = process.env.PROVIDER_URL;
// Deployment roles select explicit code below. They do not discover implementations from the filesystem.
const role = process.env.WORKER_ROLE ?? 'all';
if (!['all', 'imports', 'research', 'capture', 'publication'].includes(role)) throw new Error('Unknown WORKER_ROLE');
if (!databaseUrl || !namespace || !providerUrl) {
	throw new Error('DATABASE_URL, WORKFLOW_NAMESPACE and PROVIDER_URL required');
}
const sql = postgresjs(databaseUrl, {
	max: 8,
	connect_timeout: 2,
	idle_timeout: 5,
	connection: {
		statement_timeout: 2000,
		lock_timeout: Number(process.env.LOCK_MS ?? 1000),
		transaction_timeout: 10000,
	},
});
try {
	await using store = postgres.open({ database: sql, namespace, instrument: collection?.instrument });
	const corePolicy = workflow.PolicySchema.parse(
		process.env.CORE_POLICY ? JSON.parse(process.env.CORE_POLICY) : CorePolicy,
	);
	const coreClient = workflow.client({ store, instrument: collection?.instrument, policy: corePolicy });
	const ParseLive = bindParse(coreClient);
	let workflows: workflow.ServeOptions['workflows'];
	let activities: workflow.ServeOptions['activities'];
	switch (role) {
		case 'imports':
			workflows = [ResolutionLive];
			activities = [ParseLive, ResolveLive, VerifyLive, RecordExitLive];
			break;
		case 'research':
			workflows = [AcquireLive, ExpireLive];
			activities = [RecordExitLive, AuthorizeLive, ExtractLive, AnalyzeLive, DeleteLive];
			break;
		case 'publication':
			workflows = [KnowledgeLive];
			activities = [RecordExitLive, StageLive, CommitLive];
			break;
		case 'capture':
			workflows = [];
			activities = [CaptureLive];
			break;
		default:
			workflows = [ResolutionLive, AcquireLive, KnowledgeLive, ExpireLive];
			activities = [
				ParseLive,
				ResolveLive,
				VerifyLive,
				RecordExitLive,
				AuthorizeLive,
				CaptureLive,
				ExtractLive,
				AnalyzeLive,
				StageLive,
				CommitLive,
				DeleteLive,
			];
	}
	// No submission client is needed for Intelligence's child instructions.
	const DatabaseLive = resource.implement(Database, { create: () => ({ sql }) });
	const StoreLive = resource.implement(Store, {
		// Returning store itself would let the collection adopt its disposal. This is a borrowed, non-disposable view.
		create: () => ({
			transaction: store.transaction.bind(store),
			getReceipt: store.getReceipt.bind(store),
		}),
	});
	const ProviderLive = resource.implement(Provider, {
		create: () => ({
			async capture(input, signal) {
				let response: Response;
				try {
					response = await fetch(`${providerUrl}/capture`, {
						method: 'POST',
						signal,
						headers: {
							'content-type': 'application/json',
							'idempotency-key': `capture-v1:${input.scope}:${input.research}`,
						},
						body: JSON.stringify(input),
					});
				} catch (cause) {
					if (signal.aborted) throw cause;
					throw await failures.create(CaptureUnavailable, {
						data: { status: 0 },
						message: 'Capture transport unavailable',
					});
				}
				if (!response.ok) {
					await response.body?.cancel();
					const definition = response.status >= 500 || response.status === 429 ? CaptureUnavailable : CaptureRejected;
					throw await failures.create(definition, {
						data: { status: response.status },
						message: 'Capture request failed',
					});
				}
				if (!response.body) throw new Error('invariant: provider response missing');
				const reader = response.body.getReader();
				const chunks: Uint8Array[] = [];
				let size = 0;
				try {
					while (true) {
						const next = await reader.read();
						if (next.done) break;
						size += next.value.byteLength;
						if (size > 65_536) {
							await reader.cancel();
							throw new Error('invariant: provider response too large');
						}
						chunks.push(next.value);
					}
				} finally {
					reader.releaseLock();
				}
				const bytes = new Uint8Array(size);
				let offset = 0;
				for (const chunk of chunks) {
					bytes.set(chunk, offset);
					offset += chunk.byteLength;
				}
				return ManifestSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
			},
			async check(signal) {
				const response = await fetch(`${providerUrl}/ready`, { signal });
				await response.body?.cancel();
				return response.ok;
			},
		}),
	});
	const GateLive = resource.implement(Gate, {
		create() {
			let held = false;
			let retried = false;
			return {
				async reach(name, details) {
					if (process.env.FAIL_AT === name) throw new Error('fixture permanent failure');
					if (!retried && process.env.RETRY_AT === name) {
						retried = true;
						throw new Error('fixture transient failure');
					}
					if ((held && process.env.PAUSE_ALL !== '1') || process.env.PAUSE_AT !== name) return;
					held = true;
					console.log(JSON.stringify({ event: 'barrier', name, ...details }));
					// Test-only POSIX control. SIGKILL prevents cleanup; SIGUSR1 releases the visible boundary.
					await new Promise<void>((resolve) => process.once('SIGUSR1', () => resolve()));
				},
			};
		},
	});
	await using owner = context.create({ instrument: collection?.instrument, id: `fixture:${process.pid}` });
	await using resources = resource.create(
		resource.implementations(DatabaseLive, StoreLive, ProviderLive, GateLive),
		{ ctx: owner, host: {} },
	);
	const provider = await resources.get(owner, Provider);
	const shutdown = new AbortController();
	let draining = false;
	let serving: workflow.Serving | undefined;
	const server = createServer(async (req, res) => {
		if (req.url === '/live') {
			res.writeHead(200).end('live');
			return;
		}
		if (req.url !== '/ready') {
			res.writeHead(404).end();
			return;
		}
		const deadline = AbortSignal.timeout(1000);
		try {
			if (draining || serving === undefined) {
				res.writeHead(503).end('starting or draining');
				return;
			}
			const [host, providerReady] = await Promise.all([
				serving.check({ signal: deadline }),
				provider.check(deadline),
			]);
			const ready = !draining && host.ready && providerReady && !deadline.aborted;
			res.writeHead(ready ? 200 : 503, { 'content-type': 'application/json' })
				.end(JSON.stringify({ ready, host, providerReady }));
		} catch {
			res.writeHead(503).end('dependency or authority unavailable');
		}
	});
	const stop = () => {
		draining = true;
		shutdown.abort();
		void serving?.drain().catch((error: unknown) => {
			const code = error instanceof workflow.ExecutionError ? error.code : 'drain_fault';
			console.log(JSON.stringify({ event: 'drain', code, state: serving?.state() }));
		});
	};
	process.once('SIGTERM', stop);
	process.once('SIGINT', stop);
	server.listen(Number(process.env.PORT ?? 0), process.env.BIND ?? '127.0.0.1');
	await once(server, 'listening');
	const address = server.address();
	if (address === null || typeof address === 'string') throw new Error('Expected TCP listener');
	console.log(JSON.stringify({ event: 'listening', port: address.port }));
	try {
		await (await resources.get(owner, Gate)).reach('host.before-serve', {});
		// Each worker supplies only its own code. PostgreSQL carries requests and results between the workers.
		await using execution = await workflow.serve({
			instrument: collection?.instrument,
			store,
			policies: [corePolicy, IntelligencePolicy],
			classify(reason) {
				if (reason instanceof Error && reason.message === 'fixture transient failure') return 'transient';
				const code = typeof reason === 'object' && reason !== null ? (reason as { code?: unknown }).code : undefined;
				return ['40001', '40P01', '53300', '57P01'].includes(String(code)) ? 'transient' : 'permanent';
			},
			engine: role === 'capture' ? CaptureEngine : CoreEngine,
			capabilities: ['provider.idempotency'],
			workflows,
			activities,
			resources,
			capacity: { activations: 2, activities: 2, control: 1, finalizers: 1 },
			hostId: process.env.WORKER_ID ?? `fixture:${process.pid}`,
			shutdown: shutdown.signal,
			drainTimeoutMs: Number(process.env.DRAIN_MS ?? 10_000),
		});
		serving = execution;
		await execution.closed;
	} finally {
		draining = true;
		process.removeListener('SIGTERM', stop);
		process.removeListener('SIGINT', stop);
		await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
	}
} finally {
	try {
		await sql.end({ timeout: 2 });
	} finally {
		await reset();
	}
}

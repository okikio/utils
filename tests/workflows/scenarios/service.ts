/** HTTP admission and status for the container tests. This service never starts a worker. @module */
import '@okikio/dispose/polyfill';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import postgresjs from 'postgres';
import * as schemaCore from '@okikio/schema';
import * as workflow from '@okikio/workflow';
import { identity } from '@okikio/workflow/execution';
import * as postgres from '@okikio/storage/workflow/postgres';
import { digest, ResearchInputSchema } from './contracts.ts';
import { CorePolicy, Parse } from './core.ts';
import { Acquire, IntelligencePolicy } from './intelligence.ts';

import { configure, reset } from '@logtape/logtape';
import * as telemetry from '@okikio/telemetry/node';

// Each process owns its providers. LogTape borrows their sink and async context.
await using collection = process.env.TELEMETRY_URL
	? await telemetry.open({
		service: 'fixture.service',
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

const ImportSchema = schemaCore.object({
	scope: schemaCore.string({ pattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i }),
	source: schemaCore.string({ pattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i }),
	revision: schemaCore.refine(
		schemaCore.number({ integer: true }),
		(value) => value > 0,
		'Expected a positive number.',
	),
	key: schemaCore.refine(
		schemaCore.refine(schemaCore.string(), (value) => value.length >= 1, 'Value is below the minimum.'),
		(value) => value.length <= 256,
		'Value exceeds the maximum.',
	),
	body: schemaCore.refine(schemaCore.string(), (value) => value.length <= 2_000_000, 'Value exceeds the maximum.'),
});
const ResearchSchema = schemaCore.extend(ResearchInputSchema, {
	key: schemaCore.refine(
		schemaCore.refine(schemaCore.string(), (value) => value.length >= 1, 'Value is below the minimum.'),
		(value) => value.length <= 256,
		'Value exceeds the maximum.',
	),
});
const databaseUrl = process.env.DATABASE_URL;
const namespace = process.env.WORKFLOW_NAMESPACE;
if (!databaseUrl || !namespace) throw new Error('DATABASE_URL and WORKFLOW_NAMESPACE required');
const sql = postgresjs(databaseUrl, {
	max: 4,
	connect_timeout: 2,
	connection: { statement_timeout: 2000, lock_timeout: 1000, transaction_timeout: 10000 },
});
try {
	await using store = postgres.open({ database: sql, namespace, instrument: collection?.instrument });
	const imports = workflow.client({ store, instrument: collection?.instrument, policy: CorePolicy });
	const research = workflow.client({ store, instrument: collection?.instrument, policy: IntelligencePolicy });
	let closing = false;
	const server = createServer(async (req, res) => {
		try {
			const url = new URL(req.url ?? '/', 'http://service');
			if (url.pathname === '/live') {
				res.writeHead(200).end('live');
				return;
			}
			if (url.pathname === '/ready') {
				await store.check();
				res.writeHead(closing ? 503 : 200).end(closing ? 'closing' : 'ready');
				return;
			}
			if (req.method === 'GET' && (url.pathname === '/imports' || url.pathname === '/research')) {
				const definition = url.pathname === '/imports' ? Parse : Acquire;
				const client = url.pathname === '/imports' ? imports : research;
				const ref = workflow.ReferenceSchema.parse({
					id: url.searchParams.get('id'),
					scope: url.searchParams.get('scope'),
					namespace,
					definition: identity(definition),
				});
				const snapshot = await client.get(definition, ref);
				res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(snapshot));
				return;
			}
			if (req.method !== 'POST' || !['/imports', '/research'].includes(url.pathname)) {
				res.writeHead(404).end();
				return;
			}
			// These isolated fixtures use trusted test callers. A deployed service must authorize scope and commands here.
			const chunks: Uint8Array[] = [];
			let bytes = 0;
			for await (const chunk of req) {
				bytes += chunk.length;
				if (bytes > 2_097_152) {
					res.writeHead(413).end('', () => req.destroy());
					return;
				}
				chunks.push(chunk);
			}
			const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
			let ref: workflow.ReferenceType;
			if (url.pathname === '/imports') {
				const { body, key, ...source } = ImportSchema.parse(value);
				const input = { ...source, digest: await digest(body) };
				ref = await postgres.begin(sql, async (tx) => {
					await tx`insert into sources(scope,id,revision,digest,body)
              values (${input.scope},${input.source},${input.revision},${input.digest},${body})
              on conflict (scope,id) do nothing`;
					return await imports.in(tx).submit(Parse, input, { scope: input.scope, key });
				});
			} else {
				const { key, ...input } = ResearchSchema.parse(value);
				ref = await postgres.begin(sql, async (tx) => {
					await tx`insert into research(scope,id,grant_id,expires_at)
              values (${input.scope},${input.research},${input.grant},${input.expiresAt})
              on conflict (scope,id) do nothing`;
					return await research.in(tx).submit(Acquire, input, { scope: input.scope, key });
				});
			}
			// A 202 response means the transaction committed. It does not mean a worker has completed the job.
			res.writeHead(202, { 'content-type': 'application/json' }).end(JSON.stringify(ref));
		} catch (error) {
			const conflict = error instanceof workflow.ExecutionError && error.code === 'admission_conflict';
			const invalid = error instanceof schemaCore.SchemaValidationError || error instanceof SyntaxError;
			res.writeHead(conflict ? 409 : invalid ? 400 : 503).end(conflict ? 'Command key conflicts' : 'Request failed');
		}
	});
	server.requestTimeout = 5000;
	server.headersTimeout = 5000;
	server.listen(Number(process.env.PORT ?? 0), process.env.BIND ?? '127.0.0.1');
	await once(server, 'listening');
	const address = server.address();
	if (address === null || typeof address === 'string') throw new Error('Expected TCP listener');
	console.log(JSON.stringify({ event: 'listening', port: address.port }));
	const stopped = Promise.withResolvers<void>();
	const stop = () => {
		if (closing) return;
		closing = true;
		server.close((error) => error ? stopped.reject(error) : stopped.resolve());
	};
	process.once('SIGTERM', stop);
	process.once('SIGINT', stop);
	try {
		await stopped.promise;
	} finally {
		process.removeListener('SIGTERM', stop);
		process.removeListener('SIGINT', stop);
	}
} finally {
	try {
		await sql.end({ timeout: 2 });
	} finally {
		await reset();
	}
}

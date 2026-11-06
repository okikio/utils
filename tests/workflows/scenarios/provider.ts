/** Test capture service. Repeated requests return the saved capture without creating another copy. @module */
import { createServer } from 'node:http';
import { Buffer } from 'node:buffer';
import { once } from 'node:events';
import process from 'node:process';
import postgresjs from 'postgres';
import * as schemaCore from '@okikio/schema';
import { digest, ResearchInputSchema } from './contracts.ts';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const sql = postgresjs(url, {
	max: 4,
	connect_timeout: 2,
	idle_timeout: 5,
	connection: { statement_timeout: 2000, lock_timeout: 1000, transaction_timeout: 10000 },
});
const server = createServer(async (req, res) => {
	try {
		if (req.url === '/ready') {
			await sql`select 1`;
			res.writeHead(200).end('ready');
			return;
		}
		if (req.url !== '/capture' || req.method !== 'POST') {
			res.writeHead(404).end();
			return;
		}
		const chunks: Uint8Array[] = [];
		let size = 0;
		for await (const chunk of req) {
			size += chunk.length;
			if (size > 65_536) {
				res.writeHead(413).end('', () => req.destroy());
				return;
			}
			chunks.push(chunk);
		}
		const text = Buffer.concat(chunks).toString('utf8');
		const input = ResearchInputSchema.parse(JSON.parse(text));
		const key = `capture-v1:${input.scope}:${input.research}`;
		if (req.headers['idempotency-key'] !== key) {
			res.writeHead(409).end();
			return;
		}
		const body = `fixture capture of ${input.url}`;
		const checksum = await digest(body);
		const manifest = await sql.begin(async (tx) => {
			const owners = await tx`select * from research where scope = ${input.scope} and id = ${input.research}
        and grant_id = ${input.grant} for update`;
			const owner = owners[0];
			if (!owner) throw new Error('authorization: research scope missing');
			const existing = await tx`select * from captures where scope = ${input.scope}
        and research = ${input.research} and effect = ${key}`;
			if (existing[0]) {
				// A changed URL under the same effect key must conflict, even after raw bytes have expired.
				if (existing[0].digest !== checksum) throw new Error('conflict: capture input changed');
				return {
					scope: input.scope,
					research: input.research,
					digest: existing[0].digest,
					version: existing[0].version,
				};
			}
			const clocks = await tx`select clock_timestamp() as now`;
			if (owner.closed || owner.expires_at <= clocks[0]!.now) throw new Error('authorization: raw scope closed');
			const version = crypto.randomUUID();
			await tx`insert into captures (scope, research, effect, version, digest, body)
        values (${input.scope}, ${input.research}, ${key}, ${version}, ${checksum}, ${body})`;
			await tx`update research set latest_at = clock_timestamp() where scope = ${input.scope} and id = ${input.research}`;
			return { scope: input.scope, research: input.research, digest: checksum, version };
		});
		res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(manifest));
	} catch (cause) {
		const message = cause instanceof Error ? cause.message : 'invariant: provider error';
		const status = cause instanceof schemaCore.SchemaValidationError || cause instanceof SyntaxError
			? 400
			: message.startsWith('authorization:')
			? 403
			: message.startsWith('conflict:')
			? 409
			: 503;
		res.writeHead(status).end(message);
	}
});
server.requestTimeout = 2000;
server.headersTimeout = 2000;
server.listen(Number(process.env.PORT ?? 0), process.env.BIND ?? '127.0.0.1');
await once(server, 'listening');
const address = server.address();
if (address === null || typeof address === 'string') throw new Error('Expected TCP listener');
console.log(JSON.stringify({ event: 'listening', port: address.port }));
let closing = false;
async function close(): Promise<void> {
	if (closing) return;
	closing = true;
	await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
	await sql.end({ timeout: 2 });
}
process.once('SIGTERM', () => {
	void close();
});
process.once('SIGINT', () => {
	void close();
});

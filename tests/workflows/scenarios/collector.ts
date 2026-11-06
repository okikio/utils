/** Bounded OTLP HTTP receiver for container assertions. This is not a production collector. @module */
import { createServer } from 'node:http';
import { Buffer } from 'node:buffer';
import process from 'node:process';

const records: unknown[] = [];
const server = createServer(async (request, response) => {
	if (request.url === '/ready') {
		response.end('ready');
		return;
	}
	if (request.method === 'GET' && request.url === '/exports') {
		response.setHeader('content-type', 'application/json');
		response.end(JSON.stringify(records));
		return;
	}
	if (request.method !== 'POST' || !['/v1/traces', '/v1/logs', '/v1/metrics'].includes(request.url ?? '')) {
		response.writeHead(404).end();
		return;
	}
	const chunks: Uint8Array[] = [];
	let size = 0;
	for await (const chunk of request) {
		size += chunk.length;
		if (size > 2_097_152) {
			response.writeHead(413).end();
			request.destroy();
			return;
		}
		chunks.push(chunk);
	}
	try {
		const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
		if (records.length === 512) records.shift();
		records.push(value);
		response.setHeader('content-type', 'application/json');
		response.end('{}');
	} catch {
		response.writeHead(400).end();
	}
});
server.listen(Number(process.env.PORT ?? 8080), '0.0.0.0');

/** Discover and call a real tool without a model; assert failures and close every owned connection. @module */
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createGreetingMcp } from './server.ts';
import { listen } from './listen.ts';
import { strict as assert } from 'node:assert';

// The listener owns a separate application for real protocol requests.
// This application tests HTTP admission directly, without a network client.
const admissionApp = createGreetingMcp();
let listener: Awaited<ReturnType<typeof listen>> | undefined;
const client = new Client({ name: 'greeting-check', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } });
try {
	// Acquire inside the cleanup scope so a failed bind still closes the direct application.
	listener = await listen(0);
	// Use the actual SDK transport over a real loopback connection.
	// The network client supplies Host; the outer route checks it before MCP.
	await client.connect(
		new StreamableHTTPClientTransport(listener.url),
	);

	// Discovery tells a client which tools exist; calling one is a separate step.
	const names = (await client.listTools()).tools.map((tool) => tool.name);
	assert.deepEqual(names, ['greet']);
	console.log(JSON.stringify(names));
	const greeting = await client.callTool({ name: 'greet', arguments: { name: 'Sam' } });
	assert.deepEqual(greeting.content, [{ type: 'text', text: 'Hello, Sam!' }]);
	console.log(JSON.stringify(greeting.content));
	const invalid = await client.callTool({ name: 'greet', arguments: { name: '' } });
	assert.equal(invalid.isError, true);
	console.log('invalid', invalid.isError);

	// Exercise the outer HTTP policy independently of valid protocol input.
	const badHost = await admissionApp.app.fetch(
		new Request('http://localhost/mcp', {
			method: 'POST',
			headers: { host: 'attacker.invalid' },
		}),
	);
	const badOrigin = await admissionApp.app.fetch(
		new Request('http://localhost/mcp', {
			method: 'POST',
			headers: { host: 'localhost', origin: 'https://attacker.invalid' },
		}),
	);
	assert.equal(badHost.status, 403);
	assert.equal(badOrigin.status, 403);
	console.log('blocked', badHost.status, badOrigin.status);
	await badHost.body?.cancel();
	await badOrigin.body?.cancel();
} finally {
	// Each side owns resources. Closing the server must still be attempted if
	// closing the client rejects, so the two cleanup operations are nested.
	try {
		await client.close();
	} finally {
		try {
			await admissionApp.close();
		} finally {
			await listener?.close();
		}
	}
}

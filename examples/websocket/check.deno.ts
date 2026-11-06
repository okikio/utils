/** Test real upgrade, a message/reply, HTTP routing and connection cleanup. @module */
import { strict as assert } from 'node:assert';
import { listen } from './server.ts';
import { greet } from './client.ts';
const host = listen(0);
try {
	const status = new URL('/status', host.url);
	status.protocol = 'http:';
	const response = await fetch(status);
	assert.deepEqual(await response.json(), { connections: 0 });
	const message = await greet(host.url);
	assert.equal(message, 'Hello, Sam!');
	console.log(message);
	const rejected = await fetch(new URL('/socket', status));
	assert.equal(rejected.status, 400);
	await rejected.body?.cancel();
} finally {
	await host.close();
}

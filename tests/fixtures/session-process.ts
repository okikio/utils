/** Actual Node child process; stdout contains only framed protocol bytes. */
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import process from 'node:process';
import { Readable, Writable } from 'node:stream';
import * as child from '@okikio/activity/process';
import { Engine, Live } from './session-contract.ts';
import { open } from './session-server.ts';
const host = await open();
try {
	await using server = child.serve({
		engine: Engine,
		implementations: [Live],
		resources: host.resources,
		finalize: host.close,
		input: Readable.toWeb(process.stdin) as unknown as ReadableStream<Uint8Array>,
		output: Writable.toWeb(process.stdout) as unknown as WritableStream<Uint8Array>,
	});
	await server.closed;
} finally {
	await host.close();
}

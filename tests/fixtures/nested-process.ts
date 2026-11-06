/** Actual Node child process with protocol-only stdout. */
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import { Readable, Writable } from 'node:stream';
import process from 'node:process';
import * as context from '@okikio/context';
import * as resource from '@okikio/capability/resource';
import * as child from '@okikio/activity/process';
import { Engine, Live, StateLive } from './nested-contract.ts';
await using owner = context.create({ id: 'nested-process' });
await using resources = resource.create(resource.implementations(StateLive), { ctx: owner, host: {} });
await using server = child.serve({
	engine: Engine,
	implementations: [Live],
	resources,
	input: Readable.toWeb(process.stdin) as unknown as ReadableStream<Uint8Array>,
	output: Writable.toWeb(process.stdout) as unknown as WritableStream<Uint8Array>,
});
await server.closed;

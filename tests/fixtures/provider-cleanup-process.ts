/** Native child process entry; stdout carries protocol frames exclusively. @module */
import process from 'node:process';
import { Readable, Writable } from 'node:stream';
import * as context from '@okikio/context';
import * as resource from '@okikio/capability/resource';
import * as provider from '@okikio/activity/process';
import { Engine, Live } from './provider-cleanup.ts';
await using ctx = context.create({ id: 'cleanup-native' });
await using resources = resource.create(resource.implementations(), { ctx, host: {} });
await using server = provider.serve({
	engine: Engine,
	implementations: [Live],
	resources,
	// Node and DOM declarations name this same byte stream differently.
	input: Readable.toWeb(process.stdin) as unknown as ReadableStream<Uint8Array>,
	output: Writable.toWeb(process.stdout),
});
await server.closed;

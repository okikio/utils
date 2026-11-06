/** A real Deno child serving the shared provider corpus over bounded JSON frames. */
import * as context from '@okikio/context';
import * as resource from '@okikio/capability/resource';
import * as process from '@okikio/activity/process';
import { Engine, Live } from './provider-contract.ts';
await using ctx = context.create({ id: 'native-provider' });
await using resources = resource.create(resource.implementations(), { ctx, host: {} });
await using server = process.serve({
	engine: Engine,
	maximumFrameBytes: 3_000_000,
	implementations: [Live],
	resources,
	input: Deno.stdin.readable,
	output: Deno.stdout.writable,
});
await server.closed;

import * as activityProcess from '@okikio/activity/process';
import * as context from '@okikio/context';
import * as resource from '@okikio/resource';
import { Engine, ExecuteLive } from './process-activity.ts';

await using owner = context.create({ id: `scenario.process-host:${Deno.pid}` });
await using resources = resource.create(resource.implementations(), { ctx: owner, host: Object.freeze({}) });
await using server = activityProcess.serve({
	engine: Engine,
	implementations: [ExecuteLive],
	resources,
	input: Deno.stdin.readable,
	output: Deno.stdout.writable,
});
await server.closed;

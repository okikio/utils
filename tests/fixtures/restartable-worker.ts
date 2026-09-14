import * as activityWorker from '@okikio/activity/worker';
import * as context from '@okikio/context';
import * as resource from '@okikio/resource';
import { Engine, PersistLive } from './restartable-activity.ts';

await using owner = context.create({ id: 'scenario.restartable-worker.host' });
await using resources = resource.create(resource.implementations(), { ctx: owner, host: Object.freeze({}) });
await using server = activityWorker.serve({
	engine: Engine,
	implementations: [PersistLive],
	resources,
});
await server.closed;

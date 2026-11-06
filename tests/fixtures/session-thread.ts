/** Actual Node thread. Host cleanup is acknowledged only after session values and the borrowed-pool owner close. */
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import * as worker from '@okikio/activity/worker';
import * as native from '@okikio/runtime/node/worker';
import { Engine, Live } from './session-contract.ts';
import { open } from './session-server.ts';
const host = await open();
using scope = native.scope();
try {
	await using server = worker.serve({
		engine: Engine,
		implementations: [Live],
		resources: host.resources,
		scope,
		finalize: host.close,
	});
	await server.closed;
} finally {
	await host.close();
}

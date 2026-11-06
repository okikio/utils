/** Echo validated messages inside the real benchmark Worker realm. */
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import * as worker from '@okikio/worker/thread';
import * as schema from '@okikio/schema';
worker.serve({
	protocol: worker.protocol({ request: schema.string(), response: schema.string() }),
	run: (value) => value.toUpperCase(),
});

/** Echo validated messages inside the real benchmark Worker realm. */
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import * as worker from '@okikio/worker';
import { z } from 'zod';
worker.serve({
	protocol: worker.protocol({ request: z.string(), response: z.string() }),
	run: (value) => value.toUpperCase(),
});

/** Native Worker receives an owned transferred backing store and returns only its visible byte count. */
import * as thread from '@okikio/worker/thread';
import { Protocol } from './worker-budget-protocol.ts';
thread.serve({
	protocol: Protocol,
	run(value) {
		return value.byteLength;
	},
});

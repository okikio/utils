import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import { exit } from 'node:process';
import * as context from '@okikio/context';
import * as worker from '@okikio/worker/thread';
import { serve } from '../worker.ts';
import { Protocol } from './protocol.ts';

const server = serve({
	protocol: Protocol,
	async run(request, ctx, control) {
		if (request.mode === 'crash') exit(17);
		if (request.mode === 'wait') {
			ctx.defer(async () => {
				await context.delay(20);
				Atomics.store(new Int32Array(request.flag!), 0, 1);
			});
			await control.notify(request.value);
			await context.waitFor(ctx, () => () => {});
		}
		if (request.mode === 'stubborn') {
			await control.notify(request.value);
			await new Promise(() => {});
		}
		if (request.mode === 'transfer') return worker.reply(request.bytes!, [request.bytes!]);
		await control.notify(request.value);
		return await control.call(request.value);
	},
});
await server.closed;

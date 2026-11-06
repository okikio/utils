import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import * as context from '@okikio/context';
import * as workers from '@okikio/worker/thread';
import { Protocol } from '../node/fixtures/protocol.ts';

const server = workers.serve({
	protocol: Protocol,
	async run(request, ctx, control) {
		if (request.mode === 'wait') {
			ctx.defer(async () => {
				await context.delay(20);
				if (request.flag) Atomics.store(new Int32Array(request.flag), 0, 1);
			});
			await control.notify(request.value);
			await context.waitFor(ctx, () => () => {});
		}
		if (request.mode === 'stubborn') {
			await control.notify(request.value);
			await new Promise(() => {});
		}
		if (request.mode === 'transfer') return workers.reply(request.bytes!, [request.bytes!]);
		await control.notify(request.value);
		return await control.call(request.value);
	},
});
await server.closed;

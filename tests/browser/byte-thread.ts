/** Actual browser Worker entry; its application transfers one dedicated stream port. @module */
import '@okikio/dispose/polyfill';
import '@okikio/duration/polyfill';
import * as context from '@okikio/context';
import * as stream from '@okikio/worker/stream';

self.addEventListener('message', async (event: MessageEvent<MessagePort>) => {
	await using ctx = context.create({ id: 'browser-byte-producer' });
	await using producer = stream.serve(ctx, event.data, async function* (owner) {
		owner.defer(() => {
			self.postMessage('cleaned');
		});
		yield new TextEncoder().encode('hello ');
		yield new TextEncoder().encode('world');
	}, { maximumChunkBytes: 64, maximumChunks: 2, maximumBytes: 64 });
	await producer.closed;
}, { once: true });

// @installed-consumer: Run this public-import scenario against packed artifacts too.
/** Public protocol consumers also run against physically installed ESM archives. @module */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as context from '@okikio/context';
import * as events from '@okikio/streams/events';
import * as stream from '@okikio/worker/stream';
import { EventBus } from '@okikio/observables/events';

describe('public native event and port streaming protocols', () => {
	it('keeps native dispatch while providing bounded EventBus and EventTarget piping', async () => {
		const target = new EventTarget();
		const seen: Event[] = [];
		using _observation = events.observe(target, 'value').subscribe((event) => {
			seen.push(event);
			event.preventDefault();
		});
		const original = new Event('value', { cancelable: true });
		assert.equal(target.dispatchEvent(original), false);
		assert.equal(seen[0], original);
		using bus = new EventBus<number>();
		const readable = events.readable(bus.events, { maximumItems: 2, overflow: 'drop-oldest' });
		bus.emit(1);
		bus.emit(2);
		bus.emit(3);
		bus.close();
		const values: number[] = [];
		await readable.pipeTo(
			new WritableStream<number>({
				write(value) {
					values.push(value);
				},
			}),
		);
		assert.deepEqual(values, [2, 3]);
	});
	it('joins dedicated-port producer cleanup after a bounded native stream round trip', async () => {
		await using owner = context.create({ id: 'installed-byte-stream' });
		const { port1, port2 } = new MessageChannel();
		const policy = { maximumChunkBytes: 16, maximumChunks: 2, maximumBytes: 16 };
		let released = false;
		await using producer = stream.serve(owner, port1, async function* (ctx) {
			ctx.defer(() => {
				released = true;
			});
			yield Uint8Array.of(1, 2);
			yield Uint8Array.of(3);
		}, policy);
		await using receiver = stream.open(owner, port2, { ...policy, id: 'bytes', timeout: 1000 });
		const received: number[] = [];
		await receiver.readable.pipeTo(
			new WritableStream<Uint8Array>({
				write(bytes) {
					received.push(...bytes);
				},
			}),
		);
		assert.deepEqual(received, [1, 2, 3]);
		assert.equal(released, true);
		assert.equal((await receiver.closed).status, 'complete');
		assert.equal((await producer.closed).status, 'complete');
	});
});

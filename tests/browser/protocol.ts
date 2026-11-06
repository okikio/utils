/** Native DOM event semantics and dedicated-port streaming in the real browser. @module */
import '@okikio/dispose/polyfill';
import '@okikio/duration/polyfill';
import * as context from '@okikio/context';
import * as events from '@okikio/streams/events';
import * as stream from '@okikio/worker/stream';

/** Browser assertions throw at the violated consumer contract, without a test-runner dependency. */
function assert(value: unknown, message: string): asserts value {
	if (!value) throw new Error(message);
}

/** Verify original events, capture/bubble/passive/shadow targeting, stream piping and actual Worker cleanup. */
export async function verify(workerUrl: string): Promise<string[]> {
	const parent = document.createElement('div'), child = document.createElement('button');
	parent.append(child);
	document.body.append(parent);
	try {
		const order: string[] = [];
		const original = new MouseEvent('click', { bubbles: true, cancelable: true });
		using capture = events.observe<MouseEvent>(parent, 'click', { capture: true, passive: false }).subscribe(
			(event) => {
				assert(
					event === original && event.target === child && event.currentTarget === parent,
					'Native target/currentTarget/event identity changed.',
				);
				order.push('capture');
				event.preventDefault();
			},
		);
		child.addEventListener('click', () => order.push('native'), { once: true });
		using bubble = events.observe(parent, 'click').subscribe(() => order.push('bubble'));
		assert(!child.dispatchEvent(original), 'Synchronous observation lost native preventDefault.');
		assert(order.join(',') === 'capture,native,bubble', 'Capture/native/bubble ordering changed.');
		capture.unsubscribe();
		bubble.unsubscribe();
		using _passive = events.observe(child, 'passive', { passive: true }).subscribe((event) => event.preventDefault());
		assert(child.dispatchEvent(new Event('passive', { cancelable: true })), 'Passive observation cancelled an event.');
		const host = document.createElement('div');
		parent.append(host);
		const shadow = host.attachShadow({ mode: 'open' }), inner = document.createElement('button');
		shadow.append(inner);
		let shadowSeen = false;
		using _shadowEvents = events.observe(parent, 'nested').subscribe((event) => {
			assert(event.target === host && event.composedPath()[0] === inner, 'Shadow retargeting/composedPath changed.');
			shadowSeen = true;
		});
		inner.dispatchEvent(new Event('nested', { bubbles: true, composed: true }));
		assert(shadowSeen, 'Composed event was lost.');
		const abort = new AbortController(), values: number[] = [];
		const input = events.readable(events.observe<CustomEvent<number>>(child, 'value'), {
			maximumItems: 2,
			overflow: 'error',
		});
		const pipe = input.pipeThrough(
			new TransformStream<CustomEvent<number>, number>({
				transform(event, controller) {
					controller.enqueue(event.detail);
				},
			}),
		)
			.pipeTo(
				new WritableStream<number>({
					write(value) {
						values.push(value);
						abort.abort('done');
					},
				}),
				{ signal: abort.signal },
			).catch((error: unknown) => error);
		child.dispatchEvent(new CustomEvent('value', { detail: 7 }));
		assert(await pipe === 'done' && values[0] === 7, 'Event stream piping/cancellation failed.');
		child.dispatchEvent(new CustomEvent('value', { detail: 8 }));
		assert(values.length === 1, 'Cancelled pipeline received another event.');
	} finally {
		parent.remove();
	}
	await using ctx = context.create({ id: 'browser-byte-reader' });
	const worker = new Worker(workerUrl, { type: 'module' });
	try {
		const cleaned = new Promise<void>((resolve, reject) => {
			worker.addEventListener('message', (event) => {
				if (event.data === 'cleaned') resolve();
			}, { once: true });
			worker.addEventListener('error', (event) => reject(event.error), { once: true });
		});
		const { port1, port2 } = new MessageChannel();
		worker.postMessage(port2, [port2]);
		await using receiver = stream.open(ctx, port1, {
			id: 'browser-words',
			maximumChunkBytes: 64,
			maximumChunks: 2,
			maximumBytes: 64,
			timeout: 5000,
		});
		const words: string[] = [];
		await receiver.readable.pipeThrough(new TextDecoderStream()).pipeTo(
			new WritableStream<string>({
				write(value) {
					words.push(value);
				},
			}),
		);
		assert(words.join('') === 'hello world', 'Native Worker byte order changed.');
		assert((await receiver.closed).status === 'complete', 'Native Worker lacked a terminal receipt.');
		await cleaned;
	} finally {
		worker.terminate();
	}
	return [
		'native EventTarget identity/capture/bubble/passive/shadow semantics',
		'bounded Observable to native stream piping',
		'real module Worker credit/byte/cleanup protocol',
	];
}

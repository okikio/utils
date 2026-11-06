import { clipboard, feedback, files, forms, gestures, keys, pointer, text } from '@okikio/input';
import * as events from '@okikio/context/events';
import * as webState from '@okikio/storage/state/web';
import type { RawWorker, WorkerFactory, WorkerTransferable } from '@okikio/worker/thread';
import './core.ts';

/** Native Storage and LockManager are accepted directly, with no casts or widened ambient globals. */
export function persistedDraft(storage: Storage, locks: LockManager): void {
	const slot = webState.open({ storage, key: 'editor.draft', mode: 'locked', locks });
	void slot;
	// @ts-expect-error Concurrent writers require an explicitly supplied lock service.
	webState.open({ storage, key: 'editor.draft', mode: 'locked' });
}

/** A native browser worker satisfies the portable protocol without changing standard transfer types. */
export function workerHost(worker: Worker, transferable: Transferable): void {
	const raw: RawWorker = worker;
	const factory: WorkerFactory = (url, options) => new Worker(url, options);
	const protocolTransfer: WorkerTransferable = transferable;
	const nativeTransfer: Transferable = protocolTransfer;
	void [raw, factory, nativeTransfer];
}

/** A real DOM target retains full native events and elements at public call sites. */
export function browser(panel: HTMLDivElement, signal: AbortSignal, worker: Worker, socket: WebSocket): void {
	keys.listen(window, [{
		key: 'j',
		run(event) {
			const native: KeyboardEvent = event;
			void native.location;
		},
	}]);
	pointer.listen(panel, {
		move({ event }) {
			const native: PointerEvent = event;
			void native.pressure;
		},
	});
	gestures.swipe(panel, ({ event }) => {
		const native: PointerEvent = event;
		void native.pressure;
	});
	events.from({ signal }, window, 'keydown').subscribe((event) => {
		const native: KeyboardEvent = event;
		void native.location;
		// @ts-expect-error A key event is not a pointer event.
		void event.pointerId;
	});
	for (const source of [window, worker]) {
		events.from({ signal }, source, 'error').subscribe((event) => {
			const native: ErrorEvent = event;
			void native.message;
			// @ts-expect-error An error event is not a keyboard event.
			void event.key;
		});
	}
	events.from({ signal }, socket, 'error').subscribe((event) => {
		const native: Event = event;
		void native.type;
		// @ts-expect-error WebSocket error events do not inherit Window's ErrorEvent details.
		void event.message;
	});
}

/** Native SVG, AudioContext, Animation and gamepad hosts retain their full platform contracts. */
export function feedbackHosts(
	svg: SVGSVGElement,
	region: HTMLElement,
	audio: AudioContext,
	actuator: GamepadHapticActuator,
): void {
	pointer.listen(svg, {
		move({ event }) {
			const pressure: number = event.pressure;
			void pressure;
		},
	});
	void feedback.vibrate(navigator, 20);
	void feedback.tone(audio);
	void feedback.rumble(actuator);
	void feedback.rotate(svg);
	using announcements = feedback.announcer(region);
	announcements.announce('Saved');
}

/** File and original event types survive browser collection, including native form submitter handling. */
export function nativeCollection(form: HTMLFormElement, control: HTMLInputElement, editor: HTMLTextAreaElement): void {
	const chosen: readonly File[] = files.from(control.files);
	void chosen;
	files.listen(control, ({ files: selected, event }) => {
		const native: Event = event;
		void native.target;
		for (const file of selected) {
			const stream: ReadableStream<Uint8Array> = file.stream();
			void stream;
		}
	});
	for (const [, value] of forms.read(form)) {
		if (typeof value !== 'string') {
			const file: File = value;
			void file.arrayBuffer();
		}
	}
	void files.pick(window).then((selected) => {
		const native: readonly File[] = selected;
		for (const file of native) void file.arrayBuffer();
	});
	for (const [, value] of forms.read(new FormData(form))) {
		if (typeof value !== 'string') {
			const file: File = value;
			void file.slice();
		}
	}
	forms.listen(form, ({ entries, event }) => {
		const submitted: SubmitEvent = event;
		void submitted.submitter;
		for (const [, value] of entries) {
			if (typeof value !== 'string') {
				const file: File = value;
				void file.text();
			}
		}
	});
	text.listen(editor, ({ value, event }) => {
		const native: Event = event;
		const content: string = value;
		void native;
		void content;
	});
	clipboard.listen(editor, ({ event }) => {
		const native: ClipboardEvent = event;
		void native.clipboardData;
	});
}

// @ts-expect-error Importing portable packages must not introduce Node globals.
void process;
// @ts-expect-error Importing portable packages must not introduce Deno globals.
void Deno;

/** Native browser ports and typed event observations work without adapters or casts. */
export async function nativePipes(
	ctx: import('@okikio/context').Context,
	port: MessagePort,
	element: HTMLElement,
): Promise<void> {
	const stream = await import('@okikio/worker/stream');
	const events = await import('@okikio/streams/events');
	await using receiver = stream.open(ctx, port, {
		id: 'browser',
		maximumChunkBytes: 8,
		maximumChunks: 1,
		maximumBytes: 8,
		timeout: 1000,
	});
	const clicks = events.observe<MouseEvent>(element, 'click', { capture: true, passive: false });
	using _subscription = clicks.subscribe((event) => {
		const value: MouseEvent = event;
		value.preventDefault();
	});
	const input: ReadableStream<MouseEvent> = events.readable(clicks, { maximumItems: 2, overflow: 'error' });
	void [input, receiver];
}

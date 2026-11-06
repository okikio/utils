import * as events from '@okikio/context/events';
import * as webState from '@okikio/storage/state/web';
import type { RawWorkerScope, WorkerTransferable } from '@okikio/worker/thread';
import './core.ts';

/** A worker can coordinate a supplied synchronous storage mock without acquiring Window's Storage globals. */
export function workerState(storage: webState.WebStorage, locks: LockManager): void {
	const slot = webState.open({ storage, key: 'worker.progress', mode: 'locked', locks });
	void slot;
	// @ts-expect-error Browser storage adapters do not invent an asynchronous read protocol.
	const asynchronous: webState.WebStorage = { getItem: async () => null, setItem() {} };
	void asynchronous;
}

/** A standard dedicated worker can serve the same protocol as a structural test host. */
export function workerScope(scope: DedicatedWorkerGlobalScope, transferable: Transferable): void {
	const raw: RawWorkerScope = scope;
	const protocolTransfer: WorkerTransferable = transferable;
	const nativeTransfer: Transferable = protocolTransfer;
	void [raw, nativeTransfer];
}

const worker: WorkerGlobalScope = self;
void worker;
const updates = events.from({ signal: new AbortController().signal }, new MessageChannel().port1, 'message');
updates.subscribe((event) => {
	const message: MessageEvent = event;
	void message.data;
});
events.from({ signal: new AbortController().signal }, worker, 'error').subscribe((event) => {
	const native: ErrorEvent = event;
	void native.message;
	// @ts-expect-error A Worker error event is not a message event.
	void event.data;
});
const custom: events.Source<{ reason: string }> = { addEventListener() {}, removeEventListener() {} };
events.from({ signal: new AbortController().signal }, custom, 'error').subscribe((event) => {
	const reason: string = event.reason;
	void reason;
	// @ts-expect-error A structural Worker's source retains its own error payload.
	void event.filename;
});

// @ts-expect-error Worker consumers must not acquire a DOM window through a library reference.
void window;
// @ts-expect-error Worker consumers must not acquire a DOM document through a library reference.
void document;
// @ts-expect-error A Worker does not have Node's process global.
void process;
// @ts-expect-error A standard Worker does not have Deno's host global.
void Deno;

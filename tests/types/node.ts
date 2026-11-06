import './core.ts';
import * as events from '@okikio/context/events';
import '@okikio/activity/worker';
import '@okikio/runtime/node/worker';
import type { WorkerTransferable } from '@okikio/worker/thread';
import type { Transferable } from 'node:worker_threads';

/** Node transfer values retain their native type without requiring Window or a DOM Worker declaration. */
export function transfer(value: Transferable): WorkerTransferable {
	const protocol: WorkerTransferable = value;
	const native: Transferable = protocol;
	return native;
}
// @ts-expect-error A plain data object is cloneable but cannot be transferred by the native Node host.
const invalidObject: WorkerTransferable = { value: 1 };
// @ts-expect-error A primitive is not a native transferable resource.
const invalidPrimitive: WorkerTransferable = 'text';
void [invalidObject, invalidPrimitive];

const version: string = process.version;
void version;
const target: EventTarget = new EventTarget();
void target;
const failures: events.Source<{ message: string }> = { addEventListener() {}, removeEventListener() {} };
events.from({ signal: new AbortController().signal }, failures, 'error').subscribe((event) => {
	const message: string = event.message;
	void message;
	// @ts-expect-error A structural source does not require native ErrorEvent properties.
	void event.filename;
});

// @ts-expect-error A Node consumer does not need Window declarations to use mock input targets.
void window;
// @ts-expect-error A Node consumer does not need Document declarations to use mock input targets.
void document;
// @ts-expect-error Node consumers must not accidentally acquire Deno host globals.
void Deno;

/** Node's native MessagePort implements the same portable byte endpoint as DOM ports. */
export async function nodeBytePort(): Promise<void> {
	const { MessageChannel } = await import('node:worker_threads');
	const { port1, port2 } = new MessageChannel();
	const port: import('@okikio/worker/stream').Port = port1;
	void port;
	port1.close();
	port2.close();
}

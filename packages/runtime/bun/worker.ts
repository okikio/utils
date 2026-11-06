/** Bun's module Worker API uses the standard shared transport and explicit per-realm setup. @module */
export { open, protocol, reply, serve } from '@okikio/worker/thread';
export type {
	WorkerHandle,
	WorkerOpenOptions,
	WorkerProtocol,
	WorkerServeOptions,
	WorkerServer,
} from '@okikio/worker/thread';

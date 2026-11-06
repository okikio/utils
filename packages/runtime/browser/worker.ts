/** Browser module Workers use the standard shared transport; no Node or Deno host code is imported. @module */
export { open, protocol, reply, serve } from '@okikio/worker/thread';
export type {
	WorkerHandle,
	WorkerOpenOptions,
	WorkerProtocol,
	WorkerServeOptions,
	WorkerServer,
} from '@okikio/worker/thread';

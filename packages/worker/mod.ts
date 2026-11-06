/**
 * Send checked requests to a thread or subprocess and receive checked results.
 *
 * The caller owns the execution session and its cleanup. The protocol describes the data that crosses the
 * boundary; live closures and connections stay with their owners. Select thread or process explicitly, and
 * keep cancellation separate from proof that cleanup finished.
 *
 * @module
 */
export * as thread from './thread/mod.ts';
export * as process from './process/mod.ts';
export * as protocol from './protocol.ts';

export * as stream from './stream/mod.ts';

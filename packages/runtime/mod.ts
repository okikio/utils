/**
 * Select the adapter for the host that runs the application: Deno, Node, Bun, or a browser.
 *
 * Use a focused subpath for host capabilities such as threads, subprocesses, or listeners. The root does
 * not guess a host. Keep portable definitions separate from the executable that opens and closes those
 * host resources.
 *
 * @module
 */
/** Hosts with tested adapter entry points in this package. */
export type Host = 'deno' | 'node' | 'bun' | 'browser';

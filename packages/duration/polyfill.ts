/**
 * Install Temporal only when the host does not provide it.
 *
 * Import this module first at an application entry point. It lets duration,
 * context, queue, pool and workflow code run on hosts without global Temporal.
 * Libraries keep this choice with the application; ordinary utility imports do
 * not install globals. Each Worker or process has its own global and needs its
 * own entry-point import. An existing native implementation is preserved.
 *
 * @example
 * ```ts
 * import '@okikio/duration/polyfill';
 * import { milliseconds } from '@okikio/duration';
 * console.log(milliseconds('PT2.5S')); // 2500
 * ```
 * @module
 */
import { Temporal } from './temporal.ts';

if (globalThis.Temporal === undefined) {
	Object.defineProperty(globalThis, 'Temporal', {
		value: Temporal,
		configurable: true,
		writable: true,
		enumerable: false,
	});
}

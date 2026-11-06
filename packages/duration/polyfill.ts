/**
 * Install Temporal only when the host does not provide it.
 *
 * Use this explicit application import only when application code or another
 * dependency reads globalThis.Temporal. Duration and the utilities that import
 * its local Temporal provider do not need global installation.
 *
 * The import preserves an existing native implementation. Each Worker or process
 * has its own global, so an application that needs the global there must install
 * it in that entry point too. This module does not transfer a global to another host.
 *
 * @example
 * ```ts
 * import '@okikio/duration/polyfill';
 * import { elapsed } from '@okikio/duration';
 * console.log(elapsed('PT2.5S')); // 2500
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

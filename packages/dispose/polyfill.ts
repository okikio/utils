/**
 * Install only missing disposal globals at an executable entry point.
 *
 * Libraries can import constructors and protocol keys from @okikio/dispose/ponyfill
 * without changing their host. This explicit installer reuses those bindings and preserves
 * existing native constructors and symbols. It cannot add using syntax to an older parser.
 * @module
 */
import { AsyncDisposableStack, asyncDispose, DisposableStack, dispose, SuppressedError } from './ponyfill.ts';

for (const [name, value] of [['dispose', dispose], ['asyncDispose', asyncDispose]] as const) {
	if (typeof Symbol[name] !== 'symbol') {
		Object.defineProperty(Symbol, name, { value, enumerable: false, configurable: false, writable: false });
	}
}
for (
	const [name, value] of [['SuppressedError', SuppressedError], ['DisposableStack', DisposableStack], [
		'AsyncDisposableStack',
		AsyncDisposableStack,
	]] as const
) {
	if (globalThis[name] === undefined) {
		Object.defineProperty(globalThis, name, { value, enumerable: false, configurable: true, writable: true });
	}
}

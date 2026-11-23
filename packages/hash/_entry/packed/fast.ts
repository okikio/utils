/**
 * Fast-hash family on the WebAssembly module embedded in this JavaScript, and nothing else.
 *
 * `ready()` decodes and compiles the embedded module; until it resolves, calls throw `NotReadyError`. Nothing
 * falls back to `node:crypto` or pure JavaScript. Use it to pin the backend in tests or audits.
 *
 * ```ts ignore
 * import { hash, ready } from '@okikio/hash/fast/packed';
 *
 * await ready();
 * hash('xxh3-64', 'hello');
 * ```
 *
 * @module
 */
import type { InputType } from '../../_bytes.ts';
import { type HashOptionsType, runtime } from '../../_family.ts';
import type { HasherType } from '../../_hasher.ts';
import type { SourceType } from '../../_wasm/load.ts';
import type { NameType } from '../../_wasm/registry.ts';
import { wide } from '../../_wasm/wide.ts';
export { CollisionError, NotReadyError, UnsupportedError } from '../../_family.ts';
export type { HashOptionsType } from '../../_family.ts';
export type { HasherType } from '../../_hasher.ts';
export type { InputType } from '../../_bytes.ts';
export type { SourceType } from '../../_wasm/load.ts';

/** Algorithm names this entry point runs. */
export type AlgorithmType = NameType<'fast'>;

const family = runtime({
	family: 'fast',
	mode: 'wasm',
	packed: async () =>
		(wide() ? await import('../../_wasm/packed/fast-wide.ts') : await import('../../_wasm/packed/fast.ts')).text,
});

/** Decode and compile the embedded module, or use `source` instead. Before it resolves, calls throw `NotReadyError`. */
export function ready(source?: SourceType): Promise<void> {
	return family.ready(source);
}

/** Hash complete input with this backend only. Text is UTF-8. */
export function hash(name: AlgorithmType, input: InputType, options?: HashOptionsType): Uint8Array {
	return family.hash(name, input, options);
}

/** Start an incremental state with this backend only. */
export function create(name: AlgorithmType, options?: HashOptionsType): HasherType {
	return family.create(name, options);
}

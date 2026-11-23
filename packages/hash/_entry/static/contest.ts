/**
 * Static WebAssembly SHA-3 competition designs and Whirlpool: Grøstl, JH, Skein, Shabal and Whirlpool.
 *
 * For hosts that allow only statically analyzable imports and refuse to compile WebAssembly at runtime,
 * such as Cloudflare Workers. This entry point has no dynamic import, no `import.meta.url`, no fetch and no
 * embedded module. Import the `.wasm` file with your bundler and pass the compiled module to `ready()`;
 * Wrangler and the Cloudflare Vite plugin turn a default `.wasm` import into a `WebAssembly.Module`.
 *
 * ```ts ignore
 * import wasm from '@okikio/hash/wasm/contest.wasm';
 * import { hash, ready } from '@okikio/hash/contest/static';
 *
 * await ready(wasm);
 * hash('skein512-512', 'hello');
 * ```
 *
 * Nothing falls back to another backend. Elsewhere, prefer the default `@okikio/hash/contest` entry.
 *
 * @module
 */
import type { InputType } from '../../_bytes.ts';
import type { HasherType } from '../../_hasher.ts';
import { type HashOptionsType, runtime } from '../../_runtime.ts';
import { attach, type CompiledType } from '../../_wasm/attach.ts';
import type { NameType } from '../../_wasm/registry.ts';

export { CollisionError, NotReadyError, UnsupportedError } from '../../_runtime.ts';
export type { HashOptionsType } from '../../_runtime.ts';
export type { HasherType } from '../../_hasher.ts';
export type { InputType } from '../../_bytes.ts';
export type { CompiledType } from '../../_wasm/attach.ts';

/** Algorithm names of this family. */
export type AlgorithmType = NameType<'contest'>;

const family = runtime<'contest', CompiledType>({ family: 'contest', mode: 'wasm' }, { load: attach });

/**
 * Attach the compiled module: a `WebAssembly.Module`, an `Instance`, the exports of a WASM ESM import, or a
 * namespace whose `default` is one of these. Bytes and URLs are refused.
 */
export function ready(source: CompiledType): Promise<void> {
	return family.ready(source);
}

/** Hash complete input. Throws `NotReadyError` before `ready()` resolves. Text is UTF-8. */
export function hash(name: AlgorithmType, input: InputType, options?: HashOptionsType): Uint8Array {
	return family.hash(name, input, options);
}

/** Start an incremental state. Throws `NotReadyError` before `ready()` resolves. */
export function create(name: AlgorithmType, options?: HashOptionsType): HasherType {
	return family.create(name, options);
}

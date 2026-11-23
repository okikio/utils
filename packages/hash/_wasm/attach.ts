/**
 * Turn a compiled family module into an {@link Engine}, with no fetch, no file read and no compile.
 *
 * Hosts such as Cloudflare Workers refuse to compile WebAssembly at runtime. There the application
 * imports the `.wasm` file with its bundler (Wrangler and the Cloudflare Vite plugin turn
 * `import wasm from './sha2.wasm'` into a `WebAssembly.Module`) and passes the result here.
 * Instantiating a compiled module is allowed everywhere.
 *
 * @module
 */
import { Engine, type ExportsType } from './engine.ts';

/**
 * A module that is already compiled: the exports of a WASM ESM import, a `WebAssembly.Module` (from a
 * bundler's `.wasm` import or `import source`), an `Instance`, or a namespace whose `default` is one of
 * these.
 */
export type CompiledType = ExportsType | WebAssembly.Module | WebAssembly.Instance | { readonly default: unknown };

const names = ['memory', 'window', 'init', 'update', 'finish', 'read', 'fork', 'dispose', 'oneshot'] as const;

/** Check that `value` has every family export. */
export function exportsOf(value: unknown): ExportsType {
	const record = value as Record<string, unknown>;
	for (const name of names) {
		const item = record[name];
		if (name === 'memory' ? !(item instanceof WebAssembly.Memory) : typeof item !== 'function') {
			throw new TypeError(`not a hash family module: missing export ${name}`);
		}
	}
	return value as ExportsType;
}

/** Instantiate a compiled module. */
export async function instance(module: WebAssembly.Module): Promise<ExportsType> {
	return exportsOf((await WebAssembly.instantiate(module, {})).exports);
}

/** Wrap a compiled module. Bytes, URLs and responses are refused: compiling them is what this avoids. */
export async function attach(source: CompiledType): Promise<Engine> {
	if (source instanceof WebAssembly.Instance) return new Engine(exportsOf(source.exports));
	if (source instanceof WebAssembly.Module) return new Engine(await instance(source));
	if (source instanceof ArrayBuffer || ArrayBuffer.isView(source) || source instanceof URL) {
		throw new TypeError('A static entry point takes a compiled module; import the .wasm file instead.');
	}
	const inner = (source as { default?: unknown }).default;
	if (inner instanceof WebAssembly.Module || inner instanceof WebAssembly.Instance) {
		return await attach(inner);
	}
	return new Engine(exportsOf(source));
}

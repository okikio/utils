/**
 * The runtime behind every family entry point: which backend hashes a call, and how the WebAssembly
 * module gets loaded.
 *
 * ```text
 *   hash(name, input)            automatic entry (`@okikio/hash/sha3`)
 *     ├─ the host has it natively, and it is SHA-1/SHA-2 ≥ 512 B or CRC-32 ≥ 4 KiB ───────► native
 *     │   (on Bun: any SHA size, CRC-32 ≥ 512 B)
 *     ├─ the module is loaded ────────────────────────────────────────────────────────► WASM
 *     ├─ the host has it natively ─────────────────────────────────────────────────────► native
 *     ├─ @noble/hashes has it ─────────────────────────────────────────────────────────► portable
 *     └─ otherwise ─► NotReadyError (module still loading) or UnsupportedError (it cannot load)
 *
 *   hash(name, input)            WASM entry (`@okikio/hash/sha3/wasm`)
 *     ├─ the module is loaded ─► WASM
 *     └─ otherwise ─► NotReadyError
 * ```
 *
 * The automatic entry starts loading its packed module on first use, so the first calls may run on a
 * fallback and later calls on WASM. Every backend returns the same bytes; `wasm.test.ts` and
 * `entries.test.ts` check that. The WASM entry loads nothing until `ready()` is called.
 *
 * This file imports no loader. The caller passes one: `_family.ts` passes the full loader (bytes, URLs,
 * responses, packed text), and the static entries pass `_wasm/attach.ts`, which takes compiled modules
 * only. So a static entry's import graph has no fetch, no file read and no runtime compile, which hosts
 * such as Cloudflare Workers refuse.
 *
 * @module
 */
import { type InputType, view } from './_bytes.ts';
import { output } from './_wasm/slab.ts';
import { type HasherType, type StateType, wrap } from './_hasher.ts';
import type { Engine, State } from './_wasm/engine.ts';
import type { SourceType } from './_wasm/load.ts';
import { type AlgorithmType, families, type FamilyType, type NameType } from './_wasm/registry.ts';

/** Thrown by a synchronous call that needs a module which is not loaded yet. Await `ready()` first. */
export class NotReadyError extends Error {
	override name = 'NotReadyError';
}

/** Thrown when no backend on this host implements the algorithm with these options. */
export class UnsupportedError extends Error {
	override name = 'UnsupportedError';
}

/** Options for one hash. */
export interface HashOptionsType {
	/** HMAC key, the algorithm's own key or seed, or customization bytes; see each family's docs. */
	readonly key?: InputType;
	/** Output length in bytes, for algorithms with a variable output. */
	readonly length?: number;
}

/** How one algorithm runs outside WASM. Each builder returns `undefined` for options it cannot honor. */
export interface FallbackType {
	/** The `node:crypto` name, if OpenSSL has the algorithm. */
	readonly native?: string;
	/**
	 * A native state from another built-in module, for an algorithm OpenSSL lacks: CRC-32 through `node:zlib`.
	 * Returns `undefined` where the host has no such module. Keys are never passed to it.
	 */
	readonly host?: () => HostStateType | undefined;
	/** True when OpenSSL takes `outputLength` for it (SHAKE). */
	readonly xof?: boolean;
	/** True when `node:crypto` HMAC over it matches the module's HMAC. */
	readonly hmac?: boolean;
	/** A pure JavaScript state, from `@noble/hashes` or the package's own code. */
	readonly portable?: (key: Uint8Array | undefined, length: number) => StateType | undefined;
}

/** The part of `node:crypto` the fallback uses. */
interface CryptoType {
	createHash(name: string, options?: { outputLength?: number }): NodeHashType;
	createHmac(name: string, key: Uint8Array): NodeHashType;
	getHashes(): string[];
}

/** A native incremental state: a `node:crypto` Hash, or a `host` state with the same methods. */
export interface HostStateType {
	update(data: Uint8Array): HostStateType;
	digest(): Uint8Array;
	/** An independent copy of the state so far. Without it, `clone()` throws `UnsupportedError`. */
	copy?(): HostStateType;
}

interface NodeHashType {
	update(data: Uint8Array): NodeHashType;
	digest(): Uint8Array;
	copy?(): NodeHashType;
}

let host: { crypto: CryptoType | undefined; hashes: Set<string> } | undefined;

/** `node:crypto`, looked up on first use so that importing an entry point runs no host lookup. */
function nodeCrypto(): { crypto: CryptoType | undefined; hashes: Set<string> } {
	if (host) return host;
	let crypto: CryptoType | undefined;
	try {
		const process = (globalThis as { process?: { getBuiltinModule?(id: string): unknown } }).process;
		const found = process?.getBuiltinModule?.('node:crypto') as Partial<CryptoType> | undefined;
		if (typeof found?.createHash === 'function') crypto = found as CryptoType;
	} catch {
		// No usable node:crypto on this host.
	}
	return host = { crypto, hashes: new Set(crypto?.getHashes() ?? []) };
}

const bun = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';
/** SHA-1 and SHA-2 use the CPU's SHA instructions in OpenSSL; WASM wins only below 512 bytes (docs/hash/04). */
const sha = bun ? 0 : 512;
/**
 * Algorithms whose native backend beats WASM from a size up, and that size. `zlib.crc32` uses the carry-less multiply
 * (5 to 99 GB/s) but costs about 1 µs per call in Deno and Node, so WASM stays faster below 4 KiB there (docs/hash/04).
 */
const accelerated = new Map<string, number>([
	...['sha1', 'sha224', 'sha256', 'sha384', 'sha512', 'sha512-224', 'sha512-256'].map((name) => [name, sha] as const),
	['CRC-32/ISO-HDLC', bun ? 512 : 4096],
]);

/** A `node:crypto` Hash as a package state. Buffers become plain `Uint8Array` copies. */
function nodeState(hash: NodeHashType): StateType {
	return {
		update(input) {
			hash.update(input);
			return this;
		},
		digest: () => output(hash.digest()),
		clone() {
			if (!hash.copy) throw new UnsupportedError('This native state cannot be copied (node:crypto HMAC).');
			return nodeState(hash.copy());
		},
		destroy() {},
	};
}

/** Thrown by `sha1-checked` for input that carries a known SHA-1 collision attack. */
export class CollisionError extends Error {
	override name = 'CollisionError';
}

/** The module writes no bytes when `sha1-checked` detects an attack; every other digest is non-empty. */
function checked(bytes: Uint8Array): Uint8Array {
	if (bytes.length === 0) throw new CollisionError('The input carries a known SHA-1 collision attack.');
	return bytes;
}

/** A module slot as a package state. */
function wasmState(state: State): StateType {
	return {
		update(input) {
			state.update(input);
			return this;
		},
		digest: () => checked(state.digest()),
		clone: () => wasmState(state.fork()),
		destroy: () => state[Symbol.dispose](),
	};
}

/**
 * Which backends an entry point may use.
 *
 * - `auto`: the rules at the top of this file.
 * - `wasm`: the module only; `ready()` loads the packed text if given, else the raw file.
 * - `native`: `node:crypto` only. - `portable`: pure JavaScript only.
 *
 * A forced mode never falls back, so a test or an audit can prove which code ran.
 */
export type ModeType = 'auto' | 'wasm' | 'native' | 'portable';

/** Where a family's runtime gets its module, and whether it may fall back. */
export interface RuntimeOptionsType<F extends FamilyType> {
	readonly family: F;
	readonly mode: ModeType;
	/**
	 * Packed module text, for `auto` and the packed `wasm` entry. A function loads it on demand, which lets a
	 * family choose between builds (the `fast` family picks its wide-arithmetic build where the host has it).
	 */
	readonly packed?: string | (() => Promise<string>);
	/** Location of the raw module, used by `ready()` without a source; a function chooses it on demand. */
	readonly raw?: URL | (() => URL);
	/** Fallbacks by algorithm name, for `auto`, `native` and `portable`. */
	readonly fallbacks?: Partial<Record<NameType<F>, FallbackType>>;
}

/** How a runtime turns a source into an engine. Static entries pass one without `unpack`. */
export interface LoaderType<S> {
	/** Instantiate a source the caller passed, or the raw file location. */
	load(source: S | URL): Promise<Engine>;
	/** Decode packed module text into a source `load` takes. Without it, the runtime refuses `packed`. */
	unpack?(text: string): Promise<S>;
}

/** The functions a family entry point exports. */
export interface RuntimeType<F extends FamilyType, S = SourceType> {
	/** Load the module. Pass a source to skip the default load; see `load.ts` for the accepted forms. */
	ready(source?: S): Promise<void>;
	/** Hash complete input synchronously. Text is UTF-8. */
	hash(name: NameType<F>, input: InputType, options?: HashOptionsType): Uint8Array;
	/** Start an incremental state. */
	create(name: NameType<F>, options?: HashOptionsType): HasherType;
	/** The backend that the next call for `name` would use, for tests and diagnostics. */
	backend(name: NameType<F>, length?: number, options?: HashOptionsType): 'native' | 'wasm' | 'portable' | 'none';
}

/** Build the runtime of one family entry point, with the loader its entry point allows. */
export function runtime<F extends FamilyType, S>(
	config: RuntimeOptionsType<F>,
	loader: LoaderType<S>,
): RuntimeType<F, S> {
	const table = families[config.family] as Record<string, AlgorithmType>;
	let engine: Engine | undefined;
	let loading: Promise<void> | undefined;
	let failure: unknown;

	const ready = (source?: S): Promise<void> => {
		if (config.mode === 'native' || config.mode === 'portable') return Promise.resolve();
		if (source !== undefined) {
			return loader.load(source).then((loaded) => {
				engine = loaded;
				failure = undefined;
			});
		}
		loading ??= (async () => {
			try {
				const { packed, raw } = config;
				if (packed === undefined && raw === undefined) {
					throw new TypeError(`Pass the compiled ${config.family} module to ready().`);
				}
				if (packed !== undefined && !loader.unpack) throw new TypeError('This entry point cannot unpack modules.');
				engine = await loader.load(
					packed === undefined
						? typeof raw === 'function' ? raw() : raw!
						: await loader.unpack!(typeof packed === 'function' ? await packed() : packed),
				);
			} catch (error) {
				// A Content Security Policy without 'wasm-unsafe-eval', or a host without WebAssembly. Recorded
				// once so later calls move straight to the fallbacks instead of retrying a refused compile.
				failure = error;
				loading = undefined;
				throw error;
			}
		})();
		return loading;
	};

	const algorithm = (name: string): AlgorithmType => {
		const found = table[name];
		if (!found) throw new TypeError(`Unknown ${config.family} algorithm: ${name}.`);
		return found;
	};

	const native = (name: string, key: Uint8Array | undefined, length: number) => {
		const fallback = config.fallbacks?.[name as NameType<F>];
		if (fallback?.host) return key ? undefined : fallback.host();
		if (!fallback?.native) return undefined;
		const { crypto, hashes } = nodeCrypto();
		if (!crypto || !hashes.has(fallback.native)) return undefined;
		if (key) return fallback.hmac ? crypto.createHmac(fallback.native, key) : undefined;
		return crypto.createHash(fallback.native, fallback.xof ? { outputLength: length } : undefined);
	};

	const pick = (name: string, length: number | undefined, options: HashOptionsType) => {
		const spec = algorithm(name);
		// Every backend copies the key before it returns (into the module window, or into the host or Noble state),
		// so a view is enough; a copy here cost about 800 ns per call in Deno (see `_wasm/slab.ts`).
		const key = options.key === undefined ? undefined : view(options.key);
		const size = options.length ?? spec.size;
		// Id 0 marks an algorithm that no module implements (KMAC); only a fallback can run it.
		const module = spec.id === 0 ? undefined : engine;
		const fallback = config.fallbacks?.[name as NameType<F>];
		switch (config.mode) {
			case 'wasm':
				if (module) return { kind: 'wasm' as const, spec, key, size };
				throw new NotReadyError(`Call and await ready() before hashing with ${name}.`);
			case 'native': {
				const host = native(name, key, size);
				if (host) return { kind: 'native' as const, host };
				throw new UnsupportedError(`This host has no native ${name} for these options.`);
			}
			case 'portable': {
				const portable = fallback?.portable?.(key, size);
				if (portable) return { kind: 'portable' as const, portable };
				throw new UnsupportedError(`No pure JavaScript ${name} for these options.`);
			}
		}
		if (!engine && !loading && failure === undefined) ready().catch(() => {});
		const from = accelerated.get(name);
		const prefer = from !== undefined && (length === undefined || length >= from);
		const host = prefer || !module ? native(name, key, size) : undefined;
		if (host) return { kind: 'native' as const, host };
		if (module) return { kind: 'wasm' as const, spec, key, size };
		const portable = fallback?.portable?.(key, size);
		if (portable) return { kind: 'portable' as const, portable };
		if (failure !== undefined) {
			throw new UnsupportedError(`${name} needs WebAssembly, which this host refused: ${String(failure)}`);
		}
		throw new NotReadyError(`${name} has no fallback here; await ready() before hashing synchronously.`);
	};

	return {
		ready,
		hash(name, input, options = {}) {
			const bytes = view(input);
			const choice = pick(name, bytes.length, options);
			switch (choice.kind) {
				case 'native':
					return output(choice.host.update(bytes).digest());
				case 'portable':
					return choice.portable.update(bytes).digest();
				case 'wasm':
					return checked(engine!.hash(choice.spec, bytes, wasmOptions(choice)));
			}
		},
		create(name, options = {}) {
			const choice = pick(name, undefined, options);
			switch (choice.kind) {
				case 'native':
					return wrap(nodeState(choice.host));
				case 'portable':
					return wrap(choice.portable);
				case 'wasm':
					return wrap(wasmState(engine!.create(choice.spec, wasmOptions(choice))));
			}
		},
		backend(name, length, options = {}) {
			try {
				return pick(name, length, options).kind;
			} catch {
				return 'none';
			}
		},
	};
}

function wasmOptions(choice: { spec: AlgorithmType; key: Uint8Array | undefined; size: number }) {
	return { ...(choice.key ? { key: choice.key } : {}), ...(choice.spec.xof ? { length: choice.size } : {}) };
}

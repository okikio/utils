/**
 * Turn any form of a family module into an {@link Engine}.
 *
 * A caller may already hold the module in one of several forms: the exports object of a WASM ESM import
 * (`import * as m from './sha2.wasm'`), a `WebAssembly.Module` from a source phase import
 * (`import source m from './sha2.wasm'`), an `Instance`, a `Response`, raw bytes or a URL. Only a URL
 * causes a fetch or a file read. Packed text is decoded from Base64 and decompressed.
 *
 * @module
 */
import { Engine, type ExportsType } from './engine.ts';

/** Every form that {@link load} accepts. */
export type SourceType =
	| ExportsType
	| WebAssembly.Module
	| WebAssembly.Instance
	| Response
	| PromiseLike<Response>
	| ArrayBuffer
	| ArrayBufferView
	| URL;

const names = ['memory', 'window', 'init', 'update', 'finish', 'read', 'fork', 'dispose', 'oneshot'] as const;

function exportsOf(value: unknown): ExportsType {
	const record = value as Record<string, unknown>;
	for (const name of names) {
		const item = record[name];
		if (name === 'memory' ? !(item instanceof WebAssembly.Memory) : typeof item !== 'function') {
			throw new TypeError(`not a hash family module: missing export ${name}`);
		}
	}
	return value as ExportsType;
}

async function instance(module: WebAssembly.Module): Promise<ExportsType> {
	return exportsOf((await WebAssembly.instantiate(module, {})).exports);
}

/** Read a `file:` URL without `fetch`, which Node.js does not support for files. */
async function file(url: URL): Promise<Uint8Array<ArrayBuffer>> {
	const fs = (globalThis as { process?: { getBuiltinModule?(id: string): unknown } }).process?.getBuiltinModule?.(
		'node:fs/promises',
	) as { readFile(path: URL): Promise<Uint8Array<ArrayBuffer>> } | undefined;
	if (fs) return await fs.readFile(url);
	const response = await fetch(url);
	return new Uint8Array(await response.arrayBuffer());
}

async function stream(response: Response): Promise<ExportsType> {
	if (!response.ok) throw new TypeError(`could not load hash module: HTTP ${response.status}`);
	// Streaming compile needs the application/wasm type; other responses compile from their bytes.
	if (response.headers.get('content-type')?.startsWith('application/wasm')) {
		return exportsOf((await WebAssembly.instantiateStreaming(response, {})).instance.exports);
	}
	return await instance(await WebAssembly.compile(await response.arrayBuffer()));
}

/** Instantiate `source` and wrap it. Exports objects and instances are used as they are. */
export async function load(source: SourceType): Promise<Engine> {
	if (source instanceof WebAssembly.Instance) return new Engine(exportsOf(source.exports));
	if (source instanceof WebAssembly.Module) return new Engine(await instance(source));
	if (source instanceof URL) {
		return new Engine(
			source.protocol === 'file:'
				? await instance(await WebAssembly.compile(await file(source)))
				: await stream(await fetch(source)),
		);
	}
	if (source instanceof ArrayBuffer || ArrayBuffer.isView(source)) {
		const bytes = source instanceof ArrayBuffer
			? new Uint8Array(source)
			: new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
		return new Engine(await instance(await WebAssembly.compile(bytes.slice())));
	}
	if (typeof Response !== 'undefined' && source instanceof Response) return new Engine(await stream(source));
	if (typeof (source as PromiseLike<Response>).then === 'function') {
		return await load(await (source as PromiseLike<Response>));
	}
	return new Engine(exportsOf(source));
}

/** Decode packed text: Base64 of deflate-raw compressed WASM bytes. */
export async function unpack(text: string): Promise<Uint8Array<ArrayBuffer>> {
	const from = (Uint8Array as { fromBase64?(text: string): Uint8Array<ArrayBuffer> }).fromBase64;
	let packed: Uint8Array<ArrayBuffer>;
	if (from) packed = from(text);
	else {
		const binary = atob(text);
		packed = new Uint8Array(binary.length);
		for (let index = 0; index < binary.length; index++) packed[index] = binary.charCodeAt(index);
	}
	const body = new Blob([packed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
	return new Uint8Array(await new Response(body).arrayBuffer());
}

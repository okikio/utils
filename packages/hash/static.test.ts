import { describe, it } from 'node:test';
import { readFile } from 'node:fs/promises';
import { expect } from '@std/expect';
import * as blake from './_entry/static/blake.ts';
import * as checksum from './_entry/static/checksum.ts';
import * as contest from './_entry/static/contest.ts';
import * as fast from './_entry/static/fast.ts';
import * as fsb from './_entry/static/fsb.ts';
import * as legacy from './_entry/static/legacy.ts';
import * as mac from './_entry/static/mac.ts';
import * as national from './_entry/static/national.ts';
import * as sha2 from './_entry/static/sha2.ts';
import * as sha3 from './_entry/static/sha3.ts';
import * as packedBlake from './_entry/packed/blake.ts';
import * as packedChecksum from './_entry/packed/checksum.ts';
import * as packedContest from './_entry/packed/contest.ts';
import * as packedFast from './_entry/packed/fast.ts';
import * as packedFsb from './_entry/packed/fsb.ts';
import * as packedLegacy from './_entry/packed/legacy.ts';
import * as packedMac from './_entry/packed/mac.ts';
import * as packedNational from './_entry/packed/national.ts';
import * as packedSha2 from './_entry/packed/sha2.ts';
import * as packedSha3 from './_entry/packed/sha3.ts';
import { NotReadyError } from './_runtime.ts';

const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
const data = Uint8Array.from({ length: 3000 }, (_, index) => (index * 31 + 7) & 0xff);
const key = data.subarray(0, 16);

/** What a bundler's `.wasm` import gives: a compiled module, made here from the shipped file. */
async function compiled(name: string): Promise<WebAssembly.Module> {
	const bytes = await readFile(new URL(`./_wasm/raw/${name}.wasm`, import.meta.url));
	return await WebAssembly.compile(new Uint8Array(bytes));
}

interface EntryType {
	ready(source?: never): Promise<void>;
	hash(name: string, input: Uint8Array, options?: { key?: Uint8Array; length?: number }): Uint8Array;
}

const cases: [string, EntryType, EntryType, string, { key?: Uint8Array; length?: number }?][] = [
	['sha2', sha2 as never, packedSha2 as never, 'sha512-256'],
	['sha3', sha3 as never, packedSha3 as never, 'shake256', { length: 77 }],
	['blake', blake as never, packedBlake as never, 'blake3', { key: data.subarray(0, 32) }],
	['legacy', legacy as never, packedLegacy as never, 'ripemd160'],
	['national', national as never, packedNational as never, 'streebog512'],
	['contest', contest as never, packedContest as never, 'whirlpool'],
	['fsb', fsb as never, packedFsb as never, 'fsb256'],
	['mac', mac as never, packedMac as never, 'siphash-2-4', { key }],
	['fast', fast as never, packedFast as never, 'xxh3-64'],
	['checksum', checksum as never, packedChecksum as never, 'CRC-32/ISO-HDLC'],
];

describe('static entry points', () => {
	it('throw NotReadyError until a compiled module is attached', () => {
		expect(() => sha2.hash('sha256', 'abc')).toThrow(NotReadyError);
		expect(() => mac.create('siphash-2-4', { key })).toThrow(NotReadyError);
	});

	it('refuse bytes and URLs, which would need a runtime compile', async () => {
		const bytes = await readFile(new URL('./_wasm/raw/sha2.wasm', import.meta.url));
		await expect(sha2.ready(new Uint8Array(bytes) as never)).rejects.toThrow(TypeError);
		await expect(sha2.ready(new URL('./_wasm/raw/sha2.wasm', import.meta.url) as never)).rejects.toThrow(TypeError);
		await expect((sha2.ready as (source?: unknown) => Promise<void>)()).rejects.toThrow(TypeError);
	});

	for (const [family, entry, packed, name, options] of cases) {
		it(`${family}: gives the packed entry's digests from a compiled module`, async () => {
			await entry.ready(await compiled(family) as never);
			await packed.ready();
			expect(hex(entry.hash(name, data, options))).toBe(hex(packed.hash(name, data, options)));
		});
	}

	it('take an Instance, and a namespace whose default is the module', async () => {
		const module = await compiled('legacy');
		await legacy.ready(await WebAssembly.instantiate(module, {}));
		expect(hex(legacy.hash('md5', 'abc'))).toBe('900150983cd24fb0d6963f7d28e17f72');
		await legacy.ready({ default: module });
		expect(hex(legacy.create('md5').update(new TextEncoder().encode('abc')).digest())).toBe(
			'900150983cd24fb0d6963f7d28e17f72',
		);
	});

	it('fast: take either build and give the same digest', async () => {
		await fast.ready(await compiled('fast'));
		const base = hex(fast.hash('xxh3-128', data));
		let wide: WebAssembly.Module | undefined;
		try {
			wide = await compiled('fast-wide');
		} catch {
			// This host lacks the wide-arithmetic proposal; the baseline build already ran.
		}
		if (wide) {
			await fast.ready(wide);
			expect(hex(fast.hash('xxh3-128', data))).toBe(base);
		}
	});
});

describe('static import graph', () => {
	// What a static entry may not do: each of these resolves, fetches or compiles at runtime.
	const forbidden = [/\bimport\s*\(/, /import\.meta/, /\bfetch\s*\(/, /WebAssembly\.(compile|instantiateStreaming)\b/];

	async function graph(start: URL, seen = new Map<string, string>()): Promise<Map<string, string>> {
		if (seen.has(start.href)) return seen;
		const text = await readFile(start, 'utf8');
		seen.set(start.href, text);
		// Type-only imports are erased; only value imports and re-exports reach the bundle.
		for (const match of text.matchAll(/^(?:import|export)\s+(?!type\b)[^;]*?from\s+'(\.[^']+)'/gms)) {
			await graph(new URL(match[1]!, start), seen);
		}
		return seen;
	}

	for (const [family] of cases) {
		it(`${family}: reaches no loader, embedded module or runtime lookup`, async () => {
			const files = await graph(new URL(`./_entry/static/${family}.ts`, import.meta.url));
			for (const [href, text] of files) {
				expect(href).not.toMatch(/_wasm\/(load|packed\/)|_family\.ts|_native\.ts/);
				const code = text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
				for (const pattern of forbidden) expect({ href, found: pattern.test(code) }).toEqual({ href, found: false });
			}
		});
	}
});

describe('every entry point', () => {
	// Cloudflare Workers bundles have no usable `import.meta.url` base, so a module-scope
	// `new URL(path, import.meta.url)` throws at import and stops the Worker from starting.
	it('builds file URLs only when ready() needs them', async () => {
		const { readdir } = await import('node:fs/promises');
		const root = new URL('./', import.meta.url);
		const files = [
			...(await readdir(root)).filter((name) => /^[a-z0-9]+\.ts$/.test(name)).map((name) => new URL(name, root)),
			...(await readdir(new URL('./_entry/', root), { recursive: true }))
				.filter((name) => name.endsWith('.ts'))
				.map((name) => new URL(`./_entry/${name}`, root)),
		];
		for (const file of files) {
			const code = (await readFile(file, 'utf8')).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
			const eager = /^(?:export\s+)?(?:const|let|var)\b[^\n]*import\.meta|^\t\w+:\s*new URL\([^)]*import\.meta/m;
			expect({ file: file.pathname, eager: eager.test(code) }).toEqual({ file: file.pathname, eager: false });
		}
	});
});

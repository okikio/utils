/**
 * Build, pack and check the WebAssembly modules of `@okikio/hash`.
 *
 * The Rust workspace in `packages/hash/wasm/` is the source. This program writes two derived forms of
 * each family and a manifest that ties them to the source:
 *
 * ```text
 *   packages/hash/wasm/<family>/src   ──cargo──►  .tmp/cargo/hash/…/hash_<family>.wasm
 *                                     ──binaryen──► packages/hash/_wasm/raw/<family>.wasm    (the /wasm entry)
 *                                     ──deflate + Base64──► packages/hash/_wasm/packed/<family>.ts (the default)
 *   packages/hash/_wasm/manifest.json  ← source digest, byte digests, sizes, tool versions
 * ```
 *
 * Modes:
 *
 * - `--write` builds and replaces the derived files. It needs `cargo` (rustup reads `rust-toolchain.toml`).
 * - `--check` (default) needs no Rust. It fails when the Rust source changed after the last `--write`, or
 *   when a derived file does not match the manifest. CI runs this on every change.
 * - `--verify` builds into `.tmp/` and fails when the result differs from the committed files. CI runs this
 *   only when the Rust source changed, because it needs the Rust toolchain.
 * - `--vectors` copies a sample of each crate's published known-answer tests into
 *   `packages/hash/fixtures/vectors.json`, so the package tests compare WASM output with the upstream
 *   vectors without reading Cargo's download directory.
 *
 * @module
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { deflateRawSync, inflateRawSync } from 'node:zlib';

const root = fileURLToPath(new URL('../../', import.meta.url));
const source = join(root, 'packages/hash/wasm');
const raw = join(root, 'packages/hash/_wasm/raw');
const packed = join(root, 'packages/hash/_wasm/packed');
const target = join(root, '.tmp/cargo/hash/wasm32-unknown-unknown/release');

/**
 * Build settings per family, from the measurements in docs/hash/04-measurements.md.
 *
 * - `optimize`/`shrink` are Binaryen levels. Every family runs at the same speed at `-O3` and `-Oz`.
 *   Shrinking saves under 0.2% for SHA-2, its hottest path, so it keeps `-O3`; SHA-3 and BLAKE shrink.
 * - `rustflags` are added to `.cargo/config.toml` for that family only. Keccak 0.2 keeps its 24 rounds in
 *   a loop on stable Rust; a higher unroll threshold lets LLVM unroll it, which halves SHA-3 time in WASM.
 * - `crate` builds another family's crate with different flags: `fast-wide` is the `fast` crate with the
 *   wide-arithmetic feature, which gives rapidhash and XXH3 a 64×64→128-bit multiply. `wide` adds the
 *   matching Binaryen feature.
 */
const families = {
	sha2: { optimize: 3, shrink: 0, rustflags: [] },
	sha3: { optimize: 2, shrink: 2, rustflags: ['-C', 'llvm-args=-unroll-threshold=2000'] },
	blake: { optimize: 2, shrink: 2, rustflags: [] },
	legacy: { optimize: 2, shrink: 2, rustflags: [] },
	national: { optimize: 2, shrink: 2, rustflags: [] },
	contest: { optimize: 2, shrink: 2, rustflags: [] },
	fsb: { optimize: 2, shrink: 2, rustflags: [] },
	mac: { optimize: 3, shrink: 0, rustflags: [] },
	fast: { optimize: 3, shrink: 0, rustflags: [] },
	'fast-wide': {
		crate: 'fast',
		wide: true,
		optimize: 3,
		shrink: 0,
		rustflags: ['-C', 'target-feature=+wide-arithmetic'],
	},
	checksum: { optimize: 2, shrink: 2, rustflags: [] },
} as const;

/** The settings of one module, with the optional fields that only some entries set. */
interface SettingsType {
	readonly crate?: string;
	readonly wide?: boolean;
	readonly optimize: number;
	readonly shrink: number;
	readonly rustflags: readonly string[];
}

type FamilyType = keyof typeof families;

interface EntryType {
	readonly sha256: string;
	readonly bytes: number;
	readonly packed: number;
}

interface ManifestType {
	readonly source: string;
	readonly rust: string;
	readonly binaryen: string;
	readonly families: Record<FamilyType, EntryType>;
}

const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

/** Digest of every authored file that affects the modules, in a stable order. */
function digestSource(): string {
	const files: string[] = [];
	const visit = (directory: string) => {
		for (const name of readdirSync(directory).sort()) {
			const path = join(directory, name);
			if (name === 'target') continue;
			if (statSync(path).isDirectory()) visit(path);
			else files.push(path);
		}
	};
	visit(source);
	const hash = createHash('sha256');
	for (const path of files) {
		hash.update(relative(source, path).replaceAll('\\', '/')).update('\0').update(readFileSync(path)).update('\0');
	}
	return hash.digest('hex');
}

function run(command: string, args: string[]): string {
	const result = spawnSync(command, args, { cwd: source, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
	if (result.error) throw new Error(`${command} could not start: ${result.error.message}`);
	if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${result.status}`);
	return result.stdout.trim();
}

/** CRCs that get a 256-entry lookup table; the rest compute bit by bit to keep the module small. */
const tabled = new Set([
	'CRC_8_SMBUS',
	'CRC_16_ARC',
	'CRC_16_IBM_SDLC',
	'CRC_16_KERMIT',
	'CRC_16_MODBUS',
	'CRC_16_XMODEM',
	'CRC_32_BZIP2',
	'CRC_32_CKSUM',
	'CRC_32_ISCSI',
	'CRC_32_MPEG_2',
	'CRC_64_ECMA_182',
	'CRC_64_NVME',
	'CRC_64_XZ',
]);

/**
 * Generate the CRC catalogue from the `crc-catalog` crate: Rust match arms for the checksum module and
 * the matching TypeScript registry. Ids follow the catalogue's order. CRC-32/ISO-HDLC (the zlib,
 * PNG and Ethernet CRC) uses `crc32fast` instead of the generic code.
 */
function catalog(): void {
	const metadata = JSON.parse(run('cargo', ['metadata', '--format-version', '1', '--locked'])) as {
		packages: { name: string; manifest_path: string }[];
	};
	const crate = metadata.packages.find((entry) => entry.name === 'crc-catalog');
	if (!crate) throw new Error('crc-catalog is not in the workspace');
	const text = readFileSync(join(crate.manifest_path, '../src/algorithm.rs'), 'utf8');
	const pattern =
		/pub const (CRC_\d+_[A-Z0-9_]+): Algorithm<u(\d+)> = Algorithm \{\s*width: (\d+),[^}]*?check: (0x[0-9a-f]+),/gu;
	const entries = [...text.matchAll(pattern)].map((match, index) => ({
		id: index + 1,
		constant: match[1]!,
		kind: `u${match[2]!}`,
		width: Number(match[3]),
		check: BigInt(match[4]!),
		name: match[1]!.replace(/^CRC_(\d+)_/u, 'CRC-$1/').replaceAll('_', '-'),
	}));
	if (entries.length < 100) throw new Error(`expected the full CRC catalogue, found ${entries.length} entries`);
	const variant = (entry: (typeof entries)[number]) =>
		`${entry.kind.toUpperCase()}${tabled.has(entry.constant) ? 'T' : 'N'}`;
	const arms = entries.map((entry) =>
		entry.constant === 'CRC_32_ISO_HDLC'
			? `\t\t${entry.id} => State::Fast(crc32fast::Hasher::new()),`
			: `\t\t${entry.id} => State::${variant(entry)}(${entry.constant}_${
				tabled.has(entry.constant) ? 'T' : 'N'
			}.digest(), ${Math.ceil(entry.width / 8)}),`
	);
	const statics = entries.filter((entry) => entry.constant !== 'CRC_32_ISO_HDLC').map((entry) => {
		const table = tabled.has(entry.constant) ? 'Table<1>' : 'NoTable';
		const suffix = tabled.has(entry.constant) ? 'T' : 'N';
		return `static ${entry.constant}_${suffix}: Crc<${entry.kind}, ${table}> = Crc::<${entry.kind}, ${table}>::new(&crc::${entry.constant});`;
	});
	const rust = [
		'// Generated by `mise run build -- --target wasm --write` from the crc-catalog crate. Do not edit.',
		'//! The CRC catalogue: one `Crc` per RevEng entry and the match from algorithm id to state.',
		'',
		'use crate::State;',
		'use crc::{Crc, NoTable, Table};',
		'',
		...statics,
		'',
		'/// The state for CRC id `id`, or `None` for an id outside the catalogue.',
		'#[allow(clippy::too_many_lines)]',
		'pub fn start(id: u32) -> Option<State> {',
		'\tSome(match id {',
		...arms,
		'\t\t_ => return None,',
		'\t})',
		'}',
		'',
	].join('\n');
	writeFileSync(join(source, 'checksum/src/catalog.rs'), rust);
	run('rustfmt', ['--edition', '2024', 'checksum/src/catalog.rs']);
	const ts = [
		'// Generated by `mise run build -- --target wasm --write` from the crc-catalog crate. Do not edit.',
		'/**',
		' * Every CRC in the RevEng catalogue, by its catalogue name, with its id in the checksum module.',
		' *',
		' * `check` is the CRC of the ASCII bytes `123456789`, as the catalogue publishes it.',
		' *',
		' * @module',
		' */',
		'',
		'/** One catalogue entry. */',
		'export interface CrcType {',
		'\treadonly id: number;',
		'\treadonly width: number;',
		'\treadonly check: bigint;',
		'}',
		'',
		'/** A catalogue name. */',
		'export type CrcNameType =',
		...entries.map((entry, index) => `\t| '${entry.name}'${index === entries.length - 1 ? ';' : ''}`),
		'',
		'/** The catalogue. */',
		'export const crcs: Readonly<Record<CrcNameType, CrcType>> = {',
		...entries.map((entry) =>
			`\t'${entry.name}': { id: ${entry.id}, width: ${entry.width}, check: 0x${entry.check.toString(16)}n },`
		),
		'};',
		'',
	].join('\n');
	writeFileSync(join(root, 'packages/hash/_wasm/crc.ts'), ts);
	console.log(`generated ${entries.length} CRC catalogue entries`);
}

/** Compile the workspace and optimize each family. */
async function build(): Promise<{ modules: Record<FamilyType, Uint8Array>; rust: string; binaryen: string }> {
	catalog();
	// Panic locations name crate files. Remapping keeps machine paths out of the modules, so a build on
	// another machine produces the same bytes. Cargo joins this array with the one in .cargo/config.toml.
	const home = process.env.CARGO_HOME ?? join(homedir(), '.cargo');
	const remap = [`--remap-path-prefix=${join(home, 'registry/src')}=/crates`, `--remap-path-prefix=${root}=/utils/`];
	const { default: binaryen } = await import('binaryen');
	const f = binaryen.Features;
	const features = f.MutableGlobals | f.NontrappingFPToInt | f.SIMD128 | f.BulkMemory | f.BulkMemoryOpt | f.SignExt |
		f.ReferenceTypes | f.Multivalue | f.CallIndirectOverlong;
	const modules = {} as Record<FamilyType, Uint8Array>;
	// A variant shares its crate's output file, so each module is optimized before the next build.
	for (const [family, settings] of Object.entries(families) as [FamilyType, SettingsType][]) {
		const crate = settings.crate ?? family;
		const flags = JSON.stringify([...remap, ...settings.rustflags]);
		run('cargo', [
			'build',
			'--release',
			'--locked',
			'-p',
			`hash-${crate}`,
			'--config',
			`target.wasm32-unknown-unknown.rustflags=${flags}`,
		]);
		const module = binaryen.readBinary(readFileSync(join(target, `hash_${crate}.wasm`)));
		try {
			// The features rustc enables for wasm32 by default plus `.cargo/config.toml`. Binaryen tracks
			// LLVM's bulk-memory as two flags, so both are set.
			module.setFeatures(settings.wide ? features | f.WideArithmetic : features);
			binaryen.setOptimizeLevel(settings.optimize);
			binaryen.setShrinkLevel(settings.shrink);
			binaryen.setDebugInfo(false);
			module.optimize();
			module.runPasses(['strip-debug', 'strip-producers', 'strip-target-features']);
			if (!module.validate()) throw new Error(`binaryen produced an invalid ${family} module`);
			modules[family] = module.emitBinary();
		} finally {
			module.dispose();
		}
	}
	const pkg = JSON.parse(readFileSync(new URL('../node_modules/binaryen/package.json', import.meta.url), 'utf8')) as {
		version: string;
	};
	return { modules, rust: run('rustc', ['--version']), binaryen: pkg.version };
}

/** The generated module that carries one packed family. */
function packedModule(family: FamilyType, wasm: Uint8Array): { text: string; size: number } {
	const text = Buffer.from(deflateRawSync(wasm, { level: 9 })).toString('base64');
	const body = [
		`// Generated by \`mise run build -- --target wasm --write\` from packages/hash/wasm/${
			(families[family] as SettingsType).crate ?? family
		}. Do not edit.`,
		`/** The ${family} hash module: Base64 of deflate-raw compressed WebAssembly (${wasm.length} bytes). */`,
		'export const text =',
		`\t'${text}';`,
		'',
	].join('\n');
	return { text: body, size: text.length };
}

function write(): Promise<void> {
	return build().then(({ modules, rust, binaryen }) => {
		mkdirSync(raw, { recursive: true });
		mkdirSync(packed, { recursive: true });
		const entries = {} as Record<FamilyType, EntryType>;
		for (const family of Object.keys(families) as FamilyType[]) {
			const wasm = modules[family];
			const { text, size } = packedModule(family, wasm);
			writeFileSync(join(raw, `${family}.wasm`), wasm);
			writeFileSync(join(packed, `${family}.ts`), text);
			entries[family] = { sha256: sha256(wasm), bytes: wasm.length, packed: size };
			console.log(`${family}: ${wasm.length} bytes, packed ${size} characters`);
		}
		const manifest: ManifestType = { source: digestSource(), rust, binaryen, families: entries };
		writeFileSync(join(raw, '../manifest.json'), `${JSON.stringify(manifest, null, '\t')}\n`);
	});
}

/** Compare committed files with the manifest and the current source. Needs no Rust. */
function check(): void {
	const path = join(raw, '../manifest.json');
	if (!existsSync(path)) throw new Error('packages/hash/_wasm/manifest.json is missing; run the wasm build');
	const manifest = JSON.parse(readFileSync(path, 'utf8')) as ManifestType;
	const problems: string[] = [];
	if (manifest.source !== digestSource()) {
		problems.push('the Rust source changed after the last build; run `mise run build -- --target wasm --write`');
	}
	for (const family of Object.keys(families) as FamilyType[]) {
		const entry = manifest.families[family];
		const wasm = readFileSync(join(raw, `${family}.wasm`));
		if (!entry || sha256(wasm) !== entry.sha256) problems.push(`_wasm/raw/${family}.wasm does not match the manifest`);
		const text = /export const text =\s*'([^']*)';/u.exec(readFileSync(join(packed, `${family}.ts`), 'utf8'))?.[1];
		if (!text || !inflateRawSync(Buffer.from(text, 'base64')).equals(wasm)) {
			problems.push(`_wasm/packed/${family}.ts does not unpack to _wasm/raw/${family}.wasm`);
		}
	}
	if (problems.length) throw new Error(problems.join('\n'));
	console.log('hash WebAssembly modules match their source');
}

/** Rebuild and compare with the committed modules. Needs Rust and binaryen. */
async function verify(): Promise<void> {
	check();
	const { modules } = await build();
	const changed = (Object.keys(families) as FamilyType[]).filter((family) =>
		sha256(modules[family]) !== sha256(readFileSync(join(raw, `${family}.wasm`)))
	);
	if (changed.length) throw new Error(`a fresh build differs for: ${changed.join(', ')}`);
	console.log('a fresh build reproduces every committed module');
}

/**
 * Known-answer test files shipped inside each crate, by crate name: file stem to `family/algorithm`.
 * Files are RustCrypto `blobby` pairs of input and digest, or NIST-style `Msg =` / `MD =` text.
 */
const kats: Record<string, Record<string, string>> = {
	md2: { md2_kat: 'legacy/md2' },
	md4: { md4_kat: 'legacy/md4' },
	'md-5': { md5_kat: 'legacy/md5' },
	sha1: { sha1_kat: 'legacy/sha1' },
	'sha1-checked': { sha1_checked_kat: 'legacy/sha1-checked' },
	ripemd: {
		ripemd128_kat: 'legacy/ripemd128',
		ripemd160_kat: 'legacy/ripemd160',
		ripemd256_kat: 'legacy/ripemd256',
		ripemd320_kat: 'legacy/ripemd320',
	},
	tiger: { tiger_kat: 'legacy/tiger', tiger2_kat: 'legacy/tiger2' },
	streebog: { streebog256_kat: 'national/streebog256', streebog512_kat: 'national/streebog512' },
	gost94: { gost94_cryptopro_kat: 'national/gost94-cryptopro', gost94_test_kat: 'national/gost94-test' },
	sm3: { sm3_kat: 'national/sm3' },
	kupyna: {
		kupyna256_kat: 'national/kupyna256',
		kupyna384_kat: 'national/kupyna384',
		kupyna512_kat: 'national/kupyna512',
	},
	'belt-hash': { belt_hash_kat: 'national/belt' },
	'bash-hash': { bash256: 'national/bash256', bash384: 'national/bash384', bash512: 'national/bash512' },
	'ascon-hash': { asconhash: 'national/ascon-hash256', asconxof: 'national/ascon-xof128' },
	groestl: {
		groestl224_kat: 'contest/groestl224',
		groestl256_kat: 'contest/groestl256',
		groestl384_kat: 'contest/groestl384',
		groestl512_kat: 'contest/groestl512',
	},
	jh: {
		jh224_short_kat: 'contest/jh224',
		jh256_short_kat: 'contest/jh256',
		jh384_short_kat: 'contest/jh384',
		jh512_short_kat: 'contest/jh512',
	},
	skein: {
		skein256_256_kat: 'contest/skein256-256',
		skein256_512_kat: 'contest/skein256-512',
		skein512_256_kat: 'contest/skein512-256',
		skein512_512_kat: 'contest/skein512-512',
		skein1024_256_kat: 'contest/skein1024-256',
		skein1024_512_kat: 'contest/skein1024-512',
		skein1024_1024_kat: 'contest/skein1024-1024',
	},
	shabal: {
		shabal192_kat: 'contest/shabal192',
		shabal224_kat: 'contest/shabal224',
		shabal256_kat: 'contest/shabal256',
		shabal384_kat: 'contest/shabal384',
		shabal512_kat: 'contest/shabal512',
	},
	whirlpool: { whirlpool_kat: 'contest/whirlpool' },
	fsb: {
		fsb160_kat: 'fsb/fsb160',
		fsb224_kat: 'fsb/fsb224',
		fsb256_kat: 'fsb/fsb256',
		fsb384_kat: 'fsb/fsb384',
		fsb512_kat: 'fsb/fsb512',
	},
};

/** Decode a RustCrypto `blobby` file into its blobs. */
function blobby(data: Uint8Array): Uint8Array[] {
	let offset = 0;
	const vlq = () => {
		let byte = data[offset++]!;
		let value = byte & 0x7f;
		while (byte & 0x80) {
			byte = data[offset++]!;
			value = ((value + 1) << 7) + (byte & 0x7f);
		}
		return value;
	};
	const items = vlq();
	const dedup = Array.from({ length: vlq() }, () => {
		const length = vlq();
		return data.subarray(offset, offset += length);
	});
	return Array.from({ length: items }, () => {
		const value = vlq();
		return value & 1 ? dedup[value >> 1]! : data.subarray(offset, offset += value >> 1);
	});
}

/** Pairs of input and expected output from one known-answer file. */
function pairs(path: string): [Uint8Array, Uint8Array][] {
	if (path.endsWith('.txt')) {
		const text = readFileSync(path, 'utf8');
		return [...text.matchAll(/Msg = ([0-9A-Fa-f]*)\s+MD = ([0-9A-Fa-f]+)/gu)].map((match) => [
			Buffer.from(match[1]!, 'hex'),
			Buffer.from(match[2]!, 'hex'),
		]);
	}
	const blobs = blobby(readFileSync(path));
	return Array.from({ length: blobs.length / 2 }, (_, index) => [blobs[2 * index]!, blobs[2 * index + 1]!]);
}

/** Keep every vector up to 2 blocks of the widest state, at most 12 per algorithm, spread across the file. */
function sample(all: [Uint8Array, Uint8Array][]): [Uint8Array, Uint8Array][] {
	const small = all.filter(([input]) => input.length <= 256);
	const step = Math.max(1, Math.ceil(small.length / 12));
	return small.filter((_, index) => index % step === 0).slice(0, 12);
}

function vectors(): void {
	const metadata = JSON.parse(run('cargo', ['metadata', '--format-version', '1', '--locked'])) as {
		packages: { name: string; manifest_path: string }[];
	};
	const out: Record<string, string[][]> = {};
	for (const [crate, files] of Object.entries(kats)) {
		const pkg = metadata.packages.find((entry) => entry.name === crate);
		if (!pkg) throw new Error(`crate ${crate} is not in the workspace`);
		const data = join(pkg.manifest_path, '../tests/data');
		for (const [stem, name] of Object.entries(files)) {
			const file = readdirSync(data).find((entry) => entry === `${stem}.blb` || entry === `${stem}.txt`);
			if (!file) throw new Error(`${crate} has no tests/data/${stem}`);
			out[name] = sample(pairs(join(data, file))).map(([input, output]) => [
				Buffer.from(input).toString('hex'),
				Buffer.from(output).toString('hex'),
			]);
		}
	}
	// SipHash reference vectors from the paper, as siphasher's tests hold them: key 00..0f and
	// message 00..(n-1) for vector n. The third element of each case is the key.
	const sip = metadata.packages.find((entry) => entry.name === 'siphasher')!;
	const key = Buffer.from(Array.from({ length: 16 }, (_, index) => index)).toString('hex');
	const message = (length: number) => Buffer.from(Array.from({ length }, (_, index) => index)).toString('hex');
	for (
		const [file, test, name] of [
			['tests.rs', 'test_siphash_1_3', 'mac/siphash-1-3'],
			['tests.rs', 'test_siphash_2_4', 'mac/siphash-2-4'],
			['tests128.rs', 'test_siphash128_1_3', 'mac/siphash-1-3-128'],
			['tests128.rs', 'test_siphash128_2_4', 'mac/siphash-2-4-128'],
		] as const
	) {
		const after = readFileSync(join(sip.manifest_path, '../src', file), 'utf8').split(`fn ${test}()`)[1] ?? '';
		const body = /= \[\s*([\s\S]*?)\]\s*;/u.exec(after)?.[1];
		const rows = [...(body ?? '').matchAll(/\[([0-9a-fx,\s_]+)\]/gu)].map((row) =>
			Buffer.from(row[1]!.split(',').map((item) => item.trim()).filter(Boolean).map((item) => Number(item))).toString(
				'hex',
			)
		).filter((row) => row.length === 16 || row.length === 32);
		if (!rows.length) throw new Error(`siphasher ${file} has no vectors in ${test}`);
		out[name] = rows.map((digest, length) => [message(length), digest, key]);
	}

	// A published chosen-prefix SHA-1 collision (SHA-mbles); sha1-checked must refuse it.
	const checked = metadata.packages.find((entry) => entry.name === 'sha1-checked')!;
	const attack = readFileSync(join(checked.manifest_path, '../tests/data/sha-mbles-1.bin'));
	out['legacy/sha1-checked-collision'] = [[attack.toString('hex'), '']];
	const path = join(root, 'packages/hash/fixtures/vectors.json');
	writeFileSync(path, `${JSON.stringify(out, null, '\t')}\n`);
	console.log(`wrote ${Object.keys(out).length} algorithms to ${relative(root, path)}`);
}

const { values } = parseArgs({
	options: { write: { type: 'boolean' }, verify: { type: 'boolean' }, vectors: { type: 'boolean' } },
});
if (values.vectors) vectors();
else await (values.write ? write() : values.verify ? verify() : Promise.resolve(check()));

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
 */
const families = {
	sha2: { optimize: 3, shrink: 0, rustflags: [] },
	sha3: { optimize: 2, shrink: 2, rustflags: ['-C', 'llvm-args=-unroll-threshold=2000'] },
	blake: { optimize: 2, shrink: 2, rustflags: [] },
} as const;

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

/** Compile the workspace and optimize each family. */
async function build(): Promise<{ modules: Record<FamilyType, Uint8Array>; rust: string; binaryen: string }> {
	// Panic locations name crate files. Remapping keeps machine paths out of the modules, so a build on
	// another machine produces the same bytes. Cargo joins this array with the one in .cargo/config.toml.
	const home = process.env.CARGO_HOME ?? join(homedir(), '.cargo');
	const remap = [`--remap-path-prefix=${join(home, 'registry/src')}=/crates`, `--remap-path-prefix=${root}=/utils/`];
	for (const [family, settings] of Object.entries(families)) {
		const flags = JSON.stringify([...remap, ...settings.rustflags]);
		run('cargo', [
			'build',
			'--release',
			'--locked',
			'-p',
			`hash-${family}`,
			'--config',
			`target.wasm32-unknown-unknown.rustflags=${flags}`,
		]);
	}
	const { default: binaryen } = await import('binaryen');
	const f = binaryen.Features;
	const features = f.MutableGlobals | f.NontrappingFPToInt | f.SIMD128 | f.BulkMemory | f.BulkMemoryOpt | f.SignExt |
		f.ReferenceTypes | f.Multivalue | f.CallIndirectOverlong;
	const modules = {} as Record<FamilyType, Uint8Array>;
	for (const [family, settings] of Object.entries(families) as [FamilyType, (typeof families)[FamilyType]][]) {
		const module = binaryen.readBinary(readFileSync(join(target, `hash_${family}.wasm`)));
		try {
			// The features rustc enables for wasm32 by default plus `.cargo/config.toml`. Binaryen tracks
			// LLVM's bulk-memory as two flags, so both are set.
			module.setFeatures(features);
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
		`// Generated by \`mise run build -- --target wasm --write\` from packages/hash/wasm/${family}. Do not edit.`,
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

const { values } = parseArgs({ options: { write: { type: 'boolean' }, verify: { type: 'boolean' } } });
await (values.write ? write() : values.verify ? verify() : Promise.resolve(check()));

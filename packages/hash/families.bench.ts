/**
 * Compare the backends of every hash family at 64 bytes, 4 KiB and 1 MiB.
 *
 * Each trial calls one pinned entry point (`/packed` for WebAssembly, `/native`, `/portable`), so the numbers show
 * what each backend costs on this host, not which one the automatic entry picks. Modules load and every backend's
 * output is checked against the others before timing starts; `--check` runs only those checks.
 * @module
 */
import { deepStrictEqual } from 'node:assert';
import { bench, do_not_optimize, group } from 'mitata';
import { run } from './fixtures/bench.ts';
import * as sha2 from './_entry/packed/sha2.ts';
import * as sha2Native from './_entry/native/sha2.ts';
import * as sha2Portable from './_entry/portable/sha2.ts';
import * as sha3 from './_entry/packed/sha3.ts';
import * as sha3Native from './_entry/native/sha3.ts';
import * as sha3Portable from './_entry/portable/sha3.ts';
import * as blake from './_entry/packed/blake.ts';
import * as blakeNative from './_entry/native/blake.ts';
import * as blakePortable from './_entry/portable/blake.ts';
import * as legacy from './_entry/packed/legacy.ts';
import * as legacyNative from './_entry/native/legacy.ts';
import * as legacyPortable from './_entry/portable/legacy.ts';
import * as national from './_entry/packed/national.ts';
import * as contest from './_entry/packed/contest.ts';
import * as fsb from './_entry/packed/fsb.ts';
import * as mac from './_entry/packed/mac.ts';
import * as fast from './_entry/packed/fast.ts';
import * as checksum from './_entry/packed/checksum.ts';
import * as checksumPortable from './_entry/portable/checksum.ts';
import type { HashOptionsType } from './_family.ts';

const sizes = [64, 4096, 1 << 20];
const inputs = new Map(sizes.map((size) => [size, Uint8Array.from({ length: size }, (_, index) => index % 251)]));
const sipKey = { key: Uint8Array.from({ length: 16 }, (_, index) => index) };

/** One backend of one algorithm: a label and a synchronous hash call. */
type TrialType = readonly [label: string, run: (input: Uint8Array) => Uint8Array];

/** Algorithms to measure, with every backend that has them on this host. */
const cases: readonly { readonly name: string; readonly trials: readonly TrialType[] }[] = [];
const add = (name: string, ...trials: (TrialType | undefined)[]) =>
	(cases as { name: string; trials: TrialType[] }[]).push({
		name,
		trials: trials.filter((trial): trial is TrialType => trial !== undefined),
	});

/** A trial for a pinned entry point, or none when that backend refuses the algorithm on this host. */
function trial<N extends string>(
	label: string,
	entry: { hash(name: N, input: Uint8Array, options?: HashOptionsType): Uint8Array },
	name: N,
	options?: HashOptionsType,
): TrialType | undefined {
	try {
		entry.hash(name, new Uint8Array(1), options);
		return [label, (input) => entry.hash(name, input, options)];
	} catch {
		return undefined;
	}
}

await Promise.all(
	[sha2, sha3, blake, legacy, national, contest, fsb, mac, fast, checksum].map((entry) => entry.ready()),
);

add(
	'sha256',
	trial('wasm', sha2, 'sha256'),
	trial('native', sha2Native, 'sha256'),
	trial('portable', sha2Portable, 'sha256'),
);
add(
	'sha512',
	trial('wasm', sha2, 'sha512'),
	trial('native', sha2Native, 'sha512'),
	trial('portable', sha2Portable, 'sha512'),
);
add(
	'sha3-256',
	trial('wasm', sha3, 'sha3-256'),
	trial('native', sha3Native, 'sha3-256'),
	trial('portable', sha3Portable, 'sha3-256'),
);
add('kt128', trial('wasm', sha3, 'kt128'), trial('portable', sha3Portable, 'kt128'));
add('blake3', trial('wasm', blake, 'blake3'), trial('portable', blakePortable, 'blake3'));
add(
	'blake2b-512',
	trial('wasm', blake, 'blake2b-512'),
	trial('native', blakeNative, 'blake2b-512'),
	trial('portable', blakePortable, 'blake2b-512'),
);
add(
	'md5',
	trial('wasm', legacy, 'md5'),
	trial('native', legacyNative, 'md5'),
	trial('portable', legacyPortable, 'md5'),
);
add(
	'sha1',
	trial('wasm', legacy, 'sha1'),
	trial('native', legacyNative, 'sha1'),
	trial('portable', legacyPortable, 'sha1'),
);
add('sm3', trial('wasm', national, 'sm3'));
add('streebog256', trial('wasm', national, 'streebog256'));
add('skein512-512', trial('wasm', contest, 'skein512-512'));
add('whirlpool', trial('wasm', contest, 'whirlpool'));
add('fsb256', trial('wasm', fsb, 'fsb256'));
add('siphash-2-4', trial('wasm', mac, 'siphash-2-4', sipKey));
add('xxh3-64', trial('wasm', fast, 'xxh3-64'));
add('rapidhash', trial('wasm', fast, 'rapidhash'));
add(
	'CRC-32/ISO-HDLC',
	trial('wasm', checksum, 'CRC-32/ISO-HDLC'),
	trial('portable', checksumPortable, 'CRC-32/ISO-HDLC'),
);
add('CRC-64/NVME', trial('wasm', checksum, 'CRC-64/NVME'));

// Every backend of an algorithm must agree before any of them is timed.
for (const { name, trials } of cases) {
	for (const input of inputs.values()) {
		const [first, ...rest] = trials.map(([, call]) => Array.from(call(input)));
		for (const other of rest) deepStrictEqual(other, first, `${name} backends disagree at ${input.length} bytes`);
	}
}

for (const { name, trials } of cases) {
	group(name, () => {
		for (const [label, call] of trials) {
			bench(`${name} ${label}, $bytes bytes`, function* (state: { get(name: string): number }) {
				const input = inputs.get(state.get('bytes'))!;
				yield () => do_not_optimize(call(input));
			}).args('bytes', sizes);
		}
	});
}

await run();

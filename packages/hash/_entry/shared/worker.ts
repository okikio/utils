/**
 * The worker side of a hash pool. Each worker loads a family entry point the first time a batch asks for it, so
 * SHA-1 and SHA-2 still use `node:crypto` for large inputs where the host has it. It
 * then hashes every input of the batch synchronously. The digests go back end to end in one transferred buffer.
 *
 * @module
 */
import * as worker from '@okikio/worker/thread';
import { type BatchType, type DigestsType, protocol } from './protocol.ts';
import type { HashOptionsType } from '../../_family.ts';
import type { InputType } from '../../_bytes.ts';
import type { Engine } from '../../_wasm/engine.ts';
import { subtree } from './tree.ts';

/** What the worker needs from a packed entry point. */
interface FamilyModuleType {
	ready(): Promise<void>;
	hash(name: never, input: InputType, options?: HashOptionsType): Uint8Array;
}

const loaders: Readonly<Record<string, () => Promise<FamilyModuleType>>> = {
	sha2: () => import('../../sha2.ts'),
	sha3: () => import('../../sha3.ts'),
	blake: () => import('../../blake.ts'),
	legacy: () => import('../../legacy.ts'),
	national: () => import('../../national.ts'),
	contest: () => import('../../contest.ts'),
	fsb: () => import('../../fsb.ts'),
	mac: () => import('../../mac.ts'),
	fast: () => import('../../fast.ts'),
	checksum: () => import('../../checksum.ts'),
};

const loaded = new Map<string, Promise<FamilyModuleType>>();

function family(name: string): Promise<FamilyModuleType> {
	let value = loaded.get(name);
	if (!value) {
		const loader = loaders[name];
		if (!loader) throw new TypeError(`Unknown hash family: ${name}.`);
		value = loader().then(async (module) => {
			await module.ready();
			return module;
		});
		loaded.set(name, value);
	}
	return value;
}

let blake: Promise<Engine> | undefined;

/** The BLAKE module itself, for subtree operations that the family entry point does not expose. */
function engine(): Promise<Engine> {
	return blake ??= Promise.all([import('../../_wasm/load.ts'), import('../../_wasm/packed/blake.ts')]).then((
		[{ load, unpack }, { text }],
	) => unpack(text).then(load));
}

worker.serve<BatchType, DigestsType>({
	protocol,
	async run(batch) {
		if (batch.subtree !== undefined) {
			const value = (await engine()).hash(subtree, batch.data.subarray(batch.offsets[0], batch.offsets[1]), {
				key: batch.subtree,
			});
			return worker.reply({ digests: value }, [value.buffer as ArrayBuffer]);
		}
		const module = await family(batch.family);
		const options: HashOptionsType = {
			...(batch.key === undefined ? {} : { key: batch.key }),
			...(batch.length === undefined ? {} : { length: batch.length }),
		};
		// One buffer for the whole batch: a transfer list of thousands of small buffers costs more than the hashing.
		const count = batch.offsets.length / 2;
		let out: Uint8Array | undefined;
		for (let index = 0; index < count; index++) {
			const input = batch.data.subarray(batch.offsets[2 * index], batch.offsets[2 * index + 1]);
			const digest = module.hash(batch.name as never, input, options);
			out ??= new Uint8Array(digest.length * count);
			out.set(digest, index * digest.length);
		}
		const digests = out ?? new Uint8Array(0);
		return worker.reply({ digests }, [digests.buffer as ArrayBuffer]);
	},
});

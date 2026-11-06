/** Prepared native keys separate import cost from authenticated continuation encoding and verification. */
import { bench, do_not_optimize, group } from 'mitata';
import { run } from './fixtures/bench.ts';
import * as schema from '@okikio/schema';
import * as hmac from '@okikio/hash/hmac';
import { create } from '@okikio/query/cursor';
import { asc } from '@okikio/query';
const signer = await hmac.create('sha256', new Uint8Array(32).fill(11));
for (const count of [1, 4, 8]) {
	const values = Array.from({ length: count }, (_, index) => `key-${index}`);
	const cursor = create({
		contract: 'bench.v1',
		order: values.map((_, index) => asc('key' + index, { tiebreaker: index === count - 1 })),
		semantics: 'binary;nulls-last;unique-final',
		context: 'fixture-tenant',
		values: schema.array(schema.string(), { maxLength: count }),
	}, {
		keys: [{ id: 'k', signer }],
		activeKey: 'k',
		maximumKeys: 1,
		maximumTokenBytes: 16_384,
		expiresIn: 60_000,
		now: () => 0,
	});
	const token = await cursor.encode(values);
	if (JSON.stringify(await cursor.decode(token)) !== JSON.stringify(values)) {
		throw new Error('Cursor round-trip oracle failed.');
	}
	const reference = new TextEncoder().encode(JSON.stringify(values));
	const tag = await signer.sign(reference);
	if (!await signer.verify(reference, tag)) throw new Error('Native signer oracle failed.');
	group(`signed cursor ${count} key values; ${token.length} token bytes`, () => {
		bench('validated envelope encode and sign', async () => do_not_optimize(await cursor.encode(values)));
		bench('authenticate, bind and validate', async () => do_not_optimize(await cursor.decode(token)));
		bench('native sign reference without envelope contract', async () => do_not_optimize(await signer.sign(reference)));
		bench(
			'native verify reference without binding/validation',
			async () => do_not_optimize(await signer.verify(reference, tag)),
		);
	});
}
await run();

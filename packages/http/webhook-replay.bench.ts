/** Authentication cost versus an explicit borrowed atomic admission call, with prepared rotation keys. */
import { bench, do_not_optimize, group } from 'mitata';
import { run } from './fixtures/bench.ts';
import { encodeBase64 } from '@std/encoding/base64';
import { protect } from '@okikio/http/webhook';
import * as standard from '@okikio/http/webhook/standard';
for (const count of [1, 2, 8]) {
	const secrets = Array.from(
		{ length: count },
		(_, index) => 'whsec_' + encodeBase64(new Uint8Array(32).fill(index + 1)),
	);
	const signer = standard.create({ secret: secrets.at(-1)! });
	const verifier = standard.create({ secrets });
	for (const size of [1024, 1024 * 1024]) {
		const body = new Uint8Array(size);
		const input = {
			body,
			headers: new Headers(await signer.sign({ id: 'benchmark-event', body, timestamp: 1000 })),
			now: new Date(1000_000),
		};
		let claims = 0;
		const protectedVerifier = protect(verifier, {
			namespace: 'bench',
			maximumIdentityBytes: 128,
			maximumAgeSeconds: 300,
			maximumFutureSeconds: 300,
			store: {
				claim: () => {
					claims++;
					return false;
				},
			},
		});
		if (!(await verifier.verify(input)).ok || (await protectedVerifier.verify(input)).ok || claims !== 1) {
			throw new Error('Replay authentication oracle failed.');
		}
		group(`webhook ${count} authorized keys; ${size} body bytes`, () => {
			bench('signature then duplicate admission', async () => do_not_optimize(await protectedVerifier.verify(input)));
			bench('existing bounded verifier reference', async () => do_not_optimize(await verifier.verify(input)));
		});
	}
}
await run();

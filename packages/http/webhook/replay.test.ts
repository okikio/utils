import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import { encodeBase64 } from '@std/encoding/base64';
import { protect, verifyRequest } from './mod.ts';
import * as standard from './standard.ts';

const protocol = standard.create({
	secret: 'whsec_' + encodeBase64(new Uint8Array(32).fill(9)),
	toleranceSeconds: 100,
});
const policy = {
	namespace: 'provider:receiver',
	maximumIdentityBytes: 128,
	maximumAgeSeconds: 10,
	maximumFutureSeconds: 5,
};
/** Synchronous check-and-insert is atomic only inside this test isolate, not a production distributed store. */
function store() {
	const admitted = new Map<string, number>();
	return {
		admitted,
		claim(identity: string, expiresAt: number) {
			if (admitted.has(identity)) return false;
			admitted.set(identity, expiresAt);
			return true;
		},
	};
}
async function signed(now = 1000_000, body = new Uint8Array([0, 255, 13, 10])) {
	return {
		body,
		headers: new Headers(await protocol.sign({ id: 'event-7', timestamp: 1000, body })),
		now: new Date(now),
	};
}
describe('authenticated webhook replay admission', () => {
	it('admits one simultaneous duplicate and retains through the whole final valid second', async () => {
		const database = store();
		const verifier = protect(protocol, { ...policy, store: database });
		const input = await signed(1010_999);
		const results = await Promise.all(Array.from({ length: 100 }, () => verifier.verify(input)));
		expect(results.filter((result) => result.ok)).toHaveLength(1);
		expect(results.filter((result) => !result.ok && result.code === 'duplicate')).toHaveLength(99);
		expect([...database.admitted.values()]).toEqual([1011_000]);
		expect(await verifier.verify({ ...input, now: new Date(1011_000) })).toEqual({
			ok: false,
			code: 'timestamp-too-old',
		});
	});
	it('does not claim invalid signatures, old/future timestamps or oversize raw bodies', async () => {
		let claims = 0;
		const verifier = protect(protocol, {
			...policy,
			store: {
				claim: () => {
					claims++;
					return true;
				},
			},
		});
		const input = await signed();
		expect(await verifier.verify({ ...input, body: new Uint8Array([1]) })).toEqual({
			ok: false,
			code: 'invalid-signature',
		});
		expect(await verifier.verify({ ...input, now: new Date(1011_000) })).toEqual({
			ok: false,
			code: 'timestamp-too-old',
		});
		expect(await verifier.verify({ ...input, now: new Date(994_000) })).toEqual({
			ok: false,
			code: 'timestamp-too-new',
		});
		const request = new Request('https://receiver.invalid', {
			method: 'POST',
			headers: input.headers,
			body: input.body,
		});
		expect(await verifyRequest(request, verifier, { maximumBodyBytes: 1, now: input.now })).toEqual({
			ok: false,
			code: 'body-too-large',
		});
		expect(claims).toBe(0);
	});
	it('fails closed on a store fault and preserves exact signed bytes and the original Request', async () => {
		const failure = new Error('store unavailable');
		const input = await signed();
		const failing = protect(protocol, {
			...policy,
			store: {
				claim: () => {
					throw failure;
				},
			},
		});
		await expect(failing.verify(input)).rejects.toBe(failure);
		const verifier = protect(protocol, { ...policy, store: store() });
		const request = new Request('https://receiver.invalid', {
			method: 'POST',
			headers: input.headers,
			body: input.body,
		});
		expect((await verifyRequest(request, verifier, { now: input.now })).ok).toBe(true);
		expect(new Uint8Array(await request.arrayBuffer())).toEqual(input.body);
	});
	it('separates receiver namespaces and checks the encoded UTF-8 identity bound before storage', async () => {
		const database = store();
		const input = await signed();
		expect((await protect(protocol, { ...policy, store: database }).verify(input)).ok).toBe(true);
		expect((await protect(protocol, { ...policy, namespace: 'other', store: database }).verify(input)).ok).toBe(true);
		let claimed = false;
		const small = protect(protocol, {
			...policy,
			namespace: 'é',
			maximumIdentityBytes: 10,
			store: {
				claim: () => {
					claimed = true;
					return true;
				},
			},
		});
		await expect(small.verify(input)).rejects.toThrow(RangeError);
		expect(claimed).toBe(false);
	});
});

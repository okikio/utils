import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import { encodeBase64 } from '@std/encoding/base64';

import { verifyRequest } from './mod.ts';
import * as standard from './standard.ts';

const vectorSecret = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';
const vectorId = 'msg_p5jXN8AQM9LWM0D4loKWxJek';
const vectorTimestamp = 1614265330;
const vectorBody = '{"test": 2432232314}';
const vectorSignature = 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=';

function secret(byte: number): string {
	return `whsec_${encodeBase64(new Uint8Array(32).fill(byte))}`;
}

describe('Standard Webhooks', () => {
	it('matches the official symmetric signing vector exactly', async () => {
		const protocol = standard.create({ secret: vectorSecret });
		const headers = await protocol.sign({ id: vectorId, timestamp: vectorTimestamp, body: vectorBody });
		expect(headers['webhook-signature']).toBe(vectorSignature);
	});

	it('verifies exact bytes without consuming the original Request', async () => {
		const protocol = standard.create({ secret: vectorSecret });
		const headers = await protocol.sign({ id: vectorId, timestamp: vectorTimestamp, body: vectorBody });
		const request = new Request('https://example.invalid/webhook', { method: 'POST', headers, body: vectorBody });
		const result = await verifyRequest(request, protocol, { now: new Date(vectorTimestamp * 1000) });
		expect(result).toMatchObject({ ok: true, id: vectorId, keyIndex: 0 });
		expect(await request.text()).toBe(vectorBody);
	});

	it('supports verification and signing during symmetric key rotation', async () => {
		const current = secret(1); const previous = secret(2);
		const signer = standard.create({ secret: previous });
		const rotated = standard.create({ secrets: [current, previous] });
		const headers = await signer.sign({ id: 'evt_rotation', timestamp: 1000, body: '{}' });
		const verified = await rotated.verify({ body: new TextEncoder().encode('{}'), headers: new Headers(headers), now: new Date(1000_000) });
		expect(verified).toMatchObject({ ok: true, keyIndex: 1 });
		const outbound = await rotated.sign({ id: 'evt_rotation', timestamp: 1000, body: '{}' });
		expect(outbound['webhook-signature'].split(' ')).toHaveLength(2);
	});

	it('enforces timestamp, signature, key, header, body, and identifier bounds', async () => {
		const protocol = standard.create({ secret: vectorSecret, toleranceSeconds: 300 });
		const signed = await protocol.sign({ id: vectorId, timestamp: 1000, body: '{}' });
		for (const [value, code] of [['1000x', 'malformed-timestamp'], ['699', 'timestamp-too-old'], ['1301', 'timestamp-too-new']] as const) {
			const headers = new Headers(signed); headers.set('webhook-timestamp', value);
			expect((await protocol.verify({ body: new TextEncoder().encode('{}'), headers, now: new Date(1000_000) })).ok).toBe(false);
			const result = await protocol.verify({ body: new TextEncoder().encode('{}'), headers, now: new Date(1000_000) });
			if (!result.ok) expect(result.code).toBe(code);
		}
		expect(() => standard.create({ secrets: Array.from({ length: 11 }, (_, i) => secret(i)) })).toThrow('At most 10');
		expect(() => standard.create({ secret: `whsec_${encodeBase64(new Uint8Array(8))}` })).toThrow('24-64');
		await expect(protocol.sign({ id: 'bad.id', body: '{}' })).rejects.toThrow('Webhook id');

		const tooMany = new Headers(signed); tooMany.set('webhook-signature', Array(11).fill(vectorSignature).join(' '));
		const countResult = await protocol.verify({ body: new TextEncoder().encode('{}'), headers: tooMany, now: new Date(1000_000) });
		expect(countResult).toEqual({ ok: false, code: 'too-many-signatures' });

		const huge = new Headers(signed); huge.set('webhook-signature', `v1,${'A'.repeat(9000)}`);
		const hugeResult = await protocol.verify({ body: new TextEncoder().encode('{}'), headers: huge, now: new Date(1000_000) });
		expect(hugeResult).toEqual({ ok: false, code: 'signature-header-too-large' });

		const request = new Request('https://example.invalid', { method: 'POST', headers: signed, body: '12345' });
		expect(await verifyRequest(request, protocol, { maximumBodyBytes: 4, now: new Date(1000_000) })).toEqual({ ok: false, code: 'body-too-large' });
	});

	it('does not convert verifier implementation exceptions into authentication failures', async () => {
		const request = new Request('https://example.invalid', { method: 'POST', body: '{}' });
		await expect(verifyRequest(request, { verify() { throw new Error('verifier bug'); } })).rejects.toThrow('verifier bug');
	});
});

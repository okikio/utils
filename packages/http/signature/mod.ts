/** Exact-byte SHA-256 and HMAC authentication; callers own audience, replay and key policy. @module */
import { hex, unhex } from '@okikio/hash/encoding';
import { sign as authenticate, verify as check } from '@okikio/hash/hmac';
export { sha256 as digest } from '@okikio/hash';

/** Keep the HTTP string-secret policy while Hash owns byte-level HMAC operations. */
function key(secret: string): Uint8Array {
	if (!secret.trim()) throw new TypeError('HMAC secret is required.');
	return new TextEncoder().encode(secret);
}

/** Sign exact bytes. Protocol version, expiry and scope must be inside those bytes. */
export async function sign(secret: string, value: Uint8Array): Promise<string> {
	return hex(await authenticate('sha256', key(secret), value));
}

/** Verify a canonical 32-byte hexadecimal signature with native HMAC verification. */
export async function verify(secret: string, value: Uint8Array, signature: string): Promise<boolean> {
	if (!/^[a-f0-9]{64}$/u.test(signature)) return false;
	return await check('sha256', key(secret), value, unhex(signature));
}

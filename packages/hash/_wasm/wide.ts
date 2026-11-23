/**
 * Whether the host runs the WebAssembly wide-arithmetic feature (64×64→128-bit multiply and 128-bit add).
 *
 * The probe is the smallest module that uses it: one function that returns `i64.mul_wide_u` of its two
 * parameters (34 bytes). `WebAssembly.validate` compiles nothing and runs nothing. Bun and Firefox 155 accept
 * it, and so does WebKit 27.2; V8 (Chrome, Node.js, Deno) accepts it only behind `--experimental-wasm-wide-arithmetic`.
 *
 * @module
 */

const probe = /* @__PURE__ */ Uint8Array.from([
	0x00,
	0x61,
	0x73,
	0x6d,
	0x01,
	0x00,
	0x00,
	0x00,
	0x01,
	0x08,
	0x01,
	0x60,
	0x02,
	0x7e,
	0x7e,
	0x02,
	0x7e,
	0x7e,
	0x03,
	0x02,
	0x01,
	0x00,
	0x0a,
	0x0a,
	0x01,
	0x08,
	0x00,
	0x20,
	0x00,
	0x20,
	0x01,
	0xfc,
	0x16,
	0x0b,
]);

let result: boolean | undefined;

/** True when the host validates the probe. The answer is computed once. */
export function wide(): boolean {
	if (result === undefined) {
		try {
			result = typeof WebAssembly === 'object' && WebAssembly.validate(probe);
		} catch {
			result = false;
		}
	}
	return result;
}

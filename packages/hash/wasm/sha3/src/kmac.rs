//! KMAC128 and KMAC256 (NIST SP 800-185 section 4) on top of cSHAKE.
//!
//! KMAC is cSHAKE with the function name `KMAC`. It absorbs `bytepad(encode_string(K), rate)` first and
//! `right_encode(L)` last, where `L` is the output length in bits. Because `L` is part of the input, a
//! 32-byte tag is not a prefix of a 64-byte tag. The customization string is empty here.

use digest::{ExtendableOutput, Update};

/// A KMAC state that appends `right_encode(L)` when it finalizes.
#[derive(Clone)]
pub struct Kmac<H> {
	hash: H,
	bits: u64,
}

/// Write `x` big-endian with no leading zero bytes, at least one byte, into `out`; return the length.
fn integer(x: u64, out: &mut [u8; 8]) -> usize {
	let bytes = x.to_be_bytes();
	let skip = bytes.iter().position(|byte| *byte != 0).unwrap_or(7);
	let len = 8 - skip;
	if let (Some(target), Some(source)) = (out.get_mut(..len), bytes.get(skip..)) {
		target.copy_from_slice(source);
	}
	len
}

/// Absorb `left_encode(x)` and return how many bytes it took.
fn left<H: Update>(hash: &mut H, x: u64) -> usize {
	let mut digits = [0u8; 8];
	let len = integer(x, &mut digits);
	hash.update(&[u8::try_from(len).unwrap_or(8)]);
	hash.update(digits.get(..len).unwrap_or_default());
	len + 1
}

impl<H: Update + Clone> Kmac<H> {
	/// Start KMAC: `rate` is 168 for KMAC128 and 136 for KMAC256; `len` is the output length in bytes.
	pub fn new(mut hash: H, rate: usize, key: &[u8], len: u32) -> Self {
		let mut used = left(&mut hash, rate as u64);
		used += left(&mut hash, (key.len() as u64) * 8);
		hash.update(key);
		used += key.len();
		let zeros = [0u8; 168];
		let pad = (rate - used % rate) % rate;
		hash.update(zeros.get(..pad).unwrap_or_default());
		Self { hash, bits: u64::from(len) * 8 }
	}
}

impl<H: Update> Update for Kmac<H> {
	fn update(&mut self, data: &[u8]) {
		self.hash.update(data);
	}
}

impl<H: Update + ExtendableOutput> ExtendableOutput for Kmac<H> {
	type Reader = H::Reader;

	fn finalize_xof(mut self) -> Self::Reader {
		let mut digits = [0u8; 8];
		let len = integer(self.bits, &mut digits);
		self.hash.update(digits.get(..len).unwrap_or_default());
		self.hash.update(&[u8::try_from(len).unwrap_or(8)]);
		self.hash.finalize_xof()
	}
}

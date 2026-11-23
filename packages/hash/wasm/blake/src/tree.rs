//! BLAKE3 subtrees and merges, so that workers can hash parts of one input and combine the results.
//!
//! The functions come from `blake3::hazmat`. A subtree must start at a multiple of its own size, and its size must
//! be a power of two chunks of 1024 bytes, except the last subtree of the input; `left_subtree_len` gives the split
//! that keeps both true. The caller owns that planning; a wrong split gives a wrong digest, not an error.
//!
//! The key bytes carry the parameters: for a subtree, an 8-byte little-endian input offset, then the mode; for a
//! merge, the mode alone. The mode is one byte (0 hash, 1 keyed, 2 derive-key) and its key material: nothing, a
//! 32-byte key, or the UTF-8 context string.

use abi::Error;
use blake3::hazmat::{ChainingValue, HasherExt as _, Mode, hash_derive_key_context, merge_subtrees_non_root};

/// The mode of a tree operation, with its 32-byte key or derived context key.
#[derive(Clone, Copy)]
pub enum Kind {
	/// Plain hashing.
	Hash,
	/// Keyed hashing.
	Keyed([u8; 32]),
	/// Derive-key mode, with the context key.
	Derive([u8; 32]),
}

impl Kind {
	/// Parse the mode byte and its material.
	fn parse(bytes: &[u8]) -> Result<Self, Error> {
		let (&tag, rest) = bytes.split_first().ok_or(Error::Invalid)?;
		match tag {
			0 if rest.is_empty() => Ok(Self::Hash),
			1 => Ok(Self::Keyed(rest.try_into().map_err(|_| Error::Invalid)?)),
			2 => Ok(Self::Derive(hash_derive_key_context(core::str::from_utf8(rest).map_err(|_| Error::Invalid)?))),
			_ => Err(Error::Invalid),
		}
	}

	/// The hazmat mode.
	fn mode(&self) -> Mode<'_> {
		match self {
			Self::Hash => Mode::Hash,
			Self::Keyed(key) => Mode::KeyedHash(key),
			Self::Derive(key) => Mode::DeriveKeyMaterial(key),
		}
	}

	/// A hasher for this mode.
	fn hasher(&self) -> blake3::Hasher {
		match self {
			Self::Hash => blake3::Hasher::new(),
			Self::Keyed(key) => blake3::Hasher::new_keyed(key),
			Self::Derive(key) => blake3::Hasher::new_from_context_key(key),
		}
	}
}

/// Start a subtree: `key` is the 8-byte offset and then the mode.
pub fn subtree(key: &[u8]) -> Result<blake3::Hasher, Error> {
	let (offset, mode) = key.split_at_checked(8).ok_or(Error::Invalid)?;
	let offset = u64::from_le_bytes(offset.try_into().map_err(|_| Error::Invalid)?);
	let mut hasher = Kind::parse(mode)?.hasher();
	hasher.set_input_offset(offset);
	Ok(hasher)
}

/// The chaining value of a finished subtree.
pub fn chaining(hasher: &blake3::Hasher) -> ChainingValue {
	hasher.finalize_non_root()
}

/// A merge of two chaining values: it collects 64 input bytes, left then right.
#[derive(Clone)]
pub struct Merge {
	kind: Kind,
	pair: [u8; 64],
	len: usize,
}

impl Merge {
	/// Start a merge in the mode that `key` gives.
	pub fn new(key: &[u8]) -> Result<Self, Error> {
		Ok(Self { kind: Kind::parse(key)?, pair: [0; 64], len: 0 })
	}

	/// Collect input; bytes beyond 64 make the merge invalid.
	pub fn update(&mut self, data: &[u8]) {
		let end = self.len.saturating_add(data.len());
		if let Some(target) = self.pair.get_mut(self.len..end) {
			target.copy_from_slice(data);
		}
		self.len = end;
	}

	fn children(&self) -> Option<(ChainingValue, ChainingValue)> {
		if self.len != 64 {
			return None;
		}
		let (left, right) = self.pair.split_at(32);
		Some((left.try_into().ok()?, right.try_into().ok()?))
	}

	/// The parent chaining value, for a merge below the root. `None` unless exactly 64 bytes came in.
	pub fn non_root(&self) -> Option<ChainingValue> {
		let (left, right) = self.children()?;
		Some(merge_subtrees_non_root(&left, &right, self.kind.mode()))
	}

	/// The root output reader. `None` unless exactly 64 bytes came in.
	pub fn root(&self) -> Option<blake3::OutputReader> {
		let (left, right) = self.children()?;
		Some(blake3::hazmat::merge_subtrees_root_xof(&left, &right, self.kind.mode()))
	}
}

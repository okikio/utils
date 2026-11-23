//! BLAKE family: BLAKE2b and BLAKE2s at their standard output sizes, unkeyed or keyed, and BLAKE3 in
//! hash, keyed and derive-key modes with any output length.
//!
//! BLAKE2 ids pick the output size, because `blake2` 0.11 fixes it at compile time. A non-empty key
//! (1 to 64 bytes for BLAKE2b, 1 to 32 for BLAKE2s) selects BLAKE2's own keyed mode; BLAKE2 does not
//! need HMAC. For BLAKE3 id 16, an empty key hashes and a 32-byte key selects keyed mode; for id 17
//! the key bytes are the UTF-8 context string of derive-key mode. BLAKE3's `param` is the output length
//! in bytes, and 0 means the default 32.
//!
//! Ids 18 to 20 split one BLAKE3 input across workers: 18 hashes a subtree to its chaining value, 19 merges two
//! chaining values below the root, and 20 merges them at the root with `param` bytes of output. See [`tree`].
#![no_std]

mod tree;

use abi::{Error, Family, Output, WINDOW, put};
use blake2::digest::consts::{U16, U20, U28, U32, U48, U64};
use blake2::{Blake2b, Blake2bMac, Blake2s, Blake2sMac};
use digest::{FixedOutput, KeyInit, Update};

/// The family marker type.
pub struct Blake;

macro_rules! blake2 {
	($($id:literal => $name:ident: $plain:ty, $keyed:ty),+ $(,)?) => {
		/// A BLAKE2 state.
		#[derive(Clone)]
		pub enum Two {
			$(#[doc = stringify!($plain)] $name($plain, Option<$keyed>),)+
		}

		impl Two {
			fn new(id: u32, key: &[u8]) -> Result<Self, Error> {
				match id {
					$($id => Ok(Self::$name(
						Default::default(),
						if key.is_empty() { None } else {
							Some(<$keyed>::new_from_slice(key).map_err(|_| Error::Invalid)?)
						},
					)),)+
					_ => Err(Error::Unknown),
				}
			}

			fn update(&mut self, data: &[u8]) {
				match self {
					$(Self::$name(_, Some(mac)) => mac.update(data),
					Self::$name(hash, None) => hash.update(data),)+
				}
			}

			fn finish(self, out: &mut [u8; WINDOW]) -> usize {
				match self {
					$(Self::$name(_, Some(mac)) => put(out, &mac.finalize_fixed()),
					Self::$name(hash, None) => put(out, &hash.finalize_fixed()),)+
				}
			}
		}
	};
}

blake2! {
	1 => B128: Blake2b<U16>, Blake2bMac<U16>,
	2 => B160: Blake2b<U20>, Blake2bMac<U20>,
	3 => B224: Blake2b<U28>, Blake2bMac<U28>,
	4 => B256: Blake2b<U32>, Blake2bMac<U32>,
	5 => B384: Blake2b<U48>, Blake2bMac<U48>,
	6 => B512: Blake2b<U64>, Blake2bMac<U64>,
	7 => S128: Blake2s<U16>, Blake2sMac<U16>,
	8 => S160: Blake2s<U20>, Blake2sMac<U20>,
	9 => S224: Blake2s<U28>, Blake2sMac<U28>,
	10 => S256: Blake2s<U32>, Blake2sMac<U32>,
}

/// A live state of this family.
///
/// Slots are a fixed array with no allocator, so every slot has the size of the largest state (BLAKE3's
/// chunk stack, about 1.9 KiB). Boxing the large variant would need an allocator.
#[allow(clippy::large_enum_variant)]
#[derive(Clone)]
pub enum State {
	/// BLAKE2b or BLAKE2s.
	Two(Two),
	/// BLAKE3 and the output length.
	Three(blake3::Hasher, usize),
	/// A BLAKE3 subtree; it finishes to a chaining value.
	Subtree(blake3::Hasher),
	/// A merge of two BLAKE3 chaining values, with the root output length, or `None` below the root.
	Merge(tree::Merge, Option<usize>),
}

impl Family for Blake {
	type State = State;
	type Reader = blake3::OutputReader;

	fn init(id: u32, param: u32, key: &[u8]) -> Result<State, Error> {
		match id {
			16 | 17 => {
				let len = if param == 0 { blake3::OUT_LEN } else { param as usize };
				let hasher = if id == 17 {
					blake3::Hasher::new_derive_key(core::str::from_utf8(key).map_err(|_| Error::Invalid)?)
				} else if key.is_empty() {
					blake3::Hasher::new()
				} else {
					blake3::Hasher::new_keyed(key.try_into().map_err(|_| Error::Invalid)?)
				};
				Ok(State::Three(hasher, len))
			}
			18 if param == 0 => tree::subtree(key).map(State::Subtree),
			19 if param == 0 => tree::Merge::new(key).map(|merge| State::Merge(merge, None)),
			20 => {
				let len = if param == 0 { blake3::OUT_LEN } else { param as usize };
				tree::Merge::new(key).map(|merge| State::Merge(merge, Some(len)))
			}
			_ if param != 0 => Err(Error::Invalid),
			_ => Two::new(id, key).map(State::Two),
		}
	}

	fn update(state: &mut State, data: &[u8]) {
		match state {
			State::Two(two) => two.update(data),
			State::Three(hasher, _) | State::Subtree(hasher) => {
				hasher.update(data);
			}
			State::Merge(merge, _) => merge.update(data),
		}
	}

	fn finish(state: State, out: &mut [u8; WINDOW]) -> Output<Self::Reader> {
		match state {
			State::Two(two) => Output::Done(two.finish(out)),
			State::Three(hasher, total) => {
				let mut reader = hasher.finalize_xof();
				let first = total.min(WINDOW);
				if let Some(target) = out.get_mut(..first) {
					reader.fill(target);
				}
				if total > first { Output::Reader(reader, first) } else { Output::Done(first) }
			}
			State::Subtree(hasher) => Output::Done(put(out, &tree::chaining(&hasher))),
			// A merge without exactly 64 input bytes finishes with no output; the caller checks the length.
			State::Merge(merge, None) => Output::Done(merge.non_root().map_or(0, |value| put(out, &value))),
			State::Merge(merge, Some(total)) => match merge.root() {
				None => Output::Done(0),
				Some(mut reader) => {
					let first = total.min(WINDOW);
					if let Some(target) = out.get_mut(..first) {
						reader.fill(target);
					}
					if total > first { Output::Reader(reader, first) } else { Output::Done(first) }
				}
			},
		}
	}

	fn read(reader: &mut Self::Reader, out: &mut [u8]) {
		reader.fill(out);
	}

	fn fork(state: &State) -> Option<State> {
		Some(state.clone())
	}
}

abi::export!(Blake);

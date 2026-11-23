//! Fast family: XXH32, XXH64, XXH3-64, XXH3-128, rapidhash v3, SeaHash and FNV-1a 64.
//!
//! These are not cryptographic. Use them for hash tables, sharding and deduplication of trusted data.
//! The key is an optional seed: 4 little-endian bytes for XXH32, 8 for XXH64 and XXH3, and 32 (four
//! 64-bit words) for SeaHash. rapidhash and FNV-1a take no key. Outputs are big-endian, the canonical
//! byte form of xxHash and the order in which the numbers are usually printed.
#![no_std]

use abi::{Error, Family, Output, WINDOW, put};
use core::hash::Hasher as _;
use rapidhash::v3::{DEFAULT_RAPID_SECRETS, RapidStreamHasherV3};
use xxhash_rust::{xxh3::Xxh3, xxh32::Xxh32, xxh64::Xxh64};

/// The family marker type.
pub struct Fast;

/// A live state.
pub enum State {
	/// XXH32.
	Xxh32(Xxh32),
	/// XXH64.
	Xxh64(Xxh64),
	/// XXH3 with 64-bit output.
	Xxh3(Xxh3),
	/// XXH3 with 128-bit output.
	Xxh3x128(Xxh3),
	/// rapidhash v3 with the default secrets.
	Rapid(RapidStreamHasherV3<'static>),
	/// SeaHash.
	Sea(seahash::SeaHasher),
	/// FNV-1a, 64 bits.
	Fnv(fnv::FnvHasher),
}

fn seed<const N: usize>(key: &[u8]) -> Result<[u8; N], Error> {
	if key.is_empty() { Ok([0; N]) } else { key.try_into().map_err(|_| Error::Invalid) }
}

impl Family for Fast {
	type State = State;
	type Reader = core::convert::Infallible;

	fn init(id: u32, param: u32, key: &[u8]) -> Result<State, Error> {
		if param != 0 {
			return Err(Error::Invalid);
		}
		let none = || if key.is_empty() { Ok(()) } else { Err(Error::Invalid) };
		Ok(match id {
			1 => State::Xxh32(Xxh32::new(u32::from_le_bytes(seed(key)?))),
			2 => State::Xxh64(Xxh64::new(u64::from_le_bytes(seed(key)?))),
			3 => State::Xxh3(Xxh3::with_seed(u64::from_le_bytes(seed(key)?))),
			4 => State::Xxh3x128(Xxh3::with_seed(u64::from_le_bytes(seed(key)?))),
			5 => {
				none()?;
				State::Rapid(RapidStreamHasherV3::new(&DEFAULT_RAPID_SECRETS))
			}
			6 => State::Sea(if key.is_empty() {
				seahash::SeaHasher::new()
			} else {
				let words: [u8; 32] = seed(key)?;
				let word = |index: usize| {
					let mut bytes = [0u8; 8];
					bytes.copy_from_slice(words.get(index * 8..index * 8 + 8).unwrap_or(&[0; 8]));
					u64::from_le_bytes(bytes)
				};
				seahash::SeaHasher::with_seeds(word(0), word(1), word(2), word(3))
			}),
			7 => {
				none()?;
				State::Fnv(fnv::FnvHasher::default())
			}
			_ => return Err(Error::Unknown),
		})
	}

	fn update(state: &mut State, data: &[u8]) {
		match state {
			State::Xxh32(hash) => hash.update(data),
			State::Xxh64(hash) => hash.update(data),
			State::Xxh3(hash) | State::Xxh3x128(hash) => hash.update(data),
			State::Rapid(hash) => hash.write(data),
			State::Sea(hash) => hash.write(data),
			State::Fnv(hash) => hash.write(data),
		}
	}

	fn finish(state: State, out: &mut [u8; WINDOW]) -> Output<Self::Reader> {
		Output::Done(match state {
			State::Xxh32(hash) => put(out, &hash.digest().to_be_bytes()),
			State::Xxh64(hash) => put(out, &hash.digest().to_be_bytes()),
			State::Xxh3(hash) => put(out, &hash.digest().to_be_bytes()),
			State::Xxh3x128(hash) => put(out, &hash.digest128().to_be_bytes()),
			State::Rapid(hash) => put(out, &hash.finish().to_be_bytes()),
			State::Sea(hash) => put(out, &hash.finish().to_be_bytes()),
			State::Fnv(hash) => put(out, &hash.finish().to_be_bytes()),
		})
	}

	fn read(reader: &mut Self::Reader, _out: &mut [u8]) {
		match *reader {}
	}

	fn fork(state: &State) -> Option<State> {
		Some(match state {
			State::Xxh32(hash) => State::Xxh32(hash.clone()),
			State::Xxh64(hash) => State::Xxh64(hash.clone()),
			State::Xxh3(hash) => State::Xxh3(hash.clone()),
			State::Xxh3x128(hash) => State::Xxh3x128(hash.clone()),
			// The rapidhash stream hasher does not implement Clone.
			State::Rapid(_) => return None,
			State::Sea(hash) => State::Sea(*hash),
			// FNV keeps its whole state in the running value, so the value restores it.
			State::Fnv(hash) => State::Fnv(fnv::FnvHasher::with_key(hash.finish())),
		})
	}
}

abi::export!(Fast);

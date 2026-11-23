//! MAC family: SipHash-2-4 and SipHash-1-3 at 64 and 128 bits, and HighwayHash at 64, 128 and 256 bits.
//!
//! These are keyed hashes for hash tables and short-input authentication where the attacker must not
//! choose collisions. The key is required: 16 bytes for SipHash, 32 bytes for HighwayHash. Outputs are
//! the little-endian bytes of the result words, which is the byte order of the reference
//! implementations' test vectors.
#![no_std]

use abi::{Error, Family, Output, WINDOW, put};
use core::hash::Hasher as _;
use highway::{HighwayHash as _, HighwayHasher, Key};
use siphasher::sip::{SipHasher13, SipHasher24};
use siphasher::sip128::{Hasher128 as _, SipHasher13 as Sip13x128, SipHasher24 as Sip24x128};

/// The family marker type.
pub struct Mac;

/// A live state and, for HighwayHash, the output width in 64-bit words.
#[derive(Clone)]
pub enum State {
	/// SipHash-2-4, 64 bits.
	Sip24(SipHasher24),
	/// SipHash-2-4, 128 bits.
	Sip24x128(Sip24x128),
	/// SipHash-1-3, 64 bits.
	Sip13(SipHasher13),
	/// SipHash-1-3, 128 bits.
	Sip13x128(Sip13x128),
	/// HighwayHash and the number of 64-bit output words (1, 2 or 4).
	Highway(HighwayHasher, u8),
}

fn words<const N: usize>(bytes: &[u8]) -> Option<[u64; N]> {
	if bytes.len() != N * 8 {
		return None;
	}
	let mut out = [0u64; N];
	for (word, chunk) in out.iter_mut().zip(bytes.chunks_exact(8)) {
		*word = u64::from_le_bytes(chunk.try_into().ok()?);
	}
	Some(out)
}

fn put_words(out: &mut [u8; WINDOW], words: &[u64]) -> usize {
	let mut len = 0;
	for word in words {
		len += out.get_mut(len..len + 8).map_or(0, |target| {
			target.copy_from_slice(&word.to_le_bytes());
			8
		});
	}
	len
}

impl Family for Mac {
	type State = State;
	type Reader = core::convert::Infallible;

	fn init(id: u32, param: u32, key: &[u8]) -> Result<State, Error> {
		if param != 0 {
			return Err(Error::Invalid);
		}
		let sip = || key.try_into().map_err(|_| Error::Invalid);
		let highway = || words::<4>(key).map(Key).ok_or(Error::Invalid);
		Ok(match id {
			1 => State::Sip24(SipHasher24::new_with_key(&sip()?)),
			2 => State::Sip24x128(Sip24x128::new_with_key(&sip()?)),
			3 => State::Sip13(SipHasher13::new_with_key(&sip()?)),
			4 => State::Sip13x128(Sip13x128::new_with_key(&sip()?)),
			5 => State::Highway(HighwayHasher::new(highway()?), 1),
			6 => State::Highway(HighwayHasher::new(highway()?), 2),
			7 => State::Highway(HighwayHasher::new(highway()?), 4),
			_ => return Err(Error::Unknown),
		})
	}

	fn update(state: &mut State, data: &[u8]) {
		match state {
			State::Sip24(hash) => hash.write(data),
			State::Sip24x128(hash) => hash.write(data),
			State::Sip13(hash) => hash.write(data),
			State::Sip13x128(hash) => hash.write(data),
			State::Highway(hash, _) => hash.append(data),
		}
	}

	fn finish(state: State, out: &mut [u8; WINDOW]) -> Output<Self::Reader> {
		Output::Done(match state {
			State::Sip24(hash) => put(out, &hash.finish().to_le_bytes()),
			State::Sip13(hash) => put(out, &hash.finish().to_le_bytes()),
			State::Sip24x128(hash) => put(out, &hash.finish128().as_bytes()),
			State::Sip13x128(hash) => put(out, &hash.finish128().as_bytes()),
			State::Highway(hash, 1) => put_words(out, &[hash.finalize64()]),
			State::Highway(hash, 2) => put_words(out, &hash.finalize128()),
			State::Highway(hash, _) => put_words(out, &hash.finalize256()),
		})
	}

	fn read(reader: &mut Self::Reader, _out: &mut [u8]) {
		match *reader {}
	}

	fn fork(state: &State) -> Option<State> {
		Some(state.clone())
	}
}

abi::export!(Mac);

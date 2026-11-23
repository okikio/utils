//! Checksum family: every CRC in the RevEng catalogue, Adler-32 and Fletcher-16.
//!
//! CRC ids follow the order of the `crc-catalog` crate (see the generated `catalog.rs`). CRC-32/ISO-HDLC
//! uses `crc32fast`; 13 widely used CRCs use a 256-entry table; the others compute bit by bit, which
//! is slower but keeps the module small. Outputs are big-endian, in the fewest whole bytes that hold the
//! CRC width, so that the hex matches the catalogue's `check` values.
#![no_std]

mod catalog;

use abi::{Error, Family, Output, WINDOW, put};
use crc::{Digest, NoTable, Table};

/// Adler-32's id.
const ADLER32: u32 = 200;
/// Fletcher-16's id.
const FLETCHER16: u32 = 201;

/// The family marker type.
pub struct Checksum;

/// A live state. CRC variants carry their output length in bytes.
#[derive(Clone)]
#[allow(missing_docs)]
pub enum State {
	Fast(crc32fast::Hasher),
	U8T(Digest<'static, u8, Table<1>>, u8),
	U8N(Digest<'static, u8, NoTable>, u8),
	U16T(Digest<'static, u16, Table<1>>, u8),
	U16N(Digest<'static, u16, NoTable>, u8),
	U32T(Digest<'static, u32, Table<1>>, u8),
	U32N(Digest<'static, u32, NoTable>, u8),
	U64T(Digest<'static, u64, Table<1>>, u8),
	U64N(Digest<'static, u64, NoTable>, u8),
	U128T(Digest<'static, u128, Table<1>>, u8),
	U128N(Digest<'static, u128, NoTable>, u8),
	Adler(adler2::Adler32),
	Fletcher(fletcher::Fletcher16),
}

/// Write the low `len` bytes of `value` big-endian.
fn tail(out: &mut [u8; WINDOW], value: u128, len: u8) -> usize {
	let bytes = value.to_be_bytes();
	put(out, bytes.get(16 - usize::from(len)..).unwrap_or(&[]))
}

impl Family for Checksum {
	type State = State;
	type Reader = core::convert::Infallible;

	fn init(id: u32, param: u32, key: &[u8]) -> Result<State, Error> {
		if param != 0 || !key.is_empty() {
			return Err(Error::Invalid);
		}
		match id {
			ADLER32 => Ok(State::Adler(adler2::Adler32::new())),
			FLETCHER16 => Ok(State::Fletcher(fletcher::Fletcher16::new())),
			_ => catalog::start(id).ok_or(Error::Unknown),
		}
	}

	fn update(state: &mut State, data: &[u8]) {
		match state {
			State::Fast(hash) => hash.update(data),
			State::U8T(hash, _) => hash.update(data),
			State::U8N(hash, _) => hash.update(data),
			State::U16T(hash, _) => hash.update(data),
			State::U16N(hash, _) => hash.update(data),
			State::U32T(hash, _) => hash.update(data),
			State::U32N(hash, _) => hash.update(data),
			State::U64T(hash, _) => hash.update(data),
			State::U64N(hash, _) => hash.update(data),
			State::U128T(hash, _) => hash.update(data),
			State::U128N(hash, _) => hash.update(data),
			State::Adler(hash) => hash.write_slice(data),
			State::Fletcher(hash) => hash.update(data),
		}
	}

	fn finish(state: State, out: &mut [u8; WINDOW]) -> Output<Self::Reader> {
		Output::Done(match state {
			State::Fast(hash) => put(out, &hash.finalize().to_be_bytes()),
			State::U8T(hash, len) => tail(out, hash.finalize().into(), len),
			State::U8N(hash, len) => tail(out, hash.finalize().into(), len),
			State::U16T(hash, len) => tail(out, hash.finalize().into(), len),
			State::U16N(hash, len) => tail(out, hash.finalize().into(), len),
			State::U32T(hash, len) => tail(out, hash.finalize().into(), len),
			State::U32N(hash, len) => tail(out, hash.finalize().into(), len),
			State::U64T(hash, len) => tail(out, hash.finalize().into(), len),
			State::U64N(hash, len) => tail(out, hash.finalize().into(), len),
			State::U128T(hash, len) => tail(out, hash.finalize(), len),
			State::U128N(hash, len) => tail(out, hash.finalize(), len),
			State::Adler(hash) => put(out, &hash.checksum().to_be_bytes()),
			State::Fletcher(hash) => put(out, &hash.value().to_be_bytes()),
		})
	}

	fn read(reader: &mut Self::Reader, _out: &mut [u8]) {
		match *reader {}
	}

	fn fork(state: &State) -> Option<State> {
		Some(state.clone())
	}
}

abi::export!(Checksum);

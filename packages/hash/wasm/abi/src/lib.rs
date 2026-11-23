//! The exported surface that every hash family module shares.
//!
//! A family crate maps algorithm ids to maintained hash crates by implementing [`Family`], then calls
//! [`export!`] once. The macro emits the functions that JavaScript calls. This crate owns the only
//! `unsafe` code in the workspace: the static input window and the static table of hash states.
//!
//! # Memory model
//!
//! The module has no allocator. It owns one 64 KiB **window** and [`SLOTS`] **slots**:
//!
//! ```text
//!   linear memory
//!   ┌──────────────────────────┬───────────────────────────────┐
//!   │ window: [u8; 65536]      │ slots: [Slot<F>; 16]           │
//!   │  JS writes input here,   │  each slot is Free, Hashing    │
//!   │  WASM writes output here │  (a live state) or Reading     │
//!   └──────────────────────────┴───────────────────────────────┘
//! ```
//!
//! JavaScript copies at most one window of bytes, then calls an export that names how many bytes it
//! wrote. Outputs are written back to the start of the same window. A slot is freed by `finish` for a
//! fixed-length digest, or by `dispose`. Dropping a state zeroizes it, because every hash crate in the
//! workspace is built with its `zeroize` feature.
//!
//! # Return codes
//!
//! Every export returns an `i32`. A value of 0 or more is a slot index or a byte count. A negative
//! value is an [`Error`] code. No export panics: invalid lengths, ids and slots return an error.
#![no_std]
#![allow(unsafe_code)]

use core::cell::UnsafeCell;

/// Size of the input and output window in bytes.
pub const WINDOW: usize = 64 * 1024;

/// Number of hash states that can be live at the same time.
pub const SLOTS: usize = 16;

#[cfg(target_feature = "atomics")]
compile_error!(
	"the abi crate assumes one thread per memory; a shared-memory build needs one window and slot table per worker"
);

/// Failure codes returned to JavaScript as negative numbers.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(i32)]
pub enum Error {
	/// The family has no algorithm with this id.
	Unknown = -1,
	/// All slots hold live states.
	Full = -2,
	/// A length, key or parameter is out of range for the algorithm.
	Invalid = -3,
	/// The slot index is out of range, or the slot is not in the state the call needs.
	Slot = -4,
}

/// What [`Family::finish`] produced.
pub enum Output<R> {
	/// A complete digest of this many bytes is at the start of the window.
	Done(usize),
	/// An extendable output: this many bytes are in the window, and the reader yields more.
	Reader(R, usize),
}

/// One family of algorithms, such as SHA-2 or BLAKE.
///
/// Implementations contain no `unsafe` code. They receive plain slices and return plain values.
pub trait Family: 'static {
	/// A live hash state. `Clone` lets JavaScript fork a state after a shared prefix.
	type State: Clone;
	/// The reader of an extendable-output function after it is finalized.
	type Reader: Clone;

	/// Create a state for algorithm `id`.
	///
	/// `param` is the requested output length in bytes for algorithms with a variable output, and 0
	/// otherwise. `key` is empty for unkeyed use.
	///
	/// # Errors
	///
	/// [`Error::Unknown`] for an id the family does not have, and [`Error::Invalid`] for a key or
	/// output length the algorithm does not accept.
	fn init(id: u32, param: u32, key: &[u8]) -> Result<Self::State, Error>;

	/// Absorb `data` into `state`.
	fn update(state: &mut Self::State, data: &[u8]);

	/// Finalize `state` and write the first output bytes to the start of `out`.
	fn finish(state: Self::State, out: &mut [u8; WINDOW]) -> Output<Self::Reader>;

	/// Write the next `out.len()` bytes of an extendable output.
	fn read(reader: &mut Self::Reader, out: &mut [u8]);
}

/// The state of one slot.
enum Slot<F: Family> {
	Free,
	Hashing(F::State),
	Reading(F::Reader),
}

// A derive would require `F: Clone`; only the state and reader need to be cloneable.
impl<F: Family> Clone for Slot<F> {
	fn clone(&self) -> Self {
		match self {
			Self::Free => Self::Free,
			Self::Hashing(state) => Self::Hashing(state.clone()),
			Self::Reading(reader) => Self::Reading(reader.clone()),
		}
	}
}

/// A value that exported functions may borrow mutably, one call at a time.
struct Exclusive<T>(UnsafeCell<T>);

// SAFETY: modules from this workspace are built without the `atomics` target feature (checked above),
// so the WASM instance runs one export at a time on one thread. Families have no imports, so an export
// cannot re-enter another export while it holds a borrow.
unsafe impl<T> Sync for Exclusive<T> {}

impl<T> Exclusive<T> {
	const fn new(value: T) -> Self {
		Self(UnsafeCell::new(value))
	}

	/// Borrow the value for the rest of one exported call.
	///
	/// Callers take this borrow once per export and drop it before the export returns, so no two
	/// mutable borrows of the same value exist.
	#[allow(clippy::mut_from_ref)]
	fn borrow(&self) -> &mut T {
		// SAFETY: see the `Sync` impl. Each export calls `borrow` at most once per value and does not
		// keep the reference after it returns.
		unsafe { &mut *self.0.get() }
	}
}

static WINDOW_BYTES: Exclusive<[u8; WINDOW]> = Exclusive::new([0; WINDOW]);

/// Address of the window in linear memory, for JavaScript to build a `Uint8Array` view.
#[must_use]
pub fn window_ptr() -> *mut u8 {
	WINDOW_BYTES.0.get().cast::<u8>()
}

/// The slot table of one family. A family crate creates one with [`export!`].
pub struct Runtime<F: Family> {
	slots: Exclusive<[Slot<F>; SLOTS]>,
}

impl<F: Family> Runtime<F> {
	/// An empty slot table.
	#[must_use]
	pub const fn new() -> Self {
		Self { slots: Exclusive::new([const { Slot::Free }; SLOTS]) }
	}

	/// Start algorithm `id`. The key is the first `key_len` bytes of the window.
	pub fn init(&self, id: u32, param: u32, key_len: u32) -> i32 {
		let window = WINDOW_BYTES.borrow();
		let slots = self.slots.borrow();
		let Some(key) = window.get(..key_len as usize) else { return Error::Invalid as i32 };
		let Some(index) = slots.iter().position(|slot| matches!(slot, Slot::Free)) else {
			return Error::Full as i32;
		};
		match F::init(id, param, key) {
			Ok(state) => {
				if let Some(slot) = slots.get_mut(index) {
					*slot = Slot::Hashing(state);
				}
				code(index)
			}
			Err(error) => error as i32,
		}
	}

	/// Absorb the first `len` bytes of the window into slot `slot`.
	pub fn update(&self, slot: u32, len: u32) -> i32 {
		let window = WINDOW_BYTES.borrow();
		let Some(data) = window.get(..len as usize) else { return Error::Invalid as i32 };
		match self.slots.borrow().get_mut(slot as usize) {
			Some(Slot::Hashing(state)) => {
				F::update(state, data);
				0
			}
			_ => Error::Slot as i32,
		}
	}

	/// Finalize slot `slot` and write its output to the window. Returns the number of bytes written.
	pub fn finish(&self, slot: u32) -> i32 {
		let window = WINDOW_BYTES.borrow();
		let Some(entry) = self.slots.borrow().get_mut(slot as usize) else { return Error::Slot as i32 };
		let Slot::Hashing(state) = core::mem::replace(entry, Slot::Free) else {
			return Error::Slot as i32;
		};
		match F::finish(state, window) {
			Output::Done(len) => code(len),
			Output::Reader(reader, len) => {
				*entry = Slot::Reading(reader);
				code(len)
			}
		}
	}

	/// Write the next `len` bytes of an extendable output from slot `slot` to the window.
	pub fn read(&self, slot: u32, len: u32) -> i32 {
		let window = WINDOW_BYTES.borrow();
		let Some(out) = window.get_mut(..len as usize) else { return Error::Invalid as i32 };
		match self.slots.borrow().get_mut(slot as usize) {
			Some(Slot::Reading(reader)) => {
				F::read(reader, out);
				code(out.len())
			}
			_ => Error::Slot as i32,
		}
	}

	/// Copy slot `slot` into a free slot and return the new index.
	pub fn fork(&self, slot: u32) -> i32 {
		let slots = self.slots.borrow();
		let Some(source) = slots.get(slot as usize) else { return Error::Slot as i32 };
		if matches!(source, Slot::Free) {
			return Error::Slot as i32;
		}
		let copy = source.clone();
		let Some(index) = slots.iter().position(|slot| matches!(slot, Slot::Free)) else {
			return Error::Full as i32;
		};
		if let Some(target) = slots.get_mut(index) {
			*target = copy;
		}
		code(index)
	}

	/// Free slot `slot`. Dropping the state zeroizes it. Freeing a free slot is not an error.
	pub fn dispose(&self, slot: u32) -> i32 {
		match self.slots.borrow().get_mut(slot as usize) {
			Some(entry) => {
				*entry = Slot::Free;
				0
			}
			None => Error::Slot as i32,
		}
	}

	/// Hash in one call: key at `window[..key_len]`, data at `window[key_len..key_len + len]`.
	///
	/// Uses no slot. An extendable output writes at most one window; JavaScript uses slots for more.
	pub fn oneshot(&self, id: u32, param: u32, key_len: u32, len: u32) -> i32 {
		let window = WINDOW_BYTES.borrow();
		let (key_len, len) = (key_len as usize, len as usize);
		let Some(end) = key_len.checked_add(len).filter(|end| *end <= WINDOW) else {
			return Error::Invalid as i32;
		};
		let state = {
			let (Some(key), Some(data)) = (window.get(..key_len), window.get(key_len..end)) else {
				return Error::Invalid as i32;
			};
			match F::init(id, param, key) {
				Ok(mut state) => {
					F::update(&mut state, data);
					state
				}
				Err(error) => return error as i32,
			}
		};
		match F::finish(state, window) {
			Output::Done(len) | Output::Reader(_, len) => code(len),
		}
	}
}

impl<F: Family> Default for Runtime<F> {
	fn default() -> Self {
		Self::new()
	}
}

/// Convert an index or length that is at most [`WINDOW`] into a return code.
fn code(value: usize) -> i32 {
	i32::try_from(value).unwrap_or(Error::Invalid as i32)
}

/// Write `digest` to the start of `out` and report its length.
///
/// Every digest in the workspace is at most 128 bytes, far below [`WINDOW`].
pub fn put(out: &mut [u8; WINDOW], digest: &[u8]) -> usize {
	if let Some(target) = out.get_mut(..digest.len()) {
		target.copy_from_slice(digest);
		digest.len()
	} else {
		0
	}
}

#[cfg(target_arch = "wasm32")]
#[panic_handler]
fn panic(_: &core::panic::PanicInfo<'_>) -> ! {
	// Exports never panic by design; a panic means a bug, so stop the instance rather than unwind.
	core::arch::wasm32::unreachable()
}

/// Emit the exported functions for family `$family`.
///
/// ```ignore
/// abi::export!(Sha2);
/// ```
#[macro_export]
macro_rules! export {
	($family:ty) => {
		static RUNTIME: $crate::Runtime<$family> = $crate::Runtime::new();

		/// Address of the 64 KiB window.
		#[allow(unsafe_code)]
		#[unsafe(no_mangle)]
		pub extern "C" fn window() -> *mut u8 {
			$crate::window_ptr()
		}
		/// See [`Runtime::init`]($crate::Runtime::init).
		#[allow(unsafe_code)]
		#[unsafe(no_mangle)]
		pub extern "C" fn init(id: u32, param: u32, key_len: u32) -> i32 {
			RUNTIME.init(id, param, key_len)
		}
		/// See [`Runtime::update`]($crate::Runtime::update).
		#[allow(unsafe_code)]
		#[unsafe(no_mangle)]
		pub extern "C" fn update(slot: u32, len: u32) -> i32 {
			RUNTIME.update(slot, len)
		}
		/// See [`Runtime::finish`]($crate::Runtime::finish).
		#[allow(unsafe_code)]
		#[unsafe(no_mangle)]
		pub extern "C" fn finish(slot: u32) -> i32 {
			RUNTIME.finish(slot)
		}
		/// See [`Runtime::read`]($crate::Runtime::read).
		#[allow(unsafe_code)]
		#[unsafe(no_mangle)]
		pub extern "C" fn read(slot: u32, len: u32) -> i32 {
			RUNTIME.read(slot, len)
		}
		/// See [`Runtime::fork`]($crate::Runtime::fork).
		#[allow(unsafe_code)]
		#[unsafe(no_mangle)]
		pub extern "C" fn fork(slot: u32) -> i32 {
			RUNTIME.fork(slot)
		}
		/// See [`Runtime::dispose`]($crate::Runtime::dispose).
		#[allow(unsafe_code)]
		#[unsafe(no_mangle)]
		pub extern "C" fn dispose(slot: u32) -> i32 {
			RUNTIME.dispose(slot)
		}
		/// See [`Runtime::oneshot`]($crate::Runtime::oneshot).
		#[allow(unsafe_code)]
		#[unsafe(no_mangle)]
		pub extern "C" fn oneshot(id: u32, param: u32, key_len: u32, len: u32) -> i32 {
			RUNTIME.oneshot(id, param, key_len, len)
		}
	};
}

/// Bit that selects the HMAC form of an algorithm id in a [`digests!`] family.
pub const HMAC: u32 = 0x8000;

/// Implement [`Family`] for fixed-length digests from the `digest` crate, with their HMAC forms.
///
/// `id => Variant: Type` maps an algorithm id to a hash type. `id | HMAC` selects HMAC over the same
/// hash; the key is required, and may be empty. `hmac = Hmac` uses `hmac::Hmac` (block-level, faster);
/// `hmac = SimpleHmac` works with any `Digest`, including BLAKE2. The family crate must depend on the
/// `digest` and `hmac` crates.
#[macro_export]
macro_rules! digests {
	($family:ident, hmac = $hmac:ident, { $($id:literal => $name:ident : $ty:ty),+ $(,)? }) => {
		/// The family marker type.
		pub struct $family;

		/// A plain hash state.
		#[derive(Clone)]
		pub enum Plain { $(#[doc = stringify!($ty)] $name($ty)),+ }

		/// An HMAC state.
		#[derive(Clone)]
		pub enum Keyed { $(#[doc = stringify!($ty)] $name(::hmac::$hmac<$ty>)),+ }

		/// A live state of this family.
		#[derive(Clone)]
		pub enum State {
			/// Unkeyed hash.
			Plain(Plain),
			/// HMAC.
			Keyed(Keyed),
		}

		impl $crate::Family for $family {
			type State = State;
			type Reader = core::convert::Infallible;

			fn init(id: u32, param: u32, key: &[u8]) -> Result<State, $crate::Error> {
				use ::hmac::KeyInit as _;
				if param != 0 {
					return Err($crate::Error::Invalid);
				}
				if id & $crate::HMAC == 0 {
					if !key.is_empty() {
						return Err($crate::Error::Invalid);
					}
					return match id {
						$($id => Ok(State::Plain(Plain::$name(<$ty as ::digest::Digest>::new()))),)+
						_ => Err($crate::Error::Unknown),
					};
				}
				match id & !$crate::HMAC {
					$($id => ::hmac::$hmac::<$ty>::new_from_slice(key)
						.map(|mac| State::Keyed(Keyed::$name(mac)))
						.map_err(|_| $crate::Error::Invalid),)+
					_ => Err($crate::Error::Unknown),
				}
			}

			fn update(state: &mut State, data: &[u8]) {
				match state {
					$(State::Plain(Plain::$name(hash)) => ::digest::Digest::update(hash, data),)+
					$(State::Keyed(Keyed::$name(mac)) => ::hmac::Mac::update(mac, data),)+
				}
			}

			fn finish(state: State, out: &mut [u8; $crate::WINDOW]) -> $crate::Output<Self::Reader> {
				let len = match state {
					$(State::Plain(Plain::$name(hash)) => $crate::put(out, &::digest::Digest::finalize(hash)),)+
					$(State::Keyed(Keyed::$name(mac)) => $crate::put(out, &::hmac::Mac::finalize(mac).into_bytes()),)+
				};
				$crate::Output::Done(len)
			}

			fn read(reader: &mut Self::Reader, _out: &mut [u8]) {
				match *reader {}
			}
		}
	};
}

/// Implement [`Family`] for extendable-output functions from the `digest` crate.
///
/// `id => Variant: Type, Reader, |key| init` maps an id to an XOF and its reader. `init` builds the
/// state from the key bytes; return `None` to reject a key. The output length (`param`) must be at
/// least 1. The family crate must depend on the `digest` crate.
#[macro_export]
macro_rules! xofs {
	($family:ident, { $($id:literal => $name:ident : $ty:ty, $reader:ty, |$key:ident| $init:expr),+ $(,)? }) => {
		/// The family marker type.
		pub struct $family;

		/// A live XOF state and the output length requested at `init`.
		#[derive(Clone)]
		pub struct State {
			hash: Hash,
			len: u32,
		}

		/// The absorbing state.
		#[derive(Clone)]
		pub enum Hash { $(#[doc = stringify!($ty)] $name($ty)),+ }

		/// The squeezing state.
		#[derive(Clone)]
		pub enum Reader { $(#[doc = stringify!($reader)] $name($reader)),+ }

		impl $crate::Family for $family {
			type State = State;
			type Reader = Reader;

			fn init(id: u32, param: u32, key: &[u8]) -> Result<State, $crate::Error> {
				if param == 0 {
					return Err($crate::Error::Invalid);
				}
				let hash = match id {
					$($id => {
						let $key = key;
						let state: Option<$ty> = $init;
						Hash::$name(state.ok_or($crate::Error::Invalid)?)
					})+
					_ => return Err($crate::Error::Unknown),
				};
				Ok(State { hash, len: param })
			}

			fn update(state: &mut State, data: &[u8]) {
				match &mut state.hash {
					$(Hash::$name(hash) => ::digest::Update::update(hash, data),)+
				}
			}

			fn finish(state: State, out: &mut [u8; $crate::WINDOW]) -> $crate::Output<Reader> {
				let mut reader = match state.hash {
					$(Hash::$name(hash) => Reader::$name(::digest::ExtendableOutput::finalize_xof(hash)),)+
				};
				let total = state.len as usize;
				let first = total.min($crate::WINDOW);
				if let Some(target) = out.get_mut(..first) {
					Self::read(&mut reader, target);
				}
				if total > first { $crate::Output::Reader(reader, first) } else { $crate::Output::Done(first) }
			}

			fn read(reader: &mut Reader, out: &mut [u8]) {
				match reader {
					$(Reader::$name(reader) => ::digest::XofReader::read(reader, out),)+
				}
			}
		}
	};
}

/// Implement [`Family`] for a family made of two families, chosen by id.
///
/// Ids for which `$pick(id)` is true go to `$left`, the others to `$right`.
#[macro_export]
macro_rules! join {
	($family:ident = $left:ty | $right:ty, $pick:expr) => {
		/// The family marker type.
		pub struct $family;

		/// A state of either part.
		#[derive(Clone)]
		pub enum State {
			/// From the first part.
			Left(<$left as $crate::Family>::State),
			/// From the second part.
			Right(<$right as $crate::Family>::State),
		}

		/// A reader of either part.
		#[derive(Clone)]
		pub enum Reader {
			/// From the first part.
			Left(<$left as $crate::Family>::Reader),
			/// From the second part.
			Right(<$right as $crate::Family>::Reader),
		}

		impl $crate::Family for $family {
			type State = State;
			type Reader = Reader;

			fn init(id: u32, param: u32, key: &[u8]) -> Result<State, $crate::Error> {
				let pick: fn(u32) -> bool = $pick;
				if pick(id) {
					<$left as $crate::Family>::init(id, param, key).map(State::Left)
				} else {
					<$right as $crate::Family>::init(id, param, key).map(State::Right)
				}
			}

			fn update(state: &mut State, data: &[u8]) {
				match state {
					State::Left(state) => <$left as $crate::Family>::update(state, data),
					State::Right(state) => <$right as $crate::Family>::update(state, data),
				}
			}

			fn finish(state: State, out: &mut [u8; $crate::WINDOW]) -> $crate::Output<Reader> {
				match state {
					State::Left(state) => match <$left as $crate::Family>::finish(state, out) {
						$crate::Output::Done(len) => $crate::Output::Done(len),
						$crate::Output::Reader(reader, len) => $crate::Output::Reader(Reader::Left(reader), len),
					},
					State::Right(state) => match <$right as $crate::Family>::finish(state, out) {
						$crate::Output::Done(len) => $crate::Output::Done(len),
						$crate::Output::Reader(reader, len) => $crate::Output::Reader(Reader::Right(reader), len),
					},
				}
			}

			fn read(reader: &mut Reader, out: &mut [u8]) {
				match reader {
					Reader::Left(reader) => <$left as $crate::Family>::read(reader, out),
					Reader::Right(reader) => <$right as $crate::Family>::read(reader, out),
				}
			}
		}
	};
}

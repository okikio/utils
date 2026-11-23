//! Legacy family: MD2, MD4, MD5, SHA-1, RIPEMD-128/160/256/320, Tiger and Tiger2, HMAC-MD5, HMAC-SHA1
//! and HMAC-RIPEMD160, and SHA-1 with collision detection.
//!
//! These algorithms are broken or weak for collision resistance; they exist to read old data and speak
//! old protocols. Id 16 is SHA-1 with the `sha1-checked` detector: when the input carries a known
//! collision attack, `finish` writes no bytes, and JavaScript reports the attack instead of a digest.
#![no_std]

/// Digests with a published HMAC use (HMAC-MD5, HMAC-SHA1, HMAC-RIPEMD160).
pub mod keyed {
	abi::digests!(Macs, hmac = Hmac, {
		3 => Md5: md5::Md5,
		4 => Sha1: sha1::Sha1,
		6 => Ripemd160: ripemd::Ripemd160,
	});
}

/// Digests without HMAC forms, which would double the module for no published use.
pub mod plain {
	abi::plain_digests!(Plain, {
		1 => Md2: md2::Md2,
		2 => Md4: md4::Md4,
		5 => Ripemd128: ripemd::Ripemd128,
		7 => Ripemd256: ripemd::Ripemd256,
		8 => Ripemd320: ripemd::Ripemd320,
		9 => Tiger: tiger::Tiger,
		10 => Tiger2: tiger::Tiger2,
	});
}

/// Every fixed-length digest.
pub mod fixed {
	abi::join!(Fixed = super::keyed::Macs | super::plain::Plain, |id| matches!(id & !abi::HMAC, 3 | 4 | 6));
}

/// SHA-1 with collision detection.
pub mod checked {
	use abi::{Error, Family, Output, WINDOW, put};
	use sha1_checked::{CollisionResult, Sha1};

	/// The family marker type.
	pub struct Checked;

	impl Family for Checked {
		type State = Sha1;
		type Reader = core::convert::Infallible;

		fn init(id: u32, param: u32, key: &[u8]) -> Result<Sha1, Error> {
			match (id, param, key.is_empty()) {
				(16, 0, true) => Ok(Sha1::new()),
				(16, _, _) => Err(Error::Invalid),
				_ => Err(Error::Unknown),
			}
		}

		fn update(state: &mut Sha1, data: &[u8]) {
			digest::Update::update(state, data);
		}

		fn finish(state: Sha1, out: &mut [u8; WINDOW]) -> Output<Self::Reader> {
			match state.try_finalize() {
				CollisionResult::Ok(hash) => Output::Done(put(out, &hash)),
				// Both other results mean the input carries a collision attack.
				CollisionResult::Mitigated(_) | CollisionResult::Collision(_) => Output::Done(0),
			}
		}

		fn read(reader: &mut Self::Reader, _out: &mut [u8]) {
			match *reader {}
		}

		fn fork(state: &Sha1) -> Option<Sha1> {
			Some(state.clone())
		}
	}
}

abi::join!(Legacy = fixed::Fixed | checked::Checked, |id| id != 16);

abi::export!(Legacy);

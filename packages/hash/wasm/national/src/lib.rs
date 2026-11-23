//! National family: Streebog (GOST R 34.11-2012), GOST R 34.11-94 with each published parameter set,
//! SM3, Kupyna, BelT hash, bash-hash and Ascon-Hash256, HMAC where the standard defines it, and the
//! Ascon-XOF128 extendable output.
//!
//! Ids below 32 are fixed-length digests; add `abi::HMAC` for HMAC over Streebog, GOST94, SM3 or BelT.
//! Id 32 is Ascon-XOF128, whose `param` is the output length in bytes.
#![no_std]

/// Digests whose standards define HMAC (Streebog in RFC 7836, GOST94 in RFC 4357, SM3 in GB/T 15852,
/// BelT in STB 34.101.47).
pub mod keyed {
	abi::digests!(Macs, hmac = SimpleHmac, {
		1 => Streebog256: streebog::Streebog256,
		2 => Streebog512: streebog::Streebog512,
		3 => Gost94CryptoPro: gost94::Gost94CryptoPro,
		4 => Gost94Test: gost94::Gost94Test,
		5 => Gost94UA: gost94::Gost94UA,
		6 => Gost94s2015: gost94::Gost94s2015,
		7 => Sm3: sm3::Sm3,
		12 => Belt: belt_hash::BeltHash,
	});
}

/// Digests without HMAC forms.
pub mod plain {
	abi::plain_digests!(Plain, {
		8 => Kupyna224: kupyna::Kupyna224,
		9 => Kupyna256: kupyna::Kupyna256,
		10 => Kupyna384: kupyna::Kupyna384,
		11 => Kupyna512: kupyna::Kupyna512,
		13 => Bash256: bash_hash::BashHash256,
		14 => Bash384: bash_hash::BashHash384,
		15 => Bash512: bash_hash::BashHash512,
		16 => Ascon256: ascon_hash::AsconHash256,
	});
}

/// Every fixed-length digest.
pub mod fixed {
	abi::join!(Fixed = super::keyed::Macs | super::plain::Plain, |id| matches!(id & !abi::HMAC, 1..=7 | 12));
}

/// Extendable-output functions.
pub mod xof {
	abi::xofs!(Xof, {
		32 => Ascon128: ascon_hash::AsconXof128, ascon_hash::AsconXof128Reader,
			|key| key.is_empty().then(Default::default),
	});
}

abi::join!(National = fixed::Fixed | xof::Xof, |id| id & !abi::HMAC < 32);

abi::export!(National);

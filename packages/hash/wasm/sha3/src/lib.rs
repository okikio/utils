//! SHA-3 family: SHA3-224 … SHA3-512 and Keccak-224 … Keccak-512 (plain and HMAC), SHAKE, cSHAKE,
//! TurboSHAKE and KangarooTwelve.
//!
//! Ids below 16 are fixed-length digests; add `abi::HMAC` for HMAC. Ids from 16 are extendable-output
//! functions; `param` is the output length in bytes. For cSHAKE the key bytes are the customization
//! string and the function name is empty. TurboSHAKE uses the default domain byte 0x1F, and
//! KangarooTwelve uses an empty customization string, because the crates fix those at compile time
//! or need an allocator.
#![no_std]

/// Fixed-length digests.
pub mod fixed {
	abi::digests!(Fixed, hmac = SimpleHmac, {
		1 => Sha3_224: sha3::Sha3_224,
		2 => Sha3_256: sha3::Sha3_256,
		3 => Sha3_384: sha3::Sha3_384,
		4 => Sha3_512: sha3::Sha3_512,
		5 => Keccak224: sha3::Keccak224,
		6 => Keccak256: sha3::Keccak256,
		7 => Keccak384: sha3::Keccak384,
		8 => Keccak512: sha3::Keccak512,
	});
}

/// Extendable-output functions.
pub mod xof {
	abi::xofs!(Xof, {
		16 => Shake128: shake::Shake128, shake::Shake128Reader, |key| key.is_empty().then(Default::default),
		17 => Shake256: shake::Shake256, shake::Shake256Reader, |key| key.is_empty().then(Default::default),
		18 => CShake128: cshake::CShake128, cshake::CShake128Reader,
			|key| Some(cshake::CShake128::new_with_function_name(&[], key)),
		19 => CShake256: cshake::CShake256, cshake::CShake256Reader,
			|key| Some(cshake::CShake256::new_with_function_name(&[], key)),
		20 => TurboShake128: turboshake::TurboShake128, turboshake::TurboShake128Reader,
			|key| key.is_empty().then(Default::default),
		21 => TurboShake256: turboshake::TurboShake256, turboshake::TurboShake256Reader,
			|key| key.is_empty().then(Default::default),
		22 => Kt128: k12::Kt128, k12::Kt128Reader, |key| key.is_empty().then(Default::default),
		23 => Kt256: k12::Kt256, k12::Kt256Reader, |key| key.is_empty().then(Default::default),
	});
}

abi::join!(Sha3 = fixed::Fixed | xof::Xof, |id| id & !abi::HMAC < 16);

abi::export!(Sha3);

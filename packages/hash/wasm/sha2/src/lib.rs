//! SHA-2 family: SHA-224, SHA-256, SHA-384, SHA-512, SHA-512/224 and SHA-512/256, plain and HMAC.
//!
//! Ids match `packages/hash/_wasm/registry.ts`. Add `abi::HMAC` to an id for its HMAC form.
#![no_std]

abi::digests!(Sha2, hmac = Hmac, {
	1 => Sha224: sha2::Sha224,
	2 => Sha256: sha2::Sha256,
	3 => Sha384: sha2::Sha384,
	4 => Sha512: sha2::Sha512,
	5 => Sha512_224: sha2::Sha512_224,
	6 => Sha512_256: sha2::Sha512_256,
});

abi::export!(Sha2);

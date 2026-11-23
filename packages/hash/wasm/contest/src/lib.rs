//! Contest family: SHA-3 competition finalists and candidates (Grøstl, JH, Skein, Shabal) and Whirlpool.
//! None of them has a published HMAC use, so the module leaves HMAC out. FSB is its own family because
//! its 272 KB table would quadruple this module.
//!
//! Skein names give the state size, then the output size: `Skein512_256` runs the 512-bit state and
//! returns 256 bits.
#![no_std]

abi::plain_digests!(Contest, {
	1 => Groestl224: groestl::Groestl224,
	2 => Groestl256: groestl::Groestl256,
	3 => Groestl384: groestl::Groestl384,
	4 => Groestl512: groestl::Groestl512,
	5 => Jh224: jh::Jh224,
	6 => Jh256: jh::Jh256,
	7 => Jh384: jh::Jh384,
	8 => Jh512: jh::Jh512,
	9 => Skein256_256: skein::Skein256_256,
	10 => Skein256_512: skein::Skein256_512,
	11 => Skein512_256: skein::Skein512_256,
	12 => Skein512_512: skein::Skein512_512,
	13 => Skein1024_256: skein::Skein1024_256,
	14 => Skein1024_512: skein::Skein1024_512,
	15 => Skein1024_1024: skein::Skein1024_1024,
	16 => Shabal192: shabal::Shabal192,
	17 => Shabal224: shabal::Shabal224,
	18 => Shabal256: shabal::Shabal256,
	19 => Shabal384: shabal::Shabal384,
	20 => Shabal512: shabal::Shabal512,
	21 => Whirlpool: whirlpool::Whirlpool,
});

abi::export!(Contest);

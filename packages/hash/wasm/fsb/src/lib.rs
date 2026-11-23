//! FSB family: the fast syndrome-based hash at 160, 224, 256, 384 and 512 bits.
//!
//! FSB is a SHA-3 competition candidate whose security reduces to a decoding problem. Its constant
//! table holds 272 KB of digits of π, so it lives apart from the other contest designs.
#![no_std]

abi::plain_digests!(Fsb, {
	1 => Fsb160: fsb::Fsb160,
	2 => Fsb224: fsb::Fsb224,
	3 => Fsb256: fsb::Fsb256,
	4 => Fsb384: fsb::Fsb384,
	5 => Fsb512: fsb::Fsb512,
});

abi::export!(Fsb);

# Algorithms, families and crates

Status: proposed. Read [Backends](01-backends.md) first.

The package groups algorithms into **families**. A family is one WASM module and one entry point. You load and pay for
only the families you import. The list comes from Wikipedia's
[list of hash functions](https://en.wikipedia.org/wiki/List_of_hash_functions), filtered by one rule: an algorithm is
included when a maintained, `no_std` Rust crate implements it and has published test vectors. "Maintained" means a
release in the last two years or an owner organization that still ships releases (RustCrypto, the BLAKE3 team).

Columns: **native** is `node:crypto` (OpenSSL 3 default provider), **web** is Web Crypto, **portable** is pure
JavaScript. Every algorithm in this page is available through **packed** and **wasm**.

## sha2

| Algorithm                                   | Crate  | native | web            | portable |
| ------------------------------------------- | ------ | ------ | -------------- | -------- |
| SHA-224, SHA-256, SHA-384, SHA-512          | `sha2` | yes    | SHA-224 no     | yes      |
| SHA-512/224, SHA-512/256                    | `sha2` | yes    | no             | yes      |

## sha3

| Algorithm                                            | Crate  | native            | web | portable |
| ---------------------------------------------------- | ------ | ----------------- | --- | -------- |
| SHA3-224, SHA3-256, SHA3-384, SHA3-512               | `sha3` | yes               | no  | yes      |
| Keccak-224, -256, -384, -512 (pre-standard padding)  | `sha3` | no                | no  | yes      |
| SHAKE128, SHAKE256 (variable output)                 | `sha3` | yes               | no  | yes      |
| cSHAKE128, cSHAKE256                                 | `sha3` | no                | no  | yes      |
| TurboSHAKE128, TurboSHAKE256                         | `sha3` | no                | no  | yes      |
| KangarooTwelve (KT128)                               | `k12`  | no                | no  | yes      |
| KMAC128, KMAC256 (key required)                      | `cshake` | no              | no  | yes      |

No maintained Rust crate implements KMAC. NIST SP 800-185 defines it as cSHAKE with the function name `KMAC` and two
encoded fields, so the `sha3` module builds it on RustCrypto's `cshake` in 60 lines (`wasm/sha3/src/kmac.rs`). It
matches the NIST sample vectors and `@noble/hashes`. The customization string is empty.

## blake

| Algorithm                                         | Crate    | native              | web | portable |
| ------------------------------------------------- | -------- | ------------------- | --- | -------- |
| BLAKE2b, BLAKE2s (any output length, keyed, salt) | `blake2` | 512 and 256 only    | no  | yes      |
| BLAKE3 (hash, keyed, derive key, any output)      | `blake3` | no                  | no  | yes      |

The `blake3` crate has a WASM SIMD path (`wasm32_simd` feature). It roughly halves the time per KiB.

## legacy

These algorithms are broken or weak for collision resistance. Use them only to read existing data or speak an existing
protocol.

| Algorithm                                 | Crate          | native        | web   | portable |
| ----------------------------------------- | -------------- | ------------- | ----- | -------- |
| MD2, MD4                                  | `md2`, `md4`   | no            | no    | no       |
| MD5                                       | `md-5`         | yes           | no    | yes      |
| SHA-1                                     | `sha1`         | yes           | yes   | yes      |
| SHA-1 with collision detection            | `sha1-checked` | no            | no    | no       |

HMAC is built for MD5, SHA-1 and RIPEMD-160 only, which are the legacy HMACs that protocols still use. HMAC for the
others would double the module for no published use. `sha1-checked` runs the SHA-1 collision detector from Marc
Stevens and Dan Shumow. On a published attack such as SHA-mbles it returns an error instead of a digest. The crate is
at a release candidate (0.11.0-rc.0).
| RIPEMD-128, -160, -256, -320              | `ripemd`       | RIPEMD-160    | no    | RIPEMD-160 |
| Tiger, Tiger2                             | `tiger`        | no            | no    | no       |

## national

Standards from national bodies. Some regulated systems require them.

| Algorithm                                     | Standard              | Crate       |
| --------------------------------------------- | --------------------- | ----------- |
| Streebog-256, Streebog-512                    | GOST R 34.11-2012     | `streebog`  |
| GOST R 34.11-94                               | GOST R 34.11-94       | `gost94`    |
| SM3                                           | GM/T 0004-2012        | `sm3`       |
| Kupyna-256, Kupyna-512                        | DSTU 7564:2014        | `kupyna`    |
| BelT hash                                     | STB 34.101.31-2020    | `belt-hash` |
| bash-hash                                     | STB 34.101.77-2020    | `bash-hash` |
| Ascon-Hash256, Ascon-XOF128                   | NIST SP 800-232       | `ascon-hash`|

`node:crypto` has SM3 when OpenSSL is built with it (Node.js and Deno, not Bun). No other column applies. HMAC is built
where the standard defines it: Streebog (RFC 7836), GOST R 34.11-94 (RFC 4357), SM3 and BelT. Kupyna-224 and the UA
and 2015 parameter sets of GOST R 34.11-94 have no published vector in their crates. The tests check them only for
agreement between one-shot and incremental use.

## contest

Finalists and candidates of the SHA-3 competition, and other published designs.

| Algorithm                                     | Crate       |
| --------------------------------------------- | ----------- |
| Grøstl-224 … Grøstl-512                       | `groestl`   |
| JH-224 … JH-512                               | `jh`        |
| Skein-256, Skein-512, Skein-1024              | `skein`     |
| Shabal-192 … Shabal-512                       | `shabal`    |
| Whirlpool                                     | `whirlpool` |

These have no native, web, portable or HMAC implementation.

## fsb

| Algorithm                                     | Crate       |
| --------------------------------------------- | ----------- |
| FSB-160, -224, -256, -384, -512               | `fsb`       |

FSB is a SHA-3 candidate whose security reduces to a decoding problem. Its constant table is 272 KB of digits of π,
which does not compress, so it has its own module (388 KB packed) instead of tripling the `contest` module.

## mac

Keyed hashes for hash tables and short-input authentication, where an attacker must not be able to choose collisions.
The key is required: 16 bytes for SipHash, 32 bytes for HighwayHash. Outputs are the little-endian bytes of the result
words, the byte order of the reference test vectors.

| Algorithm                                   | Crate       |
| ------------------------------------------- | ----------- |
| SipHash-2-4, SipHash-1-3 (64 and 128 bits)  | `siphasher` |
| HighwayHash (64, 128 and 256 bits)          | `highway`   |

HighwayHash uses the crate's WASM SIMD path. HMAC for a hash lives in that hash's own family, so
`import '@okikio/hash/sha3'` gives HMAC-SHA3 without loading `mac`. Families build HMAC where a standard or
protocol uses it, as each section says. Native HMAC (`node:crypto`) covers SHA-1, SHA-2, SHA-3 and MD5; Web Crypto
covers SHA-1 and SHA-2.

## fast

Non-cryptographic hashes for hash tables, deduplication and sharding. Do not use them where an attacker picks the
input. The key is an optional little-endian seed: 4 bytes for XXH32, 8 for XXH64 and XXH3, 32 (four 64-bit words) for
SeaHash. Outputs are big-endian, the canonical byte form of xxHash and the way these numbers are usually printed.

| Algorithm                                     | Crate         | Notes                                                |
| --------------------------------------------- | ------------- | ---------------------------------------------------- |
| XXH32, XXH64, XXH3-64, XXH3-128               | `xxhash-rust` | Seeded                                               |
| rapidhash v3 (64 bits)                        | `rapidhash`   | Default secrets; a state cannot be forked            |
| SeaHash                                       | `seahash`     | Seeded with four words                               |
| FNV-1a (64 bits)                              | `fnv`         | The `fnv` crate has only FNV-1a 64                   |

rapidhash is the current version 3 of the reference algorithm. Bun's `Bun.hash.rapidhash` is version 1 with seed 0, so
the two give different values for the same input. `portable` has FNV-1a 32 only (already in the package). The rest
are WASM only.

## checksum

| Algorithm                                          | Crate       | native        | portable        |
| -------------------------------------------------- | ----------- | ------------- | --------------- |
| Every CRC in the RevEng catalogue (113, CRC-3 … CRC-82) | `crc`  | CRC-32 (zlib) | CRC-32, CRC-32C |
| CRC-32/ISO-HDLC (zlib, PNG, Ethernet) fast path    | `crc32fast` | zlib          | yes             |
| Adler-32                                           | `adler2`    | no            | no              |
| Fletcher-16                                        | `fletcher`  | no            | no              |

The checksum entry point takes a catalogue name, such as `'CRC-16/ARC'` or `'CRC-64/NVME'`. Names match the
[RevEng catalogue](https://reveng.sourceforge.io/crc-catalogue/all.htm) exactly. The build generates the list from the
`crc-catalog` crate. Thirteen widely used CRCs (CRC-8/SMBUS, the common CRC-16s, CRC-32/ISCSI, BZIP2, CKSUM, MPEG-2,
and CRC-64/ECMA-182, NVME and XZ) use a 256-entry table. The others compute bit by bit, which is slower but keeps the
module at 48 KB. Outputs are big-endian, in the fewest whole bytes that hold the width, so the hex matches the
catalogue's check values.

## Not included, and why

| Algorithm or group                                   | Reason                                                       |
| ---------------------------------------------------- | ------------------------------------------------------------ |
| MD6, HAVAL, Snefru, HAS-160, RadioGatún, LSH, ECOH, SWIFFT, Hamsi, Luffa, SHAvite-3, Fugue, ECHO, SIMD | No maintained pure Rust `no_std` crate. MD6's crate wraps C. |
| CubeHash                                             | The `cubehash` crate returns a heap `Vec` and needs an allocator. |
| GxHash, aHash, foldhash                              | Output depends on CPU features or crate version. Not portable across hosts. |
| FarmHash                                             | The crate has had no release since 2016.                     |
| t1ha                                                 | The crate is at 0.1 with few users. Reconsider if a protocol needs it. |
| komihash                                             | Crate is new (2026) and has very few users. Reconsider later. |
| CMAC, PMAC                                           | These are MACs over a block cipher. They belong in a cipher package. |
| Poly1305, POLYVAL, GHASH                             | One-time-key universal hashes that are safe only inside an AEAD construction. They belong in a cipher package. |
| wyhash                                               | The crate's streaming hasher restarts at every `write`, so incremental results differ from one-shot ones. rapidhash is its successor. |
| MurmurHash3, MetroHash                               | Their crates need the Rust standard library (`std::io`, `std::hash`), not `no_std`. |
| CityHash                                             | The `cityhasher` crate hashes in one call only, which a 64 KiB window cannot stream. FarmHash replaced it upstream. |
| Fletcher-32, Fletcher-64                             | Defined over 16- and 32-bit words, so the byte order and odd-length padding depend on the protocol. |
| FNV-1, FNV-1a 32 in WASM                             | The `fnv` crate has only FNV-1a 64. |
| Luhn, Verhoeff, Damm                                 | Check digits for decimal strings, not hashes of bytes.       |
| BSD sum, SYSV sum, sum8/24/32, xor8, Internet checksum, Pearson | No maintained crate. Each is a few lines; open an issue if you need one. |
| Rabin fingerprint, Buzhash, Zobrist, tabulation      | Families that need a caller-chosen table or polynomial, or rolling-window APIs. A content-defined chunking package is a better home. |

If you need one of these, open an issue with the protocol or file format that requires it.

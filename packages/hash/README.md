# Hash

An import receipt needs to identify its dataset and content. SHA-256 gives the exact source bytes a full fingerprint,
called a digest. `id()` derives a compact correlation key from the dataset ID and that digest. Reimporting identical bytes
for the same dataset produces the same key. Keep a separate operation ID when each attempt must be distinct. Neither
kind of ID grants permission to access the data.

For Deno, Node, and Bun execution, see [run a portable example](../../docs/05-runtime.md#run-a-portable-example-in-your-own-project). Host-specific adapters keep their native runtime requirements.

From a checkout of this experimental workspace, run `mise trust`, `mise install`, then `mise run prepare -- --kind deps` at the repository root. Save the following program as `example.ts` and run `mise exec -- deno run example.ts`. These commands use the workspace export maps; they do not assume a published registry version.

```ts runnable
import { id, sha256 } from '@okikio/hash';
import { random } from '@okikio/hash/id';

const source = 'Name\nAda\n';
// Hash the exact UTF-8 content, including newlines, for later integrity comparison.
const digest = await sha256(source);
// Derive a compact correlation key separately; retain the full digest for integrity checks.
const key = await id('import', ['dataset-42', digest]);
console.log(digest.length, key.startsWith('import-'));
// Content identity repeats; attempt identity is chosen independently for each invocation.
const repeated = await id('import', ['dataset-42', digest]);
const attempt = random();
console.log(key === repeated, attempt.length);
```

The digest has 64 hexadecimal characters (256 bits). The first line also confirms the correlation prefix. The second
shows that the same dataset/content tuple repeats its key, while the independent attempt ID contains 21 random
characters. Random IDs can collide; a persistent attempt table still needs a unique constraint. Compare full digests to
detect changed content, and keep the source or expected digest in a trusted location when checking integrity.

Expected output:

```text output
64 true
true 21
```

The digest is useful only in a comparison. If you keep a trusted digest from an earlier import, the same digest later
indicates that the content is unchanged, subject to the algorithm's collision risk. If an attacker can replace both the file and its expected
digest, an ordinary hash does not authenticate the file. An **HMAC** is a keyed message authentication code. It checks possession of a shared secret; neither a
hash nor an HMAC hides the original content as encryption would.

## Hash the selected bytes, not the whole backing buffer

An uploaded file can be a view into a larger buffer. Hashing its backing buffer would accidentally include bytes outside
the selected input. The utility reads only the visible view, and it reads it before `sha256()` returns, so a caller can
reuse its buffer right away.

Save this complete variation as `hash-view.ts` and run `mise exec -- deno run hash-view.ts` after the same checkout setup.

```ts runnable=hash-view.ts
import { sha256 } from '@okikio/hash';

const buffer = new Uint8Array([9, 65, 66, 9]);
const selected = buffer.subarray(1, 3);
const pending = sha256(selected);
selected.fill(0);
console.log(await pending === await sha256('AB'));
console.log(await sha256(buffer) === await sha256('AB'));
```

```text output
true
false
```

The first comparison confirms that the admitted bytes were A and B. The second compares a different four-byte input.
It is not an incremental hashing API; use `@okikio/hash/sync` or `@okikio/hash/stream` for that.

## Which implementation runs

Deno, Node and Bun have a built-in SHA-2 in `node:crypto`. The package finds it at run time through
`process.getBuiltinModule()` and uses it for the root, `digest` and `sync` paths, so these cost about the same as calling
`node:crypto` yourself. It never imports `node:crypto`, so a browser bundle does not pull in a Node polyfill. Where the
host has no built-in hash, such as a browser, the async paths use Web Crypto and the sync paths use Noble's JavaScript.
All paths return the same bytes, as plain `Uint8Array` values.

## Hash with other algorithms

Each algorithm family has its own entry point and its own WebAssembly (WASM) module, built from maintained Rust crates:
SHA-2, SHA-3, BLAKE, legacy, national standards, SHA-3 contest designs, FSB, keyed MACs, fast non-cryptographic hashes
and checksums. An import loads only that family. Calls are synchronous; the module loads on first use, or when you
await `ready()`.

Save this as `families.ts` and run `mise exec -- deno run families.ts`.

```ts runnable=families.ts
import { hash, ready } from '@okikio/hash/sha3';
import { hex } from '@okikio/hash/hex';

await ready();
console.log(hex(hash('shake128', 'abc', { length: 8 })));
console.log(hex(hash('sha3-256', 'abc', { key: new TextEncoder().encode('key') })).length);
```

```text output
5881092dd818bf5c
64
```

The first line is the first 8 bytes of SHAKE128 of `abc`; `length` sets the output size of extendable outputs. The
second is an HMAC-SHA3-256 tag, selected by `key`. Before `ready()` resolves, a call runs on `node:crypto` or pure
JavaScript where one of them has the algorithm, and throws `NotReadyError` otherwise. Every backend returns the same
bytes. In Deno, Node and Bun, SHA-1 and SHA-2 inputs of 512 bytes or more always run on `node:crypto`, which uses the
CPU's SHA instructions.

Append a suffix such as `/wasm` or `/portable` to pin one backend; see [Pin one backend](#pin-one-backend). The
[hash design](../../docs/hash/README.md) explains the backends, the full algorithm list and the measurements.

Use `hex()` when bytes already exist and only representation is needed. It does not hash or authenticate them. Use
`id()` for compact correlation from an ordered tuple, and retain the full `sha256()` digest when checking content
integrity.

## Use the expanded capabilities

The [capabilities guide](./capabilities.md) contains complete examples and the output, ownership, limits, cancellation,
UUID ordering and dependency contracts for every Hash submodule.

## Choose integrity, authentication, or identity

An import can hash exact input bytes for an integrity receipt and derive a compact correlation ID from a dataset ID plus
that digest. These serve different purposes.

Use sha256 for full-byte integrity and id for compact ordered-tuple correlation. Use Hash HMAC for byte-level
authentication, or HTTP Signature for its string-secret and canonical hex wire contract.

Compact IDs retain 128 digest bits and are not guaranteed unique. Use a unique database constraint for persisted
identity, and do not use a hash as authorization.

## Choose an entry point

Use the table to find a focused import for the job you need. Contract links open the exact public source, including its
options and types.

| Import                   | Use it to                                                                            | Exact contract             |
| ------------------------ | ------------------------------------------------------------------------------------ | -------------------------- |
| `@okikio/hash`           | Use the package entry shown in the complete examples above.                          | [Contract](./mod.ts)       |
| `@okikio/hash/digest`    | Hash complete text or visible bytes with native asynchronous SHA-2.                  | [Contract](./digest.ts)    |
| `@okikio/hash/sync`      | Hash with synchronous or incremental SHA-2; finalize or destroy each state.          | [Contract](./sync.ts)      |
| `@okikio/hash/stream`    | Hash a byte stream with explicit cancellation, byte limits, and hasher ownership.    | [Contract](./stream.ts)    |
| `@okikio/hash/encoding`  | Encode digest bytes or decode strict canonical hex, Base64, and Base64url.           | [Contract](./encoding.ts)  |
| `@okikio/hash/base64`    | Encode or decode strict Base64 and Base64url only, with the host's native codec.     | [Contract](./base64.ts)    |
| `@okikio/hash/hex`       | Encode or decode strict lower-case hexadecimal only, with the host's native codec.   | [Contract](./hex.ts)       |
| `@okikio/hash/random`    | Allocate secure random bytes or choose unbiased integers.                            | [Contract](./random.ts)    |
| `@okikio/hash/id`        | Create secure random IDs or derive stable IDs from an ordered tuple.                 | [Contract](./id.ts)        |
| `@okikio/hash/uuid`      | Create UUIDv4 or UUIDv7 and validate, parse, format, or inspect UUID values.         | [Contract](./uuid.ts)      |
| `@okikio/hash/sha2`      | Use every SHA-2 variant, plain or HMAC, on WASM or `node:crypto`.                    | [Contract](./sha2.ts)      |
| `@okikio/hash/sha3`      | Use SHA-3, Keccak, SHAKE, cSHAKE, TurboSHAKE, KangarooTwelve and KMAC, with HMAC.    | [Contract](./sha3.ts)      |
| `@okikio/hash/blake`     | Use BLAKE2b, BLAKE2s and BLAKE3, keyed or with any BLAKE3 output length.             | [Contract](./blake.ts)     |
| `@okikio/hash/legacy`    | Read old data with MD2–MD5, SHA-1 (also collision-checked), RIPEMD or Tiger.         | [Contract](./legacy.ts)    |
| `@okikio/hash/national`  | Use Streebog, GOST R 34.11-94, SM3, Kupyna, BelT, bash-hash or Ascon.                | [Contract](./national.ts)  |
| `@okikio/hash/contest`   | Use Grøstl, JH, Skein, Shabal or Whirlpool.                                          | [Contract](./contest.ts)   |
| `@okikio/hash/fsb`       | Use FSB; its module is 322 KB.                                                       | [Contract](./fsb.ts)       |
| `@okikio/hash/mac`       | Key hash-table and short-input hashes with SipHash or HighwayHash.                   | [Contract](./mac.ts)       |
| `@okikio/hash/fast`      | Hash trusted data quickly with xxHash, rapidhash, SeaHash or FNV-1a.                 | [Contract](./fast.ts)      |
| `@okikio/hash/checksum`  | Detect accidental corruption with any RevEng CRC, Adler-32 or Fletcher-16.           | [Contract](./checksum.ts)  |
| `@okikio/hash/hmac`      | Sign and verify complete message tags using native HMAC-SHA-2 and owned keys.        | [Contract](./hmac/mod.ts)  |
| `@okikio/hash/hmac/sync` | Use synchronous HMAC-SHA-2; destroy reusable copied keys when finished.              | [Contract](./hmac/sync.ts) |

## Pin one backend

The family paths above choose a backend for each call. A suffix pins one backend instead, and nothing falls back. Use it
to test one implementation, to audit what runs, or to keep a bundle small.

| Suffix      | Runs on                                                                                     | `ready()`                            |
| ----------- | ------------------------------------------------------------------------------------------- | ------------------------------------ |
| `/wasm`     | WASM, from a module you pass or the `.wasm` file shipped beside the module.                 | Loads and compiles the module.       |
| `/packed`   | WASM, from a copy embedded in the JavaScript as compressed Base64. No file fetch.           | Decodes and compiles the copy.       |
| `/static`   | WASM, from a compiled module you import. No dynamic import, no fetch, no runtime compile.   | Attaches the module you pass.        |
| `/native`   | `node:crypto` only (`zlib.crc32` for checksums). Throws `UnsupportedError` in a browser or for an algorithm it lacks. | Resolves at once.                    |
| `/portable` | Pure JavaScript only. Runs where WASM is refused, as under a strict Content Security Policy. | Resolves at once.                    |
| `/web`      | Web Crypto only. Asynchronous, with no incremental state.                                   | Not needed.                          |
| `/shared`   | A pool of workers, each with the family's WASM module, for many inputs at once.             | Each worker loads its own module.    |

Before `ready()` resolves, the `/wasm` and `/packed` paths throw `NotReadyError`. Pass `/wasm` the module in the form you
already have: the exports of a WASM ESM import, a `WebAssembly.Module` from `import source`, an instance, a `Response`,
bytes or a URL.

The `/packed` copy is deflate-compressed and stored as Base64 text, which `DecompressionStream` turns back into the
module. Base64 rather than Ascii85 (Z85) is deliberate. Z85 text is 6% shorter, but only when the server sends the
JavaScript uncompressed: after gzip or Brotli both encodings are the same size. Every runtime also decodes Base64 with
its own native code (`Uint8Array.fromBase64` or `atob`), while Z85 needs a decoder written in JavaScript, about 25 times
slower on the first load (0.02 ms against 0.53 ms for a 145 KB module). When size matters most, serve the raw `.wasm`
file with Brotli through `/wasm` or `/static`: it is 20% smaller than either packed form. The measurements are in
[docs/hash/04-measurements.md](../../docs/hash/04-measurements.md#packed-versus-raw-wasm).

`/static` is for hosts that allow only statically analyzable imports and refuse to compile WebAssembly at runtime,
such as Cloudflare Workers. It is never the default; you choose it. Import the raw `.wasm` file with your bundler and
pass it to `ready()`. Wrangler and the Cloudflare Vite plugin turn a default `.wasm` import into a `WebAssembly.Module`:

```ts ignore
import wasm from '@okikio/hash/wasm/sha2.wasm';
import { hash, ready } from '@okikio/hash/sha2/static';

await ready(wasm);
hash('sha256', 'hello');
```

`/static` takes a `WebAssembly.Module`, an instance, a WASM ESM import's exports, or a namespace whose `default` is
one of these. It refuses bytes and URLs, because turning those into a module is the compile such hosts forbid. The
default family paths still work on Workers: their WASM compile fails once, and later calls run on `node:crypto`
(with `nodejs_compat`) or pure JavaScript.

A pool helps when one thread cannot keep up with many inputs. `open(ctx, { workers })` starts the workers, and
`many(ctx, name, inputs, options)` resolves to one digest per input, in order. Inputs that are all views of one
`SharedArrayBuffer` reach the workers without a copy; other inputs are copied once per call. One input of a sequential
hash, such as SHA-256, still runs on one core. Deno, Bun and browsers have a global `Worker`. Node.js needs
`create` from `@okikio/runtime/node/worker`.

The pinned paths are:

- `/wasm`: `@okikio/hash/sha2/wasm`, `@okikio/hash/sha3/wasm`, `@okikio/hash/blake/wasm`, `@okikio/hash/legacy/wasm`, `@okikio/hash/national/wasm`, `@okikio/hash/contest/wasm`, `@okikio/hash/fsb/wasm`, `@okikio/hash/mac/wasm`, `@okikio/hash/fast/wasm`, `@okikio/hash/checksum/wasm`
- `/packed`: `@okikio/hash/sha2/packed`, `@okikio/hash/sha3/packed`, `@okikio/hash/blake/packed`, `@okikio/hash/legacy/packed`, `@okikio/hash/national/packed`, `@okikio/hash/contest/packed`, `@okikio/hash/fsb/packed`, `@okikio/hash/mac/packed`, `@okikio/hash/fast/packed`, `@okikio/hash/checksum/packed`
- `/static`: `@okikio/hash/sha2/static`, `@okikio/hash/sha3/static`, `@okikio/hash/blake/static`, `@okikio/hash/legacy/static`, `@okikio/hash/national/static`, `@okikio/hash/contest/static`, `@okikio/hash/fsb/static`, `@okikio/hash/mac/static`, `@okikio/hash/fast/static`, `@okikio/hash/checksum/static`
- `/native`: `@okikio/hash/sha2/native`, `@okikio/hash/sha3/native`, `@okikio/hash/blake/native`, `@okikio/hash/legacy/native`, `@okikio/hash/national/native`, `@okikio/hash/checksum/native` (CRC-32/ISO-HDLC)
- `/portable`: `@okikio/hash/sha2/portable`, `@okikio/hash/sha3/portable`, `@okikio/hash/blake/portable`, `@okikio/hash/legacy/portable`, `@okikio/hash/checksum/portable`
- `/web`: `@okikio/hash/sha2/web`, `@okikio/hash/legacy/web`
- `/shared`: `@okikio/hash/sha2/shared`, `@okikio/hash/sha3/shared`, `@okikio/hash/blake/shared`, `@okikio/hash/legacy/shared`, `@okikio/hash/national/shared`, `@okikio/hash/contest/shared`, `@okikio/hash/fsb/shared`, `@okikio/hash/mac/shared`, `@okikio/hash/fast/shared`, `@okikio/hash/checksum/shared`
- raw modules: `@okikio/hash/wasm/sha2.wasm`, `@okikio/hash/wasm/sha3.wasm`, `@okikio/hash/wasm/blake.wasm`, `@okikio/hash/wasm/legacy.wasm`, `@okikio/hash/wasm/national.wasm`, `@okikio/hash/wasm/contest.wasm`, `@okikio/hash/wasm/fsb.wasm`, `@okikio/hash/wasm/mac.wasm`, `@okikio/hash/wasm/fast.wasm`, `@okikio/hash/wasm/fast-wide.wasm`, `@okikio/hash/wasm/checksum.wasm`

Import a raw module as a WASM module where the host supports it, or fetch it, and pass the result to the matching
`/wasm` path, or to `/static` where the host refuses runtime compiles.

## Measure copying, hashing and streaming

The focused benchmarks measure SHA-256 at 64 bytes, 1 KiB, 16 KiB, 256 KiB and 4 MiB. Streaming trials vary chunks
independently at 1 KiB, 16 KiB and 64 KiB. The public async and sync digests run against `node:crypto` called directly,
and the Web Crypto and Noble fallbacks have their own named trials. Stream trials include source construction, reading
and finalization.

On Deno 2.9 (x86-64), the public paths ran within 1.4 times the `node:crypto` reference at 64 bytes and matched it
from 16 KiB up. The Web Crypto fallback took about 36 µs for a 64-byte input, against 2.3 µs for the reference. Noble
took about 20 ms for 4 MiB, against 2.3 ms. These are one machine's results, not a guarantee.
Untimed checks compare every full digest and verify byte-limit rejection and released locks for every size/chunk pair.
These results do not compare different hash algorithms or establish a memory ceiling.

Tests are organized beside the submodule they protect: [encoding](./encoding.test.ts), [random](./random.test.ts), [IDs](./id.test.ts),
[UUID](./uuid.test.ts), [HMAC](./hmac.test.ts), [optional families and checksums](./families.test.ts),
[WASM families against upstream vectors](./wasm.test.ts), [entry points and backend choice](./entries.test.ts), and
[stream ownership](./stream.test.ts). [SHA-2 admission](./capabilities.test.ts) names each algorithm and padding-boundary
length separately, so one failed vector does not hide the remaining cases.

From the repository root, run the package's tests and untimed benchmark checks before collecting timings:

```sh
deno task --cwd=packages/hash test
deno task --cwd=packages/hash bench:check
deno task --cwd=packages/hash bench
```

These commands use package-owned fixtures and development dependencies. The
[benchmark protocol](../../docs/benchmarks/01-running.md#choose-a-comparison-that-answers-the-question) explains fair
comparisons, raw report collection and the limits of local measurements.

## Read further

The [Hash guide](https://github.com/okikio/utils/blob/main/docs/packages/10-hash.md) explains the model, manual
alternatives, and composition.

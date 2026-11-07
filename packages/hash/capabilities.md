# Hash content, authenticate messages, and create identifiers

Use full digests to compare content, HMAC to authenticate a message with a secret, and random IDs for new records. The
existing root `id()` remains a stable key for an ordered string tuple. These operations have different collision and
trust properties.

This complete example signs an integrity receipt. Both peers must agree on the exact receipt bytes and already share a
random secret through a separate secure channel.

```ts runnable=hash-receipt.ts
import { id, sha256 } from '@okikio/hash';
import { bytes } from '@okikio/hash/random';
import { sign, verify } from '@okikio/hash/hmac';
import { base64url, unbase64url } from '@okikio/hash/encoding';

const content = new TextEncoder().encode('hello');
const digest = await sha256(content);
const receipt = new TextEncoder().encode(JSON.stringify({
	key: await id('upload', ['dataset-42', digest]),
	digest,
}));
const secret = bytes(32); // Demonstration only: peers need the same provisioned key.
const tag = base64url(await sign('sha256', secret, receipt));
console.log(await verify('sha256', secret, receipt, unbase64url(tag)));
```

```text output
true
```

The receipt owner must include any required audience, expiry and replay token in those authenticated bytes. Hash does
not enforce a protocol or store keys. A plain digest alone cannot authenticate a sender.

## Choose the operation and output

| Import                   | Operations                                                         | Result                                                                          |
| ------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `@okikio/hash`           | `sha256`, `sha384`, `sha512`, `hex`, `id`                          | Named hashes return lower-case hex; `id` preserves the original tuple contract. |
| `@okikio/hash/digest`    | `digest(algorithm, input, encoding?)`, named SHA-2 functions       | Async Web Crypto; generic digest defaults to bytes.                             |
| `@okikio/hash/sync`      | `digest`, named SHA-2 functions, `create`                          | Synchronous SHA-2 and mutable incremental states.                               |
| `@okikio/hash/stream`    | `read(algorithmOrFactory, source, options)`                        | Async incremental bytes with a required inclusive byte limit.                   |
| `@okikio/hash/encoding`  | `hex`, `unhex`, `base64`, `unbase64`, `base64url`, `unbase64url`   | Strict canonical encodings, not hashes.                                         |
| `@okikio/hash/random`    | `bytes`, `fill`, `integer`                                         | Secure bytes and unbiased integers with an exclusive upper bound.               |
| `@okikio/hash/id`        | `random`, `create`, `derive`                                       | Secure compact IDs or the original deterministic tuple derivation.              |
| `@okikio/hash/uuid`      | `v4`, `v7`, `is`, `version`, `parse`, `format`, `timestamp`, `NIL` | UUID creation, conversion and inspection.                                       |
| `@okikio/hash/hmac`      | `sign`, `verify`, `create`                                         | Async complete HMAC tags and reusable native keys.                              |
| `@okikio/hash/hmac/sync` | `sign`, `verify`, `create`                                         | Sync complete HMAC tags and disposable copied keys.                             |
| `@okikio/hash/sha3`      | `sha3_256`, `sha3_512`, `create`                                   | Optional SHA-3; one-shot results are bytes.                                     |
| `@okikio/hash/blake`     | `blake2b`, `blake2s`, `blake3`, `create`                           | Optional BLAKE; one-shot results are bytes.                                     |
| `@okikio/hash/checksum`  | `crc32`, `crc32c`, `create`                                        | Unsigned 32-bit CRC values for accidental corruption.                           |

Every focused path also has an equivalent `@okikio/utils/hash/...` forwarding module. SHA-2 algorithm names are
`sha256`, `sha384` and `sha512`. Generic digest output is `bytes`, `hex` or `base64url`; named SHA-2 functions always
return hex. Both sync and async one-shot functions accept UTF-8 text, buffers, and exact byte views. They snapshot
input. Text is not Unicode-normalized. Incremental updates consume `Uint8Array` chunks synchronously without retaining
their storage. Concurrent writes to a shared buffer cannot provide an atomic snapshot; callers must synchronize such
writes themselves.

Hex decoding accepts even-length lower-case strings only. Base64 requires padding, and Base64url forbids padding. All
decoders reject whitespace, mixed alphabets and noncanonical unused bits. Empty encodings represent empty bytes. Do not
silently normalize a signed wire representation before checking the protocol's canonical form.

## Own incremental state

```ts runnable=hash-fork.ts
import { create } from '@okikio/hash/sync';
import { hex } from '@okikio/hash/encoding';
import { sha256 } from '@okikio/hash';

const encoder = new TextEncoder();
const state = create('sha256');
let fork: ReturnType<typeof create> | undefined;
try {
	// Hash the shared prefix once before separating the two possible suffixes.
	state.update(encoder.encode('prefix:'));
	// clone() copies the current state; future writes no longer affect the other branch.
	fork = state.clone();
	state.update(encoder.encode('left'));
	// Each suffix extends only its own state, producing a different complete input.
	fork.update(encoder.encode('right'));
	console.log(hex(state.digest()) === await sha256('prefix:left'));
	console.log(hex(fork.digest()) === await sha256('prefix:right'));
} finally {
	// Release both states after success or failure; digesting does not reset them for reuse.
	state.destroy();
	fork?.destroy();
}
```

```text output
true
true
```

Each clone owns independent state. `digest()` finalizes once; later update, clone or digest calls throw. `destroy()` is
idempotent and ends unfinished work. Use `finally` when a caller can throw before finalization. There is no implicit
reset or concurrent update support. Sync operations block the calling thread; an async stream read does not move hashing
to a worker.

SHA-3 names are `sha3-256` and `sha3-512`, distinct from Keccak. BLAKE names are `blake2b` (64 bytes), `blake2s` (32
bytes) and `blake3` (32 bytes). Keyed BLAKE, variable output, legacy algorithms, encryption and password derivation are
outside this API. CRC-32 uses the IEEE reflected polynomial; CRC-32C uses Castagnoli. Both use initial and final XOR
`0xffffffff`, and return zero for empty input. CRC is implemented with an eight-step recurrence per byte; it is intended
for portable correctness, without a claim of hardware-level throughput.

## Bound and cancel a stream

```ts runnable=hash-stream.ts
import { read } from '@okikio/hash/stream';
import { sha256 } from '@okikio/hash';
import { hex } from '@okikio/hash/encoding';

const source = new ReadableStream<Uint8Array>({
	start(controller) {
		controller.enqueue(new TextEncoder().encode('hello'));
		controller.close();
	},
});
const result = await read('sha256', source, { maximumBytes: 5 });
console.log(hex(result) === await sha256('hello'), source.locked);
```

```text output
true false
```

`maximumBytes` is required and must be a nonnegative safe integer. The policy is snapshotted before reading; later
caller mutation cannot raise that ceiling. A chunk that would cross the ceiling is rejected before hashing. Zero permits
empty streams. This bounds admitted data, not source-side allocations. No whole-input buffer is retained. A single large
chunk still blocks the thread while it is hashed.

`signal` interrupts pending reads. EOF releases the reader lock. Errors and abort initiate cancellation and promptly
release the lock; rejection does not wait for a hanging source cancel hook. `preventCancel: true` releases ownership
without cancelling the source. `onCleanup` receives a promise that always resolves to the reader cleanup outcome,
including a late cancellation failure. Retain it when the source owner needs to observe that result separately from the
original failure. A pre-aborted signal and invalid bounds are checked before locking the source.

For another family, pass a fresh factory, for example `read(() => blake.create('blake3'), source, options)`. This call
owns and destroys the returned state on every exit. Do not return a state shared with another task.

## Choose an identifier policy

`random()` uses 21 characters from a 64-symbol URL-safe alphabet: 126 random bits. `create({ alphabet, length })`
validates once and returns a reusable zero-argument ID function. Alphabets contain 2–94 unique printable ASCII symbols.
Length is 1–1,048,576. Rejection sampling avoids modulo bias for alphabets whose length does not divide 256. Custom
symbols are not necessarily safe in a URL or filename.

`bytes(length)` allows zero through `MAX_BYTES` (16 MiB). `fill(target)` fills only the visible range and splits calls
at Web Crypto's 65,536-byte quota. Shared storage uses temporary ordinary storage of at most 65,536 bytes per chunk.
`integer(minimum, maximum)` uses an exclusive upper bound; both bounds and their difference must be safe integers. These
functions have no weak randomness fallback. Random IDs can collide. Use a unique constraint and retry creation on
conflict.

`derive(prefix, parts)` and root `id(prefix, parts)` preserve the prefix and append 32 lower-case hex characters from
SHA-256 of `JSON.stringify(parts)`. That is 128 retained digest bits, not a uniqueness or integrity guarantee. Existing
IDs are unchanged by this expansion.

`v4()` uses native `crypto.randomUUID()`. `v7(timestamp?)` uses STD and a Unix millisecond timestamp; values within one
millisecond have random order. Clock rollback may produce smaller IDs. No global monotonic state or distributed ordering
is promised. `timestamp()` only accepts v7. Validation and conversions accept RFC variant versions 1–7 and nil,
case-insensitively; formatting returns lower-case hyphenated text. Nil has version zero. Version 8 and the maximum UUID
sentinel are intentionally not accepted by this STD-backed validation contract.

## Own HMAC keys

Async `create(algorithm, keyBytes)` imports a copied nonempty raw key and returns `sign(input)` and `verify(input, tag)`
methods. Message and tag bytes are copied before awaiting work. The native key is non-extractable; its lifetime ends
with garbage collection because Web Crypto provides no explicit destruction method. There is no global key cache.

Sync `create` also copies the key and adds `destroy()`. Disposing zeroes the owned copy and rejects further use.
One-shot sync calls dispose their copies in `finally`. Neither disposal nor native non-extractability promises total
memory erasure in JavaScript. Caller-owned key bytes remain the caller's responsibility. Choose cryptographically random
keys at least as long as the selected digest. Passwords require a separate password derivation policy.

Verification checks complete byte tags, returning false for altered or wrong-size tags. Empty keys and unsupported
algorithms throw. Native async verification uses Web Crypto. Sync verification accumulates byte differences for
equal-size tags, but JavaScript does not guarantee constant-time execution. Prefer native verification for
authentication endpoints. HTTP Signature now composes these primitives while retaining its string-secret and canonical
hex wire contracts.

## Dependency and maintenance decisions

[STD encoding](https://jsr.io/@std/encoding) owns representation codecs, with this package enforcing a strict round-trip
canonical policy. [STD UUID](https://jsr.io/@std/uuid) owns UUID validation and v7 policy. Focused imports avoid loading
its unrelated digest-backed UUID versions.

[STD crypto](https://github.com/denoland/std/blob/main/crypto/crypto.ts) already supports many algorithms, sync digests
and iterable input. Its public interface does not expose the push-style incremental state and cloning used here; its
DigestContext is internal. We do not deep-import it or buffer input to imitate incremental hashing.
[Noble Hashes](https://github.com/paulmillr/noble-hashes) provides public incremental state, cloning and destruction
without a WASM loader. Its algorithm implementations remain in optional focused graphs. Root and native HMAC use Web
Crypto; the root does not load Noble, UUID or stream code.

Keep those boundaries when adding algorithms. Verify published vectors, admission semantics, lifecycle errors and
focused export parity. Statistical sampling tests do not prove randomness quality, timing safety or collision freedom.
The tests exercise runtime compatibility and published behavior; they are not a cryptographic audit.

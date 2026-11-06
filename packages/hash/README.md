# Hash

An import receipt needs to answer two questions: did these exact source bytes change, and which dataset attempt does this receipt describe? SHA-256 gives the content a full fingerprint, called a digest. `id()` derives a shorter correlation key from the dataset name and that digest. Neither operation grants permission to access the data.

For Deno, Node, and Bun execution, see [run a portable example](../../docs/05-runtime.md#run-a-portable-example-in-your-own-project). Host-specific adapters keep their native runtime requirements.

From a checkout of this experimental workspace, run `mise trust`, `mise install`, then `mise run prepare -- --kind deps` at the repository root. Save the following program as `example.ts` and run `mise exec -- deno run example.ts`. These commands use the workspace export maps; they do not assume a published registry version.

```ts runnable
import { id, sha256 } from '@okikio/hash';

const source = 'Name\nAda\n';
// Hash the exact UTF-8 content, including newlines, for later integrity comparison.
const digest = await sha256(source);
// Derive a compact correlation key separately; retain the full digest for integrity checks.
const key = await id('import', ['dataset-42', digest]);
console.log(digest.length, key.startsWith('import-'));
```

The digest has 64 hexadecimal characters (256 bits). The second value confirms the correlation prefix. Compare full digests to detect changed content; keep the source or expected digest in a trusted location when checking integrity.

Expected output:

```text output
64 true
```

The digest is useful only in a comparison. If you keep a trusted digest from an earlier import, the same digest later
indicates that the content is unchanged, subject to the algorithm's collision risk. If an attacker can replace both the file and its expected
digest, an ordinary hash does not authenticate the file. An **HMAC** is a keyed message authentication code. It checks possession of a shared secret; neither a
hash nor an HMAC hides the original content as encryption would.

## Hash the selected bytes, not the whole backing buffer

An uploaded file can be a view into a larger buffer. Hashing its backing buffer would accidentally include bytes outside
the selected input. The utility copies the visible view before asynchronous hashing, so a caller can reuse its buffer
after admission.

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
This copy costs memory proportional to the visible input; it is not an incremental hashing API. With Web Crypto
directly, you must choose and snapshot the same byte range, call `crypto.subtle.digest`, and format its returned bytes
yourself.

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
| `@okikio/hash/random`    | Allocate secure random bytes or choose unbiased integers.                            | [Contract](./random.ts)    |
| `@okikio/hash/id`        | Create secure random IDs or derive stable IDs from an ordered tuple.                 | [Contract](./id.ts)        |
| `@okikio/hash/uuid`      | Create UUIDv4 or UUIDv7 and validate, parse, format, or inspect UUID values.         | [Contract](./uuid.ts)      |
| `@okikio/hash/sha3`      | Use optional SHA3-256 or SHA3-512 with independent incremental state.                | [Contract](./sha3.ts)      |
| `@okikio/hash/blake`     | Use optional BLAKE2b, BLAKE2s, or BLAKE3 with fixed digest sizes.                    | [Contract](./blake.ts)     |
| `@okikio/hash/checksum`  | Detect accidental corruption with CRC-32 or CRC-32C; these do not authenticate data. | [Contract](./checksum.ts)  |
| `@okikio/hash/hmac`      | Sign and verify complete message tags using native HMAC-SHA-2 and owned keys.        | [Contract](./hmac/mod.ts)  |
| `@okikio/hash/hmac/sync` | Use synchronous HMAC-SHA-2; destroy reusable copied keys when finished.              | [Contract](./hmac/sync.ts) |

## Measure copying, hashing and streaming

The focused benchmarks measure SHA-256 at 1 KiB, 16 KiB, 256 KiB and 4 MiB. Streaming trials vary chunks independently
at 1 KiB, 16 KiB and 64 KiB. Native digest and Web Crypto comparisons both include the defensive input copy; portable
synchronous SHA-256 has its own named trial. Stream trials include source construction, reading and finalization.
Untimed checks compare every full digest and verify byte-limit rejection and released locks for every size/chunk pair.
These results do not compare different hash algorithms or establish a memory ceiling.

Tests are organized beside the submodule they protect: [encoding](./encoding.test.ts), [random](./random.test.ts), [IDs](./id.test.ts),
[UUID](./uuid.test.ts), [HMAC](./hmac.test.ts), [optional families and checksums](./families.test.ts), and
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

# Hash

A saved import can retain a digest of its source. On the next import, compare the full digest before deciding that the
content is unchanged. A **digest** is a fixed-size fingerprint computed from the bytes; it is not the original bytes,
encrypted content or a permission token. The [package example](../../packages/hash/README.md) computes one locally.

`sha256` returns the full lower-case hexadecimal digest. Text uses UTF-8; typed-array views include only their visible
bytes. Borrowed buffers are copied before asynchronous work. This copy costs memory proportional to the input.

`id` hashes an ordered JSON tuple, avoiding separator ambiguity, and retains 128 bits. Use it for compact correlation.
Persisted identities still need a unique constraint; integrity checks use the full digest. The prefix remains
caller-owned. Keep the full digest with the receipt and use a unique constraint for persisted compact keys.

For message authentication with a shared secret, choose `@okikio/hash/hmac`; for HTTP-specific signature wire conventions, choose `@okikio/http/signature`. See the [complete Hash capability examples](../../packages/hash/capabilities.md) for HMAC, streaming, random IDs, UUIDs and encodings. The application owns key rotation, audience, expiry and replay policy.

## Check a source fingerprint and make a shorter key

Compute the fingerprint of `source text` and make a short key to identify the import in logs or records. After the
[checkout setup](../../README.md#run-a-complete-example-from-this-checkout), save this as `source-fingerprint.ts` and
run `mise exec -- deno run source-fingerprint.ts`.

```ts runnable=source-fingerprint.ts
import { id, sha256 } from '@okikio/hash';

const digest = await sha256('source text');
// Derive a compact correlation key separately; retain the full digest for integrity checks.
const key = await id('import', ['dataset-42', digest]);
console.log(digest.length, key.startsWith('import-'));
```

Expected output:

```text output
64 true
```

The SHA-256 digest has 64 hexadecimal characters. The separate key starts with `import-`, which helps you recognize
what it identifies. Keep the full digest when you need to compare source contents.

## Hash a large response without collecting its body

The first example keeps the whole input in memory and copies it before hashing. If you already have a response
body as a byte stream, pass it to `@okikio/hash/stream` instead. The utility hashes one chunk at a time, then
releases the reader and closes the hasher. Set a byte limit that fits the download you expect.

The [stream example](../../packages/hash/capabilities.md#bound-and-cancel-a-stream) shows that path with five local bytes.
Use the algorithm string for SHA-2. A hasher factory is needed only for another algorithm family; it is not an extra
setup step for every digest. Streaming keeps memory incremental, but hashing each chunk still uses the calling thread.

## Compatibility with older persisted IDs

If an application previously hashed parts joined with a separator, its saved IDs differ from these ordered-tuple IDs.
Migrate those records deliberately; recomputing their IDs silently changes identity. This is a migration concern for
existing data, not an extra step when creating new ordered-tuple IDs.

## Without this utility

Encode text with `TextEncoder`, copy the intended byte range, and pass it to `crypto.subtle.digest`. Convert each
returned byte to two hexadecimal characters. For a compact ID, serialize the ordered parts as a JSON array before
hashing. Joining with a separator can make different tuples indistinguishable. The utility centralizes these encoding
decisions; the application owns whether an ID may be persisted and how collisions are detected.

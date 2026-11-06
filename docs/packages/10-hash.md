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

## Run a complete task

Compute a full digest and a compact correlation key from local text. This program supplies its own local input and uses
public workspace imports. After `mise run prepare -- --kind deps`, copy it to a `.ts` file in your project and run
`mise exec -- deno run example.ts`.

```ts runnable=complete-task.ts
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

Compare the output before changing the input. The remaining sections explain the options and limits; the
[package example](../../packages/hash/README.md) also places this operation among adjacent capabilities.

## Compatibility with older persisted IDs

IDs from Intelligence’s former separator-based encoding differ from these ordered-tuple IDs. If an application already saved those keys, migrate its records deliberately; recomputing them silently changes identity. This only affects consumers of that former encoding.

## Without this utility

Encode text with `TextEncoder`, copy the intended byte range, and pass it to `crypto.subtle.digest`. Convert each
returned byte to two hexadecimal characters. For a compact ID, serialize the ordered parts as a JSON array before
hashing. Joining with a separator can make different tuples indistinguishable. The utility centralizes these encoding
decisions; the application owns whether an ID may be persisted and how collisions are detected.

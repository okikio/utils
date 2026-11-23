---
npm/@okikio/hash: minor
npm/@okikio/utils: minor
---

Add `@okikio/hash/<family>/shared`: a pool of workers, built on `@okikio/worker/thread`, that hashes many inputs in parallel. `open(ctx, { workers })` starts the pool, and `many(ctx, name, inputs, options)` returns one digest per input, in order. A batch crosses to a worker as one buffer plus offsets, and inputs that are all views of one `SharedArrayBuffer` are not copied. `hash()` splits one BLAKE3 input of 1 MiB or more into subtrees across the workers and merges their chaining values, with the same digest as one pass.

Short outputs (up to 64 bytes) from the family entry points are now views into a shared 8 KiB slab, as Node.js `Buffer` pools do. Deno allocates every typed array off the JavaScript heap, for about 800 ns; a 64-byte SHA-256 call there drops from 1.8 to 0.55 µs. Copy such an output with `slice()` before transferring its buffer. The pure JavaScript CRC-32 now uses slicing-by-8 and runs 50 to 80 times faster.

---
npm/@okikio/hash: minor
npm/@okikio/utils: minor
---

Add `@okikio/hash/<family>/shared`: a pool of workers, built on `@okikio/worker/thread`, that hashes many inputs in parallel. `open(ctx, { workers })` starts the pool, and `many(ctx, name, inputs, options)` returns one digest per input, in order. A batch crosses to a worker as one buffer plus offsets, and inputs that are all views of one `SharedArrayBuffer` are not copied. `hash()` splits one BLAKE3 input of 1 MiB or more into subtrees across the workers and merges their chaining values, with the same digest as one pass.

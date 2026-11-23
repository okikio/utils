---
npm/@okikio/hash: patch
---

Use the host's built-in `node:crypto` SHA-2 in Deno, Node and Bun for the root, `digest` and `sync` paths, found at run time so browser bundles stay free of Node imports. Small async digests were 12 to 17 times slower than `node:crypto`, and sync digests about 10 times slower; both now run within 1.4 times of it. Browsers keep Web Crypto and Noble, and the Web Crypto path no longer makes a redundant copy of ordinary buffers. Results are unchanged.

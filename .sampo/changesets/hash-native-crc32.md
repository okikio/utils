---
npm/@okikio/hash: minor
npm/@okikio/utils: minor
---

CRC-32/ISO-HDLC runs on the host's built-in `zlib.crc32()` where it exists (Node.js 22.2 and later, Deno and Bun). It uses the CPU's carry-less multiply: 5 to 99 GB/s at 1 MiB, against about 2 GB/s for WebAssembly. The automatic entry uses it from 4 KiB in Deno and Node and from 512 B in Bun, where it beats the module, and for incremental states. A new `@okikio/hash/checksum/native` path runs it alone.

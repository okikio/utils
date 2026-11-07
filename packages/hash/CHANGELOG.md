# @okikio/hash

## 0.1.0 — 2026-11-07

### Minor changes

- [9db605a](https://github.com/okikio/utils/commit/9db605ab14a6b042425c2759da37e4a4ef79aca1) Add asynchronous, synchronous and incremental digests, bounded stream hashing, HMAC signing and verification,
  strict digest encodings, secure random IDs and UUIDs. Keep optional SHA-3, BLAKE and checksum algorithms in focused
  subpaths. Stream callers choose cancellation and byte limits; checksums detect accidental corruption and do not
  authenticate data. Applications still own trusted expected digests and key lifetimes.

### Patch changes

- Updated dependencies: @okikio/streams@0.1.0


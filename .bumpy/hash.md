---
'@okikio/hash': minor
---

Add asynchronous, synchronous and incremental digests, bounded stream hashing, HMAC signing and verification,
strict digest encodings, secure random IDs and UUIDs. Keep optional SHA-3, BLAKE and checksum algorithms in focused
subpaths. Stream callers choose cancellation and byte limits; checksums detect accidental corruption and do not
authenticate data. Applications still own trusted expected digests and key lifetimes.

---
npm/@okikio/storage: minor
---

The Postgres outbox gains `completed()` and `remove()` for retiring completed messages after the application's own checks. `completed()` lists completed messages before a cutoff, oldest first, with an optional SQL condition applied before the limit, and takes no locks. `remove()` deletes one completed message inside the caller's transaction, under the namespace lock, and returns `false` when the message is missing, failed, pending or too recent. Failed messages are never touched, so they stay for operator recovery. `prune()` is unchanged.

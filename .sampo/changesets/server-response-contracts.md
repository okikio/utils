---
npm/@okikio/server: patch
npm/@okikio/utils: patch
---

Select successful responses by their declared status and media type. Preserve ordinary JSON fields named `meta` and
`data`; unwrap only an explicit data envelope, a timestamped response or a page. Producers that attach occurrence
metadata must declare `envelope: 'data'` for clients that read that envelope.

Response and problem-extension validation failures now throw `ClientResponseError` with the observed HTTP status and
the original cause. Fetch failures and caller cancellation keep their original errors. The installed consumer checks
cover direct and umbrella imports, the HTTP producer, declared envelopes, timestamps and pages.

---
'npm/@okikio/http': patch
'npm/@okikio/utils': patch
---

Reject raw tab, carriage-return and line-feed characters in HTTP client paths before Fetch can normalize them.
Read the path once so a caller header getter cannot replace the validated destination. The same admission applies
to decoded requests, transferred response bodies and streaming responses.

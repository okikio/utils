---
npm/@okikio/server: patch
---

Cancel unread request bodies when a response completes or the caller aborts before dispatch, and keep stalled reads attached to their request deadline. Preserve the original cancellation reason and leave asynchronous cleanup of borrowed input under caller ownership.

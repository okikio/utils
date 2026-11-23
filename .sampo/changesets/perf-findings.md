---
npm/@okikio/scheduler: patch
npm/@okikio/workflow: patch
npm/@okikio/collection: patch
---

Remove quadratic work found by benchmarking every package. The memory queue and the memory activity dispatch built a set of every live claim id for each new claim, and scanned every item for expired claims on each claim, completion and renewal. They now keep the live ids in a set and skip the expiry scan until the earliest claim can expire, and dispatch counts unfinished items instead of scanning them on admission. Adding, claiming and completing 1,000 items drops from 47.6 to 1.2 ms in the queue and from 51.6 to 8.4 ms in dispatch, on Bun. A queue claim of one item now finds it in one pass. `record.map`, `filter` and `omit` write their frozen result directly instead of through `fromEntries` (6 to 11 times faster), and record and JSON-copy validation read one property descriptor at a time instead of building them all at once (about twice as fast for JSON copies in V8). Behavior and error messages are unchanged.

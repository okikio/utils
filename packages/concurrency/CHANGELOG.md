# Changelog

## 0.1.0
<sub>2026-10-29</sub>

- *(minor)*
  Introduced the first shared Okikio utility release, reconciling duplicate implementations and regression fixes from the
  existing Platform, Crawl, and MediaD utility trees into one maintained source.
- *(patch)*
  Bounded queue, ordered mapping, and unordered mapping now retain the exact first mapper failure after cancelling and
  joining admitted siblings. A mapper that throws `undefined` previously rejected with the native abort `DOMException`; it
  now rejects with `undefined`. Null, string, object, and Error failures retain their original values and identity. No
  caller API changes are required.

  Ordered mapping now joins admitted work even when closing the input iterator fails. When operation and source cleanup
  both fail, an `AggregateError` retains both values in that order and keeps the operation failure as its `cause`. A
  source cleanup failure alone is rethrown unchanged.

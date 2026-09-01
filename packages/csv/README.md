`@okikio/csv`
============

Purpose
-------

`@okikio/csv` parses CSV structure. It does **not** decide what a column means to
a CRM import, data pipeline, or any other product feature.

Use it when you need:

- bounded CSV parsing from text, bytes, or a Web `ReadableStream`;
- delimiter and byte-encoding detection;
- stable header normalization and duplicate-key handling;
- row/cell/source limits;
- one-shot streaming with backpressure and deterministic disposal;
- structural diagnostics without coercing source cells into numbers, dates, or formulas.

The public runtime API is intended to read as a namespace:

```ts
import * as csv from '@okikio/csv';

const document = csv.parse('name,role\nAda,Engineer\n');
const fromBytes = csv.parseBytes(new TextEncoder().encode('name\nAda\n'));
const normalized = csv.normalizeHeader(' Company:Website_URL ');
```

`CsvParseError` and the `Csv*` types remain self-identifying because callers may
import them directly and error names must remain clear in stack traces.

Start with text
---------------

```ts
import * as csv from '@okikio/csv';

const document = csv.parse([
  'name,website',
  'Northstar,https://northstar.example',
].join('\n'));

console.log(document.columns);
// [
//   { index: 0, name: 'name', key: 'name', normalizedName: 'name' },
//   { index: 1, name: 'website', key: 'website', normalizedName: 'website' },
// ]

console.log(document.rows[0]?.values);
// ['Northstar', 'https://northstar.example']
```

The parser keeps cell values as strings. If `00123` appears in the file, the
returned value remains `'00123'`.

Parse original bytes
--------------------

Use `parseBytes()` when byte encoding and the source-byte limit matter.

```ts
import * as csv from '@okikio/csv';

const bytes = await Deno.readFile('accounts.csv');
const document = csv.parseBytes(bytes, {
  fileName: 'accounts.csv',
  maximumBytes: 64 * 1024 * 1024,
  maximumRows: 1_000_000,
  maximumColumns: 512,
  maximumCellCharacters: 1_000_000,
});

console.log(document.encoding);   // utf-8, utf-8-bom, or windows-1252
console.log(document.delimiter);  // ',', ';', or '\t'
```

Options use complete words. `maximumRows` is intentional; there is no `maxRows`
compatibility alias.

Stream unknown or large input
-----------------------------

`parseStream()` is the primary API when you do not want to retain the complete
source or complete row set in memory.

```ts
import * as csv from '@okikio/csv';

await using document = await csv.parseStream(request.body!, {
  maximumBytes: 128 * 1024 * 1024,
  maximumRows: 2_000_000,
  maximumColumns: 256,
  maximumCellCharacters: 128 * 1024,
  headerScanRows: 25,
  maximumPeekBytes: 256 * 1024,
});

for await (const row of document.rows) {
  await saveRow(row);
}
```

The returned `CsvStreamDocument` is one-shot. Consuming all rows or calling its
`AsyncDisposable` releases the owned reader. Attempting to iterate a second
time fails rather than silently replaying or buffering the source.

Safety limits
-------------

Each growing dimension has its own bound:

| Option | Bounds | Default |
| --- | --- | ---: |
| `maximumBytes` | original byte source | 64 MiB |
| `maximumCharacters` | decoded collecting source | 64 Mi code units |
| `maximumRows` | emitted data rows | 1,000,000 |
| `maximumColumns` | header and row width | 512 |
| `maximumCellCharacters` | one decoded cell | 1,000,000 |
| `headerScanRows` | rows inspected for automatic header selection | 25 |
| `maximumPeekBytes` | bytes inspected before streaming begins | 256 KiB |

The stream parser snapshots options **before the first asynchronous source
read**. Mutating the object after `parseStream()` is called does not change an
in-flight parse.

Header normalization
--------------------

```ts
import * as csv from '@okikio/csv';

csv.normalizeHeader('\ufeff Company:Website_URL ');
// 'company website url'
```

Normalization handles BOMs, Unicode normalization, camel-case boundaries,
common punctuation, separators, and repeated whitespace. It is idempotent:
normalizing an already-normalized header returns the same value.

The generic parser uses normalized headers only for stable keys and structural
header selection. It does **not** classify columns as `company`, `email`,
`website`, or `domain`.

Product classification belongs above CSV
----------------------------------------

For example, a product import feature can classify parsed columns without
teaching `@okikio/csv` about CRM semantics:

```ts
import * as csv from '@okikio/csv';

const roles = new Map([
  [csv.normalizeHeader('Company Domain Name'), 'domain'],
  [csv.normalizeHeader('Website URL'), 'website'],
] as const);

const document = csv.parse(source);
const columns = document.columns.map((column) => ({
  ...column,
  role: roles.get(column.normalizedName) ?? 'unknown',
}));
```

That separation is important. `@okikio/csv` remains reusable for media metadata,
financial exports, scientific data, logs, and other CSV documents that have
nothing to do with account enrichment.

Convenience and the manual equivalent
-------------------------------------

### Collecting parse

Convenience:

```ts
const document = csv.parseBytes(bytes, {
  maximumRows: 100_000,
  maximumCellCharacters: 64 * 1024,
});
```

The equivalent work without `@okikio/csv` is roughly:

```ts
// 1. Check the source byte limit before decoding.
if (bytes.byteLength > maximumBytes) throw new RangeError('source too large');

// 2. Detect BOM / UTF-8 validity and select a decoder.
const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);

// 3. Inspect a bounded sample and choose ',', ';', or '\t'.
const delimiter = detectDelimiter(text.slice(0, sampleCharacters));

// 4. Parse records with @std/csv.
const records = parseStdCsv(text, {
  separator: delimiter,
  fieldsPerRecord: -1,
});

// 5. Select/validate the header, make duplicate keys unique, and preserve
//    blank-header diagnostics.
const columns = buildColumns(records[headerIndex]);

// 6. Enforce row, column, and cell limits while preserving every cell as text.
// 7. Attach row-width/formula diagnostics.
// 8. Freeze the returned structural document so parser-owned arrays cannot drift.
```

`csv.parseBytes()` is valuable when you want all eight steps to share one tested
contract instead of reimplementing only the happy path.

### Streaming parse

Convenience:

```ts
await using document = await csv.parseStream(source, {
  maximumBytes: 512 * 1024 * 1024,
});

for await (const row of document.rows) consume(row);
```

Manual ownership is substantially more involved:

```ts
const reader = source.getReader();
try {
  // Read a bounded prefix without losing bytes.
  const { prefix, tail } = await peek(reader, maximumPeekBytes);

  // Detect encoding + delimiter from the prefix.
  // Replay prefix/tail before the unread source.
  // Count bytes as chunks flow through.
  // Feed a streaming CSV state machine.
  // Buffer only bounded header-discovery rows.
  // Yield rows only when the consumer requests them.
  // Enforce row/column/cell limits during iteration.
} finally {
  await reader.cancel();
  reader.releaseLock();
}
```

The convenience is therefore not “fewer lines.” It is the combination of
bounded discovery, byte accounting, parser state, one-shot semantics,
backpressure, and cleanup being one tested lifecycle.

### Header normalization

Convenience:

```ts
const key = csv.normalizeHeader(sourceHeader);
```

Manual equivalent:

```ts
const key = sourceHeader
  .replace(/^\ufeff/, '')
  .normalize('NFKC')
  .trim()
  .replace(/([a-z\d])([A-Z])/g, '$1 $2')
  .toLowerCase()
  .replace(/[\u2010-\u2015]/g, '-')
  .replace(/[*:]/g, ' ')
  .replace(/[_./\\()[\]-]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();
```

Use the manual form when your application intentionally needs a different
canonicalization policy. Do not wrap `normalizeHeader()` only to hide a policy
change.

Diagnostics and failures
------------------------

Recoverable observations stay in `document.diagnostics` and, where applicable,
`row.diagnostics`:

- blank or duplicate headers;
- a skipped instructional preamble;
- legacy Windows-1252 fallback;
- row-width mismatches;
- spreadsheet-formula markers;
- header-only documents.

`CsvParseError` is reserved for unrecoverable structural or configured-limit
failures such as malformed CSV, missing headers, oversized input, too many
columns/rows, or oversized cells.

Tests and benchmarks
--------------------

The package deliberately separates concerns:

- `headers_test.ts` checks normalization and generated idempotence properties;
- `dialect_test.ts` checks quote-aware delimiter ranking;
- `encoding_test.ts` checks BOM/line-ending/fallback behavior;
- `options_test.ts` checks deterministic option records and limits;
- `parse_test.ts` runs the representative CRM/generic fixture matrix as
  structural CSV data, not as product classification;
- `stream_test.ts` checks chunk boundaries, limits, one-shot disposal, and
  option snapshotting;
- `type_test.ts` protects the namespace API and rejects obsolete abbreviated
  option names;
- `parse_bench.ts` compares a 10,000-row workload against `@std/csv` structural
  parsing and measures the streaming path with 64 KiB chunks.

The benchmark baseline is there to make parser overhead visible. It is not a
claim that `@std/csv` and `@okikio/csv` perform identical work.

Source guide
------------

Read source in this order when you need to drop below the convenience API:

1. `mod.ts` — root runtime surface intended for `import * as csv`.
2. `types.ts` — direct-import structural types and failure contracts.
3. `options.ts` — deterministic option validation/defaults.
4. `headers.ts` — header canonicalization.
5. `dialect.ts` / `encoding.ts` — bounded detection primitives.
6. `parse.ts` — collecting composition.
7. `stream.ts` — streaming ownership/backpressure state machine.
8. `*_test.ts` and `*_bench.ts` — edge cases and performance questions.

The README is the primary user documentation. There is intentionally no
separate hand-maintained API reference.

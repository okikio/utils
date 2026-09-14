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

~~~~ts
import * as csv from '@okikio/csv';

const document = csv.parse('name,role\nAda,Engineer\n');
const fromBytes = csv.parseBytes(new TextEncoder().encode('name\nAda\n'));
const normalized = csv.normalizeHeader(' Company:Website_URL ');
~~~~

`CsvParseError` and the `Csv*` types remain self-identifying because callers may
import them directly and error names must remain clear in stack traces.

Start with text
---------------

~~~~ts
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
~~~~

The parser keeps cell values as strings. If `00123` appears in the file, the
returned value remains `'00123'`.

Parse original bytes
--------------------

Use `parseBytes()` when byte encoding and the source-byte limit matter.

~~~~ts
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
~~~~

Options use complete words. `maximumRows` is intentional; there is no `maxRows`
compatibility alias.

Stream unknown or large input
-----------------------------

`parseStream()` is the primary API when you do not want to retain the complete
source or complete row set in memory.

~~~~ts
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
~~~~

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

`maximumCharacters` belongs only to collecting parses because it bounds the
complete decoded source retained in memory. `parseStream()` rejects that option;
streaming instead enforces `maximumBytes`, row, column, cell, and peek limits as
data flows.

Header normalization
--------------------

~~~~ts
import * as csv from '@okikio/csv';

csv.normalizeHeader('\ufeff Company:Website_URL ');
// 'company website url'
~~~~

Normalization handles BOMs, Unicode normalization, camel-case word transitions,
common punctuation, separators, and repeated whitespace. It is idempotent:
normalizing an already-normalized header returns the same value.

The generic parser uses normalized headers only for stable keys and structural
header selection. It does **not** classify columns as `company`, `email`,
`website`, or `domain`.

Product classification belongs above CSV
----------------------------------------

For example, a product import feature can classify parsed columns without
teaching `@okikio/csv` about CRM semantics:

~~~~ts
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
~~~~

That separation is important. `@okikio/csv` remains reusable for media metadata,
financial exports, scientific data, logs, and other CSV documents that have
nothing to do with account enrichment.

What the parser owns
--------------------

The collecting and streaming APIs intentionally share the same structural CSV
rules. The package owns the repetitive correctness work needed to make those
rules consistent:

- source byte and decoded-data limits;
- BOM and byte-encoding detection;
- quote-aware delimiter selection;
- stable header normalization and duplicate handling;
- row, column, and cell limits;
- structural diagnostics;
- one-shot stream ownership, backpressure, and cleanup.

Applications still own domain interpretation. If a product needs a different
header canonicalization policy, a different cell type system, or CRM-specific
column roles, implement that policy above `@okikio/csv` rather than hiding it
inside parser configuration.

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

The package deliberately separates adapters:

- `headers.test.ts` checks normalization and generated idempotence properties;
- `dialect.test.ts` checks quote-aware delimiter ranking;
- `encoding.test.ts` checks BOM/line-ending/fallback behavior;
- `options.test.ts` checks deterministic option records and limits;
- `parse.test.ts` runs the representative CRM/generic fixture matrix as
  structural CSV data, not as product classification;
- `stream.test.ts` checks chunk splits, limits, one-shot disposal, and
  option snapshotting;
- `type.test.ts` protects the namespace API and rejects obsolete abbreviated
  option names;
- `parse.bench.ts` compares a 10,000-row workload against `@std/csv` structural
  parsing and measures the streaming path with 64 KiB chunks.

The benchmark baseline is there to make parser overhead visible. It is not a
claim that `@std/csv` and `@okikio/csv` perform identical work.

Implementation layout
---------------------

The runtime surface is split by responsibility so consumers can import only what
they need and maintainers can benchmark the hot paths independently:

- `options.ts` owns deterministic option validation and defaults;
- `headers.ts` owns header canonicalization;
- `dialect.ts` and `encoding.ts` own bounded source detection;
- `parse.ts` owns collecting composition;
- `stream.ts` owns streaming state, backpressure, and reader cleanup.

Executable tests cover malformed input, limits, option snapshotting, structural
diagnostics, one-shot streaming, and namespace typing. Benchmarks compare the
collecting and streaming paths with representative `@std/csv` work so parser
overhead remains visible.

# Keep source bytes distinct from interpreted rows

A contact file contains a company name with a comma inside it. The importer must preserve that cell, find its header,
and let the application decide whether the contact is valid. For a large file, it must do the same work incrementally
and close the source if the user stops the import.

Splitting text on commas or newlines breaks quoted cells. This package uses @std/csv for field syntax, with an adapter
for blank records and exact quoted newlines. Application policy owns header and conversion decisions.

## Read a contact by its column name

The contact source contains a quoted company name. Parse the complete record, then select its email through the header
lookup. The lookup keeps column position out of the application code.

Run from this checkout after `mise run prepare -- --kind deps`. Save the runnable block as `example.ts` at the checkout root and use
`mise exec -- deno run example.ts`.

```ts runnable=example.ts
import * as csv from '@okikio/format/csv';

const source = 'Company,Email,Note\n"Ada, Inc.",ada@example.com,"hello, world"\n';
const options = { headerRow: 1 };
const document = csv.parse(source, options);
// Select by the parsed header key so a changed column order does not select the wrong field.
const email = document.columns.find((column) => column.key === 'email');
if (email === undefined) throw new Error('The contact file needs an Email column.');
console.log(document.columns.map((column) => column.key).join(','));
console.log(document.rows[0]?.values[email.index]);
```

Expected output:

```text output
company,email,note
ada@example.com
```

## Keep logical record positions when reviewing contacts

A review screen may need to point a person back to the record that needs attention. `row.row` is the one-based
**logical record** number, including the header and any blank records before it. It is not a physical line number:
a quoted cell can contain several lines. `preserveBlankRows: true` also emits blank records instead of discarding them.
`rawHeader` keeps the exact decoded header next to its normalized lookup key.

```ts runnable=contact-positions.ts
import * as csv from '@okikio/format/csv';

const document = csv.parse(' Company ,Email\n"Ada, Inc.",ada@example.com\n\nLin,lin@example.com\n', {
	headerRow: 1,
	preserveBlankRows: true,
});
console.log(JSON.stringify(document.columns[0]?.rawHeader));
for (const row of document.rows) {
	const label = row.values.every((value) => value === '') ? '(blank)' : row.values[0];
	console.log(row.row, label);
}
```

```text output
" Company "
2 Ada, Inc.
3 (blank)
4 Lin
```

Keep the record number beside a validation error or accepted contact. Omitting blank records from the result does not
renumber later records. If you need byte offsets or physical line spans, this API does not provide them.

## Quote cells when writing contacts

Use the writer for quoted scalar framing instead of assembling cells by hand:

```ts runnable
import * as csv from '@okikio/format/csv';
import { cell, comma, recordEnd } from '@okikio/format/csv/write';

// Each source cell is one value, even when it contains commas or line breaks.
const cells = ['a,b', 'line\nbreak', ''];
const header = ['first', 'second', 'third'].join(comma);
const encodedRow = cells.map(cell).join(comma);
const text = header + recordEnd + encodedRow + recordEnd;

const document = csv.parse(text, { headerRow: 1 });
const parsedFields = document.rows[0]?.values;
console.log(JSON.stringify(parsedFields));
```

Expected output:

```text output
["a,b","line\nbreak",""]
```

One complete cell is buffered by `cell()`. The caller can stream the surrounding record using the exported framing
strings. Cells remain text, and quoting is not spreadsheet formula protection. Applications choose whether to reject or
escape formula-like values for their export destination. Collection and streaming use `@std/csv` for field parsing. A
record-framing adapter preserves blank records, CR record endings, and exact quoted newlines. Streaming rejects
`maximumCharacters` because it is a collecting-only source limit rather than silently ignoring it.

## Parse original bytes

Use `parseBytes()` when byte encoding and the source-byte limit matter. The text path above already has decoded input;
the byte path also has to choose an encoding. Both keep `00123` as the string `'00123'` instead of guessing a number.

```ts
import * as csv from '@okikio/format/csv';

const bytes = await Deno.readFile('accounts.csv');
const document = csv.parseBytes(bytes, {
	fileName: 'accounts.csv',
	maximumBytes: 64 * 1024 * 1024,
	maximumRows: 1_000_000,
	maximumColumns: 512,
	maximumCellCharacters: 1_000_000,
});

console.log(document.encoding); // utf-8, utf-8-bom, or windows-1252
console.log(document.delimiter); // ',', ';', or '\t'
```

Options use complete words. `maximumRows` is intentional; there is no `maxRows` compatibility alias.

## Stream unknown or large input

`parseStream()` is the primary API when you do not want to retain the complete source or complete row set in memory.
This complete continuation streams the same contacts rather than materializing every row. Save it as
`import-contacts.ts` and run `mise exec -- deno run import-contacts.ts`. The awaited sink counts accepted rows; replace
it with a real write only after choosing validation and commit behavior.

```ts runnable=import-contacts.ts
import * as csv from '@okikio/format/csv';
const source = new Response('Company,Email,Note\n"Ada, Inc.",ada@example.com,"hello, world"\n').body!;
const cancel = new AbortController();
let saved = 0;

/** Validate one contact before counting its accepted write; replace this sink with an awaited real save. */
async function saveContact(email: string): Promise<void> {
	if (!email.includes('@')) throw new Error('Invalid contact email.');
	saved++;
}
try {
	await using document = await csv.parseStream(source, {
		headerRow: 1,
		maximumBytes: 64 * 1024,
		maximumRows: 100,
		maximumColumns: 3,
		maximumCellCharacters: 1024,
		headerScanRows: 1,
		maximumPeekBytes: 4096,
		signal: cancel.signal,
	});
	// Select by the parsed header key so a changed column order does not select the wrong field.
	const email = document.columns.find((column) => column.key === 'email');
	if (email === undefined) throw new Error('Missing Email column.');
	for await (const row of document.rows) {
		// Await the sink before asking for another row: a slow save limits input consumption.
		await saveContact(row.values[email.index] ?? '');
	}
	console.log('Contacts saved:', saved);
} finally {
	cancel.abort();
}
console.log('Reader released:', !source.locked);
```

```text output
Contacts saved: 1
Reader released: true
```

Each `await saveContact()` finishes before the loop requests another row. Lower `maximumBytes` to 16 to reject this source,
or change the email to `missing` to fail in application validation. Neither kind of failure rolls back earlier writes.
Stage records under an import ID and publish only after successful EOF when partial imports must stay invisible. The
abort signal stops this consumer; a real fetch source must receive the same signal. Disposal releases the document's
reader even when validation throws.

The returned `CsvStreamDocument` is one-shot. Consuming all rows or calling its `AsyncDisposable` releases the owned
reader. Attempting to iterate a second time fails rather than silently replaying or buffering the source.

## Safety limits

`textOnly: true` rejects binary signatures and non-text controls. The default text policy is permissive; choose
strict rejection when the upload contract requires text. Explicit `headerRow` selection is independent of the
automatic discovery budget.

Each growing dimension has its own bound:

| Option                  | Bounds                                        |          Default |
| ----------------------- | --------------------------------------------- | ---------------: |
| `maximumBytes`          | original byte source                          |           64 MiB |
| `maximumCharacters`     | decoded collecting source                     | 64 Mi code units |
| `maximumRows`           | emitted data rows                             |        1,000,000 |
| `maximumColumns`        | header and row width                          |              512 |
| `maximumCellCharacters` | one decoded cell                              |        1,000,000 |
| `headerScanRows`        | rows inspected for automatic header selection |               25 |
| `maximumPeekBytes`      | bytes inspected before streaming begins       |          256 KiB |

The stream parser snapshots options **before the first asynchronous source read**. Mutating the object after
`parseStream()` is called does not change an in-flight parse.

`maximumCharacters` belongs only to collecting parses because it bounds the complete decoded source retained in memory.
`parseStream()` rejects that option; streaming instead enforces `maximumBytes`, row, column, cell, and peek limits as
data flows.

## Header normalization

`normalizeHeader('\ufeff Company:Website_URL ')` returns `'company website url'`. The contact preview above uses the
corresponding normalized key to locate a column without depending on its position.

Normalization handles BOMs, Unicode normalization, camel-case word transitions, common punctuation, separators, and
repeated whitespace. It is idempotent: normalizing an already-normalized header returns the same value.

The generic parser uses normalized headers only for stable keys and structural header selection. It does **not**
classify columns as `company`, `email`, `website`, or `domain`.

## Product classification belongs above CSV

For example, a product import feature can classify parsed columns without teaching `@okikio/format/csv` about CRM
semantics:

```ts
import * as csv from '@okikio/format/csv';

const source = 'Company Domain Name,Website URL\nexample.com,https://example.com\n';
const roles = new Map(
	[
		[csv.normalizeHeader('Company Domain Name'), 'domain'],
		[csv.normalizeHeader('Website URL'), 'website'],
	] as const,
);

const document = csv.parse(source);
const columns = document.columns.map((column) => ({
	...column,
	role: roles.get(column.normalizedName) ?? 'unknown',
}));
console.log(columns.map((column) => `${column.key}: ${column.role}`).join(', '));
// company domain name: domain, website url: website
```

That separation is important. `@okikio/format/csv` remains reusable for media metadata, financial exports, scientific
data, logs, and other CSV documents that have nothing to do with account enrichment.

## What the parser owns

The collecting and streaming APIs intentionally share the same structural CSV rules. The package owns the repetitive
correctness work needed to make those rules consistent:

- source byte and decoded-data limits;
- BOM and byte-encoding detection;
- quote-aware delimiter selection;
- stable header normalization and duplicate handling;
- row, column, and cell limits;
- structural diagnostics;
- one-shot stream ownership, backpressure, and cleanup.

Applications still own domain interpretation. If a product needs a different header canonicalization policy, a different
cell type system, or CRM-specific column roles, implement that policy above `@okikio/format/csv` rather than hiding it
inside parser configuration.

## Diagnostics and failures

Recoverable observations stay in `document.diagnostics` and, where applicable, `row.diagnostics`:

- blank or duplicate headers;
- a skipped instructional preamble;
- legacy Windows-1252 fallback;
- row-width mismatches;
- spreadsheet-formula markers;
- header-only documents.

`CsvParseError` is reserved for unrecoverable structural or configured-limit failures such as malformed CSV, missing
headers, oversized input, too many columns/rows, or oversized cells.

## Tests and benchmarks

The package deliberately separates adapters:

- `headers.test.ts` checks normalization and generated idempotence properties;
- `dialect.test.ts` checks quote-aware delimiter ranking;
- `encoding.test.ts` checks BOM/line-ending/fallback behavior;
- `options.test.ts` checks deterministic option records and limits;
- `parse.test.ts` runs the representative CRM/generic fixture matrix as structural CSV data, not as product
  classification;
- `stream.test.ts` checks chunk splits, limits, one-shot disposal, and option snapshotting;
- `type.test.ts` protects the namespace API and rejects obsolete abbreviated option names;
- `parse.bench.ts` compares a 10,000-row workload against `@std/csv` structural parsing and measures the streaming path
  with 64 KiB chunks.

The benchmark baseline is there to make parser overhead visible. It is not a claim that `@std/csv` and
`@okikio/format/csv` perform identical work.

## Implementation layout

The runtime surface is split by responsibility so consumers can import only what they need and maintainers can benchmark
the hot paths independently:

- `options.ts` owns deterministic option validation and defaults;
- `headers.ts` owns header canonicalization;
- `dialect.ts` and `encoding.ts` own bounded source detection;
- `parse.ts` owns collecting composition;
- `stream.ts` owns streaming state, backpressure, and reader cleanup.

Executable tests cover malformed input, limits, option snapshotting, structural diagnostics, one-shot streaming, and
namespace typing. Benchmarks compare the collecting and streaming paths with representative `@std/csv` work so parser
overhead remains visible.

## Preserve source framing during export

`parse` and `parseBytes` now return a `dialect` with delimiter, encoding, record terminator, quoting choice and
final-newline policy. On a streamed document, `dialect` stays undefined until the row iterator reaches successful EOF.
Mixed input endings use the first observed record terminator for output; quoted cell newlines do not count as record
endings. Arbitrary source quoting and whitespace are not byte-preserved.

Use `serialize(records, dialect, limits)` from `@okikio/format/csv/write` to emit byte chunks incrementally. Supply
preamble and header records explicitly, and keep the destination unpublished until EOF. The serializer bounds bytes,
rows, cell characters and chunk size. It closes the input iterator after early return or failure, but blocked input must
cooperate with the supplied signal. Strict Windows-1252 output throws `EncodingError` for unrepresentable new text;
explicitly offer UTF-8 instead. Formula cells stay unchanged unless the caller applies `spreadsheet` to generated
presentation cells. Dialect validation uses a native Standard Schema reader. CSV does not require Zod, csv-parse, or
csv-stringify.

The [adoption guide](./04-adoption.md) contains a complete bounded read/parse/write boundary.

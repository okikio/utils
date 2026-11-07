# Format

An HTTP body or file first gives you bytes. A CSV parser turns those bytes into rows and cells; a sitemap parser finds
page addresses in its document structure. Format supplies those interpretations while preserving each source's reading,
cancellation and cleanup rules. The application still decides which contacts to save or which pages to crawl.

For Deno, Node, and Bun execution, see [run a portable example](../../docs/05-runtime.md#run-a-portable-example-in-your-own-project). Host-specific adapters keep their native runtime requirements.

| Import                   | Responsibility                                                                                       |
| ------------------------ | ---------------------------------------------------------------------------------------------------- |
| `@okikio/format/csv`     | CSV discovery, parsing, row construction and writing, with focused dialect/encoding/header subpaths. |
| `@okikio/format/sitemap` | Sitemap and sitemap-index parsing with explicit source preparation.                                  |

The root exports `csv` and `sitemap` namespaces. Both use `@okikio/streams` for reader ownership instead of maintaining
independent cancellation lifecycles. Streams remains a separate package because its operations also serve HTTP and other
formats.

Preparation releases its reader on early failure or abort. A reader lock is released before awaiting underlying
cancellation, and delayed cleanup failures are available through the cleanup result or `onCleanup` observer. Buffered
input stops between records when its owner aborts. CSV callers with a known delimiter and encoding can skip discovery.

Read the [CSV](./csv/README.md) and [Sitemap](./sitemap/README.md) guides for options and complete examples.

## Preserve a quoted CSV field

Parse one CSV record whose company name contains a comma. Quoting keeps that comma inside the name, and the parsed
header lets the application select a field without hard-coding its position.

These examples use the current experimental source checkout, not an assumed registry release. From the `utils`
repository root, review `mise.toml`, run `mise trust`, then `mise install` and `mise run prepare -- --kind deps`.
Save the following module as `example.ts` and run `mise exec -- deno run example.ts`.
[Checkout prerequisites](../../README.md#work-on-the-repository) explain installing Mise.

```ts runnable=example.ts
import * as csv from '@okikio/format/csv';
const document = csv.parse('Company,Email,Note\n"Ada, Inc.",ada@example.com,"hello, world"\n', { headerRow: 1 });
// Select by the parsed header key so a changed column order does not select the wrong field.
const email = document.columns.find((column) => column.key === 'email');
if (email === undefined) throw new Error('The contact file needs an Email column.');
console.log(document.columns.map((column) => column.key).join(','));
console.log(document.rows[0]?.values[email.index]);
```

```text output
company,email,note
ada@example.com
```

## Read a different kind of source

A sitemap can list addresses for pages on a website. The example reads one address from XML tags supplied in the
program. It does not visit that address. Save it as `focused-example.ts` and run
`mise exec -- deno run focused-example.ts` from the same checkout.

```ts runnable=focused-example.ts
import * as sitemap from '@okikio/format/sitemap';

const text = `
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://example.com/guide</loc>
  </url>
</urlset>`;
const source = { url: 'https://example.com/sitemap.xml', contentType: 'application/xml', text };
// locations() reads supplied XML. It does not fetch the page named by loc.
console.log(JSON.stringify(sitemap.locations(source)));
```

Expected output:

```text output
["https://example.com/guide"]
```

The same operation is described in the [focused guide](./sitemap/README.md), including its ownership rules and failure
behavior.

## Carry parsed input into application validation

A contact export becomes rows, while a sitemap index becomes references to more sources. Both require explicit input and
application decisions about what to do next.

Choose the focused CSV or Sitemap entry. Add Streams for bounded transport, Schema for application records, and
Scheduler for bounded asynchronous enrichment.

Parsing does not persist records, fetch linked sources, or grant crawl permission. A bounded batch does not bound a
final array that retains every result.

## Choose an entry point

Use the table to find a focused import for the job you need. Contract links open the exact public source, including its
options and types.

| Import                        | Use it to                                                                  | Exact contract                |
| ----------------------------- | -------------------------------------------------------------------------- | ----------------------------- |
| `@okikio/format/csv`          | Discover, parse, stream, and write CSV with source diagnostics.            | [Contract](./csv/mod.ts)      |
| `@okikio/format/csv/dialect`  | Inspect candidate delimiters instead of assuming every export uses commas. | [Contract](./csv/dialect.ts)  |
| `@okikio/format/csv/encoding` | Decode source bytes and retain encoding and line-ending evidence.          | [Contract](./csv/encoding.ts) |
| `@okikio/format/csv/headers`  | Normalize and inspect column names before applying application mappings.   | [Contract](./csv/headers.ts)  |
| `@okikio/format/csv/options`  | Use the CSV option normalization and validation contracts.                 | [Contract](./csv/options.ts)  |
| `@okikio/format/csv/parse`    | Parse buffered CSV records and retain diagnostics.                         | [Contract](./csv/parse.ts)    |
| `@okikio/format/csv/stream`   | Read records incrementally with budgets, cancellation, and backpressure.   | [Contract](./csv/stream.ts)   |
| `@okikio/format/csv/types`    | Import public types for this capability; this entry does not start work.   | [Contract](./csv/types.ts)    |
| `@okikio/format/csv/write`    | Serialize rows with correct CSV quoting.                                   | [Contract](./csv/write.ts)    |
| `@okikio/format/csv/source`   | Inspect and retain CSV serialization choices for later writing.                          | [Contract](./csv/source.ts)   |
| `@okikio/format/sitemap`      | Read URL sets and sitemap indexes from explicitly supplied sources.        | [Contract](./sitemap/mod.ts)  |
| `@okikio/format`              | Use the package entry shown in the complete examples above.                | [Contract](./mod.ts)          |
| `@okikio/format/csv/validate` | Validate explicitly mapped CSV columns with bounded row diagnostics.       | [Contract](./csv/validate.ts) |

Typed CSV import checks the text cells after CSV quoting has been resolved. This complete program reads one name
from a local byte stream, so it needs neither a file nor a server.
Save it as `typed-contacts.ts` and run `mise exec -- deno run typed-contacts.ts`.

```ts runnable=typed-contacts.ts
import * as csv from '@okikio/format/csv';
import { rows } from '@okikio/format/csv/validate';
import * as schema from '@okikio/schema';
const RowSchema = schema.object({ name: schema.string({ minLength: 1 }) });
const source = new Response('Name\nAda\n').body!;
// The document owns the reader even if validation fails before the loop finishes.
await using document = await csv.parseStream(source, { headerRow: 1 });
for await (
	const result of rows(RowSchema, document.rows, {
		columns: { name: 0 },
		maximumColumns: 10,
		maximumRows: 1000,
		maximumIssues: 4,
		maximumPathLength: 8,
		onInvalid: 'yield',
	})
) {
	if (result.kind === 'value') console.log(result.value.name);
	else console.log(result.row, result.kind);
}
```

```text output
Ada
```

`headerRow: 1` selects the first logical source record as headers. `columns: { name: 0 }` then maps the first
cell of each data record into the schema's `name` field. These numbers count different things: header rows start at
one, while array column positions start at zero. The row validator does not guess a mapping from a header label.

Mappings use zero-based column positions, so duplicate and blank source headers cannot select another field
accidentally. No implicit string-to-number conversion occurs. Author coercion in the schema when the wire contract
requires it. Validation runs once per mapped row, including async schemas. Missing columns produce a mapping failure;
schema rejection carries bounded issues and one-based column positions when the issue names a mapped field. Parser
syntax failures retain `CsvParseError`.

`onInvalid` explicitly chooses `throw`, `skip` or `yield`. `CsvRowError` retains the one-based logical row and category
without vendor messages. Yielded schema issues can contain source data and need the same access policy as the import.
Issue/path limits bound each returned report, not work inside a third-party validator. Input row count includes skipped
rows. Already yielded values remain partial work if later input fails. Breaking iteration closes the row source; keep
the parser document in an `await using` scope to cover failures before iteration starts. The validator does not retain a
history of rows or introduce a second dialect/encoding policy.

## Measure collecting and streaming parsers

The focused benchmarks measure CSV startup, 10,000 rows, difficult chunk boundaries and Sitemap inspection. The
benchmark compares against tested @std/csv and csv-parse tokenizers; matched row validation. Tokenizer output is not
a complete document model; collecting and streaming have different memory costs.

From the repository root, run the package's tests and untimed benchmark checks before collecting timings:

```sh
deno task --cwd=packages/format test
deno task --cwd=packages/format bench:check
deno task --cwd=packages/format bench
```

These commands use package-owned fixtures and development dependencies. The
[benchmark protocol](../../docs/benchmarks/01-running.md#choose-a-comparison-that-answers-the-question) explains fair
comparisons, raw report collection and the limits of local measurements.

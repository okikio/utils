# Keep source bytes distinct from interpreted rows

Suppose a contact file contains `"Ada, Inc."` in its Company column. If you split the text at every comma,
you get two cells instead of one company name. A quoted cell can contain a line break too. The CSV parser keeps
both the comma and the line break inside the cell.

You choose which row contains the column names, or let the parser look for one. The parser returns each cell as
text. Your application decides what the columns mean, whether an email address is valid, and whether to convert
a value such as `00123` to a number. For a large file, you can read one row at a time.

## Read a contact by its column name

The example tells the parser that row 1 contains the column names. It finds `Email` by name and uses the
column's index to read the address. If the file moves that column, the lookup still finds it.

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

When you show a validation error, give the reader the record number from `row.row`. The count starts at 1 and
includes the header and any blank records. It counts complete CSV records. A quoted cell can span several lines in
a text editor and still belong to one record.

Set `preserveBlankRows: true` if you also want blank records in the result. Use `rawHeader` when you need to show
the original header text, including spaces. Use the normalized key when you need to look up the column.

Save this separate program as `contact-positions.ts` and run `mise exec -- deno run contact-positions.ts`. It prints
the original header text, then the number and label of each record, including the blank one.

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

Use `cell()` to turn one string into a CSV cell. It adds quotes where needed. Join the cells with `comma` and
end each record with `recordEnd`. This example reads the result back to show that both special characters
survive.

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

`cell()` holds one complete cell in memory while it adds any quotes. You can write each encoded cell and separator
to your destination as you go. If someone opens the file in a spreadsheet, the spreadsheet may still run a cell
as a formula. Decide whether to reject or escape those values before you export the file.

## Parse original bytes

Use `parse()` when you already have a JavaScript string. Use `parseBytes()` when you have the original file
bytes and need to limit their size. The parser first chooses how to turn those bytes into text. Both calls keep
`00123` as text, so the leading zeros stay in the result.

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

Use `parseStream()` to read rows as they arrive, without collecting the whole file or keeping all the parsed rows.
Save the example as `import-contacts.ts` and run `mise exec -- deno run import-contacts.ts`. It reads the same contact
as before, checks the email address, and counts one accepted row. To save to a real database, replace the counter
with a write and decide when those writes should become visible.

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

The loop waits for `saveContact()` before it asks for the next row. Set `maximumBytes` to 16 to make the parser reject
the file. Change the email to `missing` to make the application reject the row. If you already wrote earlier rows,
neither error undoes those writes. To hide a partial import, save rows under an import ID and publish them only
after reading the whole file successfully.

Pass the same abort signal to `fetch()` if the rows come from a network response. This lets cancellation reach both
the parser and the network request. The document lets you read its rows once. When you finish reading, it releases
the reader. The `await using` block also releases it if you leave early or validation throws. To read the rows again,
open a new source.

## Safety limits

Set `textOnly: true` when the upload must be text. The parser then rejects known binary file markers and control
characters it does not accept as text. By default, the parser skips these extra checks. If you pass `headerRow`, it
uses that row number rather than looking for a header within `headerScanRows`.

Set a limit on each part that can grow:

| Option                  | Bounds                                        |          Default |
| ----------------------- | --------------------------------------------- | ---------------: |
| `maximumBytes`          | original byte source                          |           64 MiB |
| `maximumCharacters`     | decoded collecting source                     | 64 Mi code units |
| `maximumRows`           | emitted data rows                             |        1,000,000 |
| `maximumColumns`        | header and row width                          |              512 |
| `maximumCellCharacters` | one decoded cell                              |        1,000,000 |
| `headerScanRows`        | rows inspected for automatic header selection |               25 |
| `maximumPeekBytes`      | bytes inspected before streaming begins       |          256 KiB |

`parseStream()` copies its settings before it starts reading. If you change the options object later, the current
parse still uses the original settings.

Use `maximumCharacters` with `parse()` or `parseBytes()` to limit the length of the full decoded text. The stream
parser does not keep that full text, so it rejects this option. It still limits bytes, rows, columns, cell length,
and how much input it can inspect before streaming begins.

## Header normalization

`normalizeHeader('\ufeff Company:Website_URL ')` returns `'company website url'`. The contact preview above uses the
corresponding normalized key to locate a column without depending on its position.

The function removes a leading byte order mark (BOM), puts Unicode text into a consistent form, and separates words
at camel-case boundaries or common punctuation. It also trims and combines spaces. Calling it again on the result
returns the same key.

The parser uses the cleaned names to make keys and help find the header row. It does not know whether a column
contains company names, email addresses, websites, or domains. Your application makes that decision.

## Product classification belongs above CSV

This contact importer assigns a role to each column. It maps two known names to `domain` and `website`. If it does
not recognize a name, it uses `unknown`.

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

The same parser can read a financial export or a log because it does not assume that those files contain contacts.
Each application can use different column names and rules.

## What the parser owns

Whether you read a whole file or stream it, the parser finds the same cells. It uses `@std/csv` to read fields and
check their quotes. Utils finds the record boundaries before handing the records to that parser. This lets Utils
count blank records, accept a lone carriage return as a record ending, and restore the original line breaks inside
quoted cells.

The parser also checks the input limits, gives duplicate header names distinct keys, and reports problems it can
read past. When you stream rows, it slows its reads as the consumer slows down and releases the reader when you finish.
Handle any custom header names, value conversions, or contact rules in the code that uses the parsed rows.

## Diagnostics and failures

When the parser can keep going, it reports what it found in `document.diagnostics` or in the affected row's
`diagnostics`. You can show these notes in an import preview:

- blank or duplicate headers;
- a skipped instructional preamble;
- legacy Windows-1252 fallback;
- row-width mismatches;
- spreadsheet-formula markers;
- header-only documents.

The parser throws `CsvParseError` if it cannot read the CSV, find a usable header, or stay within the configured
limits. For example, a malformed quote or a cell that is too long can stop the parse.

## Tests and benchmarks

Choose the test that covers the behavior you changed:

- `headers.test.ts` checks that cleaning a header twice gives the same result as cleaning it once.
- `dialect.test.ts` checks that commas inside quotes do not count when choosing a separator.
- `encoding.test.ts` checks byte order marks, line endings, and the fallback encoding.
- `options.test.ts` checks the option values and limits.
- `parse.test.ts` checks how the parser reads contact files and other sample CSV files.
- `stream.test.ts` checks that the parser handles records split across chunks, enforces limits, releases the reader,
  and ignores changes to options after reading begins.
- `types.test.ts` checks namespace imports and rejects obsolete abbreviated option names.

The [CSV benchmark](../packages/format/csv.bench.ts) uses 10,000 rows to compare parsing with `@std/csv` and
measures the streaming path with 64 KiB chunks. Compare the times with the extra work Utils does in mind,
including its limits, header processing, and diagnostics.

## Implementation layout

Start with `parse.ts` for a file that is already in memory, or `stream.ts` for rows read from a stream.
Both use `records.ts` to find record boundaries and read fields. Look in `options.ts` for limits and defaults,
`headers.ts` for changes to column names, and `dialect.ts` and `encoding.ts` for how the parser chooses a separator
and decodes the source.

## Preserve source framing during export

Use the returned `dialect` when a new export should follow the source file's format. It describes the encoding,
the separators between cells and records, whether every cell was quoted, and whether the file ended with a line
break. When you stream rows, this information is available only after you finish reading them successfully.

If the source mixes different record endings, the writer uses the first one it found outside a quoted cell.
Writing the same values back can still change how individual cells are quoted or spaced. Keep the original bytes
if you need an exact copy.

Call `serialize(records, dialect, limits)` from `@okikio/format/csv/write` to write the file in chunks. Include any
introductory records and the header yourself. Keep the new file private until the writer finishes successfully.
The writer limits the total bytes, number of records, length of each cell, and size of each chunk.

If writing fails or you stop early, the writer closes the input iterator. If that iterator is waiting for another
record, it must observe the supplied signal to stop the wait. If new text cannot be written in Windows-1252,
the writer throws `EncodingError`. Offer UTF-8 if the user needs to export those characters.

The writer leaves formula-like cells unchanged. Apply `spreadsheet` to generated cells for spreadsheet display
when you want that protection. `CsvDialectSchema` checks the format settings with Standard Schema; you do not
need to install Zod, csv-parse, or csv-stringify.

The [adoption guide](./04-adoption.md) contains a complete bounded read/parse/write boundary.

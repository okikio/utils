# @okikio/csv contracts

[Start with the examples](README.md). This generated reference lists every public import path, then prints its exported
functions, types, fields and declaration explanations.

The blocks use Deno's documentation notation, not implementation code to paste into an application. The
[structured contracts](API.json) preserve the full renderer model, including overloads, method type parameters and
documentation tags. The linked source defines runtime behavior; the guide explains ownership, cancellation, defaults and
use cases. Supporting private types can appear in the renderer model; their presence does not make them public imports.

Regenerate with `deno task docs:api`; verify with `deno task docs:api:check`. For a searchable HTML reference, run
`deno task docs:html`.

## Public imports

| Import                 | Source                         | Reference             |
| ---------------------- | ------------------------------ | --------------------- |
| `@okikio/csv`          | [./mod.ts](./mod.ts)           | [root](#root)         |
| `@okikio/csv/dialect`  | [./dialect.ts](./dialect.ts)   | [dialect](#dialect)   |
| `@okikio/csv/encoding` | [./encoding.ts](./encoding.ts) | [encoding](#encoding) |
| `@okikio/csv/headers`  | [./headers.ts](./headers.ts)   | [headers](#headers)   |
| `@okikio/csv/options`  | [./options.ts](./options.ts)   | [options](#options)   |
| `@okikio/csv/parse`    | [./parse.ts](./parse.ts)       | [parse](#parse)       |
| `@okikio/csv/stream`   | [./stream.ts](./stream.ts)     | [stream](#stream)     |
| `@okikio/csv/types`    | [./types.ts](./types.ts)       | [types](#types)       |
| `@okikio/csv/write`    | [./write.ts](./write.ts)       | [write](#write)       |

## root

Import `@okikio/csv`. [Source](./mod.ts).

Turn a messy spreadsheet export into bounded text rows with header evidence and diagnostics. Splitting on commas loses
quoted commas, multiline cells, duplicate headers and byte-encoding errors.

Collect small bounded input with parseBytes(); use parseStream() and fold rows for a large import. Explicit headers
avoid guessing when an upstream format is known. preserveBlankRows keeps empty source occurrences when reconciliation
depends on row positions; textOnly opts into rejecting non-text input. Cells remain text, including formula-like
content. Applications decide whether to reject formulas when exporting to a spreadsheet and whether diagnostics should
stop an import. Disposal releases a one-shot stream reader.

### root: CsvColumn

[Declaration source](mod.ts#L22)

```text
reference CsvColumn: ./packages/csv/types.ts:34:1
```

### root: CsvDelimiter

[Declaration source](mod.ts#L23)

```text
reference CsvDelimiter: ./packages/csv/types.ts:1:1
```

### root: CsvDiagnostic

[Declaration source](mod.ts#L24)

```text
reference CsvDiagnostic: ./packages/csv/types.ts:20:1
```

### root: CsvDiagnosticCode

[Declaration source](mod.ts#L25)

```text
reference CsvDiagnosticCode: ./packages/csv/types.ts:10:1
```

### root: CsvDocument

[Declaration source](mod.ts#L26)

```text
reference CsvDocument: ./packages/csv/types.ts:58:1
```

### root: CsvEncoding

[Declaration source](mod.ts#L27)

```text
reference CsvEncoding: ./packages/csv/types.ts:4:1
```

### root: CsvLineEnding

[Declaration source](mod.ts#L28)

```text
reference CsvLineEnding: ./packages/csv/types.ts:7:1
```

### root: CsvParseError

[Declaration source](mod.ts#L20)

```text
reference CsvParseError: ./packages/csv/types.ts:119:1
```

### root: CsvParseOptions

[Declaration source](mod.ts#L29)

```text
reference CsvParseOptions: ./packages/csv/types.ts:80:1
```

### root: CsvRow

[Declaration source](mod.ts#L30)

```text
reference CsvRow: ./packages/csv/types.ts:48:1
```

### root: CsvStreamDocument

[Declaration source](mod.ts#L31)

```text
reference CsvStreamDocument: ./packages/csv/types.ts:162:1
```

### root: CsvStreamMetadata

[Declaration source](mod.ts#L32)

```text
reference CsvStreamMetadata: ./packages/csv/types.ts:144:1
```

### root: CsvStreamOptions

[Declaration source](mod.ts#L33)

```text
reference CsvStreamOptions: ./packages/csv/types.ts:173:1
```

### root: normalizeHeader

[Declaration source](mod.ts#L17)

```text
reference normalizeHeader: ./packages/csv/headers.ts:1:1
```

### root: parse

[Declaration source](mod.ts#L18)

```text
reference parse: ./packages/csv/parse.ts:191:1
```

### root: parseBytes

[Declaration source](mod.ts#L18)

```text
reference parseBytes: ./packages/csv/parse.ts:197:1
```

### root: parseStream

[Declaration source](mod.ts#L19)

```text
reference parseStream: ./packages/csv/stream.ts:216:1
```

## dialect

Import `@okikio/csv/dialect`. [Source](./dialect.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding | Contract owner or source |
| ---------------- | ------------------------ |
| `CsvDelimiter`   | [Source](types.ts)       |

### dialect: rank

[Declaration source](dialect.ts#L58)

```text
function rank(text: string): readonly CsvDelimiter[]
  Ranks supported delimiters using a quote-aware bounded source sample.
```

## encoding

Import `@okikio/csv/encoding`. [Source](./encoding.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding  | Contract owner or source |
| ----------------- | ------------------------ |
| `CsvDiagnostic`   | [Source](types.ts)       |
| `CsvEncoding`     | [Source](types.ts)       |
| `CsvLineEnding`   | [Source](types.ts)       |
| `CsvParseOptions` | [Source](types.ts)       |

### encoding: decodeBytes

[Declaration source](encoding.ts#L47)

```text
function decodeBytes(bytes: Uint8Array, encoding: NonNullable<CsvParseOptions["encoding"]>, partial: boolean): DecodedCsvSource
  Decodes original bytes while preserving whether a legacy fallback was required.
```

### encoding: decodeText

[Declaration source](encoding.ts#L83)

```text
function decodeText(text: string): DecodedCsvSource
  Wraps caller-decoded text in the same source contract as byte input.
```

### encoding: DecodedCsvSource

[Declaration source](encoding.ts#L5)

```text
interface DecodedCsvSource
  Decoded source plus metadata required by the structural parser.

  text: string
    Decoded source text retained for CSV dialect and record parsing.
  encoding: CsvEncoding
    Selected source encoding, or automatic detection where the options allow it.
  lineEnding: CsvLineEnding
    Observed line-ending style retained in source metadata.
  diagnostics: readonly CsvDiagnostic[]
    Structured decode or parse observations retained for the caller.
```

## headers

Import `@okikio/csv/headers`. [Source](./headers.ts).

### headers: normalizeHeader

[Declaration source](headers.ts#L1)

```text
function normalizeHeader(header: string): string
  Normalize one source header into a stable matching/key form.
```

## options

Import `@okikio/csv/options`. [Source](./options.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding   | Contract owner or source             |
| ------------------ | ------------------------------------ |
| `record`           | [record contracts](../record/API.md) |
| `CsvDelimiter`     | [Source](types.ts)                   |
| `CsvEncoding`      | [Source](types.ts)                   |
| `CsvParseOptions`  | [Source](types.ts)                   |
| `CsvStreamOptions` | [Source](types.ts)                   |

### options: parse

[Declaration source](options.ts#L148)

```text
function parse(options: CsvParseOptions): ResolvedCsvOptions
  Normalize collecting parse policy before any source data is inspected.
```

### options: stream

[Declaration source](options.ts#L153)

```text
function stream(options: CsvStreamOptions): ResolvedCsvStreamOptions
  Normalize streaming parse policy before the first asynchronous source read.
```

### options: ResolvedCsvOptions

[Declaration source](options.ts#L35)

```text
interface ResolvedCsvOptions
  Resolved collecting-parser options after defaults, limits, and unknown-key validation are applied.

  readonly fileName?: string
    Optional caller-supplied source name retained as document metadata.
  readonly textOnly: boolean
    Reject recognized binary signatures and non-text controls; also bound header-cell text.
  readonly delimiter: CsvDelimiter | "auto"
    Explicit CSV delimiter or automatic dialect detection.
  readonly headerRow: number | "auto"
    One-based logical header row or automatic header discovery.
  readonly encoding: "auto" | Exclude<CsvEncoding, "utf-8-bom">
    Selected source encoding, or automatic detection where the options allow it.
  readonly maximumBytes: number
    Maximum input byte budget admitted by CSV parsing.
  readonly maximumCharacters: number
    Maximum decoded text size admitted by collecting parsing; streaming uses byte and cell limits.
  readonly maximumRows: number
    Maximum logical rows admitted by CSV parsing.
  readonly maximumColumns: number
    Maximum cells admitted in one logical CSV row.
  readonly maximumCellCharacters: number
    Maximum decoded characters retained for one CSV cell.
  readonly headerScanRows: number
    Maximum prefix rows inspected for automatic header discovery.
  readonly preserveBlankRows: boolean
    Retain blank logical source records instead of dropping them.
```

### options: ResolvedCsvStreamOptions

[Declaration source](options.ts#L63)

```text
interface ResolvedCsvStreamOptions extends Omit<ResolvedCsvOptions, "maximumCharacters">
  Resolved streaming-parser options, including the bounded prefix used before streaming continues.

  readonly maximumPeekBytes: number
    Maximum source prefix retained before streaming encoding, dialect and header selection.
```

## parse

Import `@okikio/csv/parse`. [Source](./parse.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding       | Contract owner or source |
| ---------------------- | ------------------------ |
| `buildColumns`         | [Source](structure.ts)   |
| `isBlankRow`           | [Source](structure.ts)   |
| `selectHeader`         | [Source](structure.ts)   |
| `assertTextCharacters` | [Source](content.ts)     |
| `assertTextSource`     | [Source](content.ts)     |
| `parseCsvRecords`      | [Source](records.ts)     |
| `rank`                 | [Source](dialect.ts)     |
| `DecodedCsvSource`     | [Source](encoding.ts)    |
| `decodeBytes`          | [Source](encoding.ts)    |
| `decodeText`           | [Source](encoding.ts)    |
| `options`              | [Source](options.ts)     |
| `ResolvedCsvOptions`   | [Source](options.ts)     |
| `CsvDelimiter`         | [Source](types.ts)       |
| `CsvDiagnostic`        | [Source](types.ts)       |
| `CsvDocument`          | [Source](types.ts)       |
| `CsvParseOptions`      | [Source](types.ts)       |
| `CsvRow`               | [Source](types.ts)       |
| `CsvParseError`        | [Source](types.ts)       |

### parse: parse

[Declaration source](parse.ts#L191)

````text
function parse(text: string, opts: CsvParseOptions): CsvDocument
  Parses decoded CSV text without coercing identifiers, dates, numbers, or formulas.

  @example
      ```ts
      const document = csv.parse('Company,Website\nNorthstar,https://northstar.example')
      console.log(document.columns[1]?.normalizedName) // "website"
      ```
````

### parse: parseBytes

[Declaration source](parse.ts#L197)

```text
function parseBytes(bytes: Uint8Array, opts: CsvParseOptions): CsvDocument
  Parses original CSV bytes with strict UTF-8 detection and bounded structural limits.
```

## stream

Import `@okikio/csv/stream`. [Source](./stream.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding       | Contract owner or source |
| ---------------------- | ------------------------ |
| `buildColumns`         | [Source](structure.ts)   |
| `isBlankRow`           | [Source](structure.ts)   |
| `selectHeader`         | [Source](structure.ts)   |
| `recordStream`         | [Source](records.ts)     |
| `rank`                 | [Source](dialect.ts)     |
| `assertTextCharacters` | [Source](content.ts)     |
| `assertTextSource`     | [Source](content.ts)     |
| `DecodedCsvSource`     | [Source](encoding.ts)    |
| `decodeBytes`          | [Source](encoding.ts)    |
| `options`              | [Source](options.ts)     |
| `CsvColumn`            | [Source](types.ts)       |
| `CsvDiagnostic`        | [Source](types.ts)       |
| `CsvRow`               | [Source](types.ts)       |
| `CsvStreamDocument`    | [Source](types.ts)       |
| `CsvStreamOptions`     | [Source](types.ts)       |
| `CsvParseError`        | [Source](types.ts)       |

### stream: parseStream

[Declaration source](stream.ts#L216)

```text
async function parseStream(source: ReadableStream<Uint8Array>, opts: CsvStreamOptions): Promise<CsvStreamDocument>
  Parse a byte stream into one owned, one-shot, backpressure-aware CSV stream.

  The returned document must be consumed or disposed. Source bytes, rows,
  columns, and cells are bounded by explicit limits.
```

## types

Import `@okikio/csv/types`. [Source](./types.ts).

### types: CsvParseError

[Declaration source](types.ts#L119)

```text
class CsvParseError extends Error
  Stable unrecoverable parse error.

  constructor(code: CsvParseErrorCode, message: string, row?: number, column?: number, options?: ErrorOptions)
    Create this CsvParseError from the explicit contract values supplied by its caller.
  readonly code: CsvParseErrorCode
    Machine-readable failure code.
  readonly row?: number
    One-based row related to the failure, when known.
  readonly column?: number
    One-based column related to the failure, when known.
```

### types: CsvColumn

[Declaration source](types.ts#L34)

```text
interface CsvColumn
  One normalized source column.

  index: number
    Zero-based position in each row.
  name: string
    Original trimmed header, or a generated display label for a blank header.
  rawHeader?: string
    Exact decoded header, including whitespace and blank/duplicate text. Older persisted parser snapshots may omit it.
  key: string
    Stable unique key generated from the normalized header.
  normalizedName: string
    Normalized header used for matching.
```

### types: CsvDiagnostic

[Declaration source](types.ts#L20)

```text
interface CsvDiagnostic
  Recoverable parser observation suitable for an import preview.

  code: CsvDiagnosticCode
    Stable machine-readable warning code.
  message: string
    Human-readable explanation.
  row?: number
    One-based logical row when the warning belongs to a record.
  column?: number
    One-based column when the warning belongs to a field.
  header?: string
    Original header when one is available.
```

### types: CsvDocument

[Declaration source](types.ts#L58)

```text
interface CsvDocument
  Structurally parsed CSV document before domain extraction.

  fileName?: string
    Optional caller-supplied source name.
  encoding: CsvEncoding
    Encoding used for byte decoding.
  delimiter: CsvDelimiter
    Selected delimiter.
  lineEnding: CsvLineEnding
    Observed line-ending style.
  headerRow: number
    One-based logical row selected as the header.
  columns: readonly CsvColumn[]
    Parsed columns in source order.
  rows: readonly CsvRow[]
    Non-empty data rows after the header.
  preamble: readonly (readonly string[])[]
    Logical records skipped before the selected header.
  diagnostics: readonly CsvDiagnostic[]
    Recoverable input observations.
```

### types: CsvParseOptions

[Declaration source](types.ts#L80)

```text
interface CsvParseOptions
  Caller-controlled parser behavior and safety limits.

  fileName?: string
    Optional source name included in the returned document.
  textOnly?: boolean
    Reject known binary signatures and non-text controls; also bound header cells. @default false
  delimiter?: CsvDelimiter | "auto"
    Force a delimiter or use automatic dialect detection. @default 'auto'
  headerRow?: number | "auto"
    Force a one-based header row or detect it automatically. @default 'auto'
  encoding?: "auto" | Exclude<CsvEncoding, "utf-8-bom">
    Force byte decoding or detect UTF-8 with a Windows-1252 fallback. @default 'auto'
  maximumBytes?: number
    Maximum accepted source bytes for `csv.parseBytes`. @default 67108864
  maximumCharacters?: number
    Maximum accepted decoded UTF-16 code units. @default 67108864
  maximumRows?: number
    Maximum accepted data rows. @default 1000000
  maximumColumns?: number
    Maximum accepted source columns. @default 512
  maximumCellCharacters?: number
    Maximum accepted UTF-16 code units in one cell. @default 1000000
  headerScanRows?: number
    Maximum records inspected during automatic header selection. @default 25
  preserveBlankRows?: boolean
    Keep all-empty logical data records as source occurrences. @default false
```

### types: CsvRow

[Declaration source](types.ts#L48)

```text
interface CsvRow
  One logical data row after the selected header.

  row: number
    One-based logical record number from the CSV document.
  values: readonly string[]
    Uncoerced source values.
  diagnostics: readonly CsvDiagnostic[]
    Recoverable observations attached to this logical row.
```

### types: CsvStreamDocument

[Declaration source](types.ts#L162)

```text
interface CsvStreamDocument extends CsvStreamMetadata, AsyncDisposable
  One-shot, backpressure-aware CSV document.

  rows: AsyncIterable<CsvRow>
    Logical data rows produced as the consumer requests them.

    The iterable is intentionally one-shot because replaying a network or file
    stream would require buffering the complete source.
```

### types: CsvStreamMetadata

[Declaration source](types.ts#L144)

```text
interface CsvStreamMetadata
  Metadata resolved before streamed data rows are consumed.

  fileName?: string
    Optional caller-supplied source name.
  encoding: CsvEncoding
    Encoding used to decode the byte stream.
  delimiter: CsvDelimiter
    Selected field delimiter.
  headerRow: number
    One-based logical record selected as the header.
  columns: readonly CsvColumn[]
    Parsed columns in source order.
  preamble: readonly (readonly string[])[]
    Logical records skipped before the selected header.
  diagnostics: readonly CsvDiagnostic[]
    Recoverable observations discovered before row streaming begins.
```

### types: CsvStreamOptions

[Declaration source](types.ts#L173)

```text
interface CsvStreamOptions extends Omit<CsvParseOptions, "maximumCharacters">
  Streaming parser behavior and bounded discovery limits.

  maximumPeekBytes?: number
    Maximum bytes read while detecting encoding and delimiter. @default 262144
```

### types: CsvDelimiter

[Declaration source](types.ts#L1)

```text
type CsvDelimiter = "," | ";" | "	"
  Delimiters supported by the CSV parser.
```

### types: CsvDiagnosticCode

[Declaration source](types.ts#L10)

```text
type CsvDiagnosticCode = "blank-header" | "duplicate-header" | "header-only" | "legacy-encoding" | "preamble-skipped" | "row-width-mismatch" | "spreadsheet-formula"
  Supported warning codes emitted for recoverable input conditions.
```

### types: CsvEncoding

[Declaration source](types.ts#L4)

```text
type CsvEncoding = "utf-8" | "utf-8-bom" | "windows-1252"
  Byte decoding selected for the source file.
```

### types: CsvLineEnding

[Declaration source](types.ts#L7)

```text
type CsvLineEnding = "crlf" | "lf" | "cr" | "mixed" | "none"
  Line-ending style observed after decoding.
```

### types: CsvParseErrorCode

[Declaration source](types.ts#L108)

```text
type CsvParseErrorCode = "cell-too-large" | "empty-file" | "invalid-csv" | "invalid-header-row" | "missing-header" | "source-too-large" | "too-many-columns" | "too-many-rows"
  Stable machine-readable parse failure codes.
```

## write

Import `@okikio/csv/write`. [Source](./write.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding | Contract owner or source                            |
| ---------------- | --------------------------------------------------- |
| `stringify`      | External declaration: `csv-stringify/lib/sync.d.ts` |

### write: cell

[Declaration source](write.ts#L3)

```text
function cell(value: string): string
  Encode one complete scalar with the maintained CSV writer, without buffering its surrounding record.
```

### write: comma

[Declaration source](write.ts#L8)

```text
const comma: ","
  Record framing stays separate so arbitrarily wide records need only one complete cell in memory.
```

### write: recordEnd

[Declaration source](write.ts#L10)

```text
const recordEnd: "
"
  CRLF record terminator for separately framed CSV output.
```

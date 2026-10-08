# @okikio/query contracts

[Start with the examples](README.md). This generated reference lists every public import path, then prints its exported
functions, types, fields and declaration explanations.

The blocks use Deno's documentation notation, not implementation code to paste into an application. The
[structured contracts](API.json) preserve the full renderer model, including overloads, method type parameters and
documentation tags. The linked source defines runtime behavior; the guide explains ownership, cancellation, defaults and
use cases. Supporting private types can appear in the renderer model; their presence does not make them public imports.

Regenerate with `deno task docs:api`; verify with `deno task docs:api:check`. For a searchable HTML reference, run
`deno task docs:html`.

## Public imports

| Import                     | Source                             | Reference                 |
| -------------------------- | ---------------------------------- | ------------------------- |
| `@okikio/query`            | [./mod.ts](./mod.ts)               | [root](#root)             |
| `@okikio/query/definition` | [./definition.ts](./definition.ts) | [definition](#definition) |
| `@okikio/query/operators`  | [./operators.ts](./operators.ts)   | [operators](#operators)   |
| `@okikio/query/types`      | [./types.ts](./types.ts)           | [types](#types)           |

## root

Import `@okikio/query`. [Source](./mod.ts).

Declare an HTTP collection query once and validate its filter, sort, selection and pagination grammar before reaching a
database. Parsing strings directly into SQL makes hidden fields, unsupported operators and ambiguous list values easy to
accept.

Start with flat filters, enable bounded all/any/not groups when the provider supports them, and encode values for
lossless URL round trips. The tagged wire codec preserves commas, empty text, bigint, dates and negative zero.
normalize() produces canonical query data; it does not run a query. Adapters must explicitly declare capabilities and
fail closed for unsupported groups. Preserve opaque cursors with a trusted codec rather than interpreting arbitrary
client strings.

### root: inspect

[Declaration source](normalize.ts#L87)

```text
function inspect<Fields extends QueryFields>(value: QueryValue<Fields>): QueryInspection<Fields>
  Inspect authored order and a separate normalized projection.
```

### root: inspectExpression

[Declaration source](expression.ts#L50)

```text
function inspectExpression<Leaf>(value: QueryExpression<Leaf>, isLeaf: QueryExpressionLeafPredicate<Leaf>, onLeaf?: (visit: QueryExpressionLeafVisit<Leaf>) => void): QueryExpressionInspection
  Inspect one Boolean expression and optionally visit each leaf.

  This helper deliberately knows nothing about fields, operators, Facts, Lists,
  or storage. Domain packages keep those semantics and can use the visit path
  for precise validation errors.
```

### root: normalize

[Declaration source](normalize.ts#L55)

```text
function normalize<Fields extends QueryFields>(value: QueryValue<Fields>): QueryValue<Fields>
  Canonical semantics; the input's authored expression and field order stay intact.
```

### root: stringify

[Declaration source](url.ts#L251)

```text
function stringify<Fields extends QueryFields>(definition: QueryDefinition<Fields>, value: QueryValue<Fields>): string
  Canonical collection URL identity, independent of authored conjunction order.
```

### root: QueryExpressionInspection

[Declaration source](expression.ts#L31)

```text
interface QueryExpressionInspection
  Bounded structural measurements for one Boolean expression.

  readonly maximumDepth: number
    Maximum expression depth including leaf nodes.
  readonly leafCount: number
    Number of domain-owned leaves observed in the expression.
  readonly maximumSiblings: number
    Maximum immediate children observed or admitted in a Boolean group.
```

### root: QueryExpressionLeafVisit

[Declaration source](expression.ts#L19)

```text
interface QueryExpressionLeafVisit<Leaf>
  Information supplied while visiting one leaf in an expression.

  readonly leaf: Leaf
    Domain-owned leaf visited within a generic Boolean expression.
  readonly path: QueryExpressionPath
    Source, route or expression path used to locate this value.
  readonly depth: number
    Depth of this leaf, including the root node.
  readonly index: number
    Zero-based position in the authored sequence.
```

### root: QueryBooleanExpression

[Declaration source](expression.ts#L1)

```text
type QueryBooleanExpression<Leaf> = Readonly<{ kind: "all"; filters: readonly QueryExpression<Leaf>[]; }> | Readonly<{ kind: "any"; filters: readonly QueryExpression<Leaf>[]; }> | Readonly<{ kind: "not"; filter: QueryExpression<Leaf>; }>
  One reusable Boolean node around a domain-owned query leaf.
```

### root: QueryExpression

[Declaration source](expression.ts#L13)

```text
type QueryExpression<Leaf> = Leaf | QueryBooleanExpression<Leaf>
  Generic Boolean composition over a domain-owned query leaf.

  The leaf keeps its own business meaning and does not need a particular shape.
  This utility owns only the reusable ALL / ANY / NOT expression mechanics so
  products do not invent parallel Boolean languages.
```

### root: QueryExpressionLeafPredicate

[Declaration source](expression.ts#L41)

```text
type QueryExpressionLeafPredicate<Leaf> = (value: QueryExpression<Leaf>) => value is Leaf
  Runtime predicate that distinguishes the domain-owned leaf from Boolean nodes.
```

### root: QueryExpressionPath

[Declaration source](expression.ts#L16)

```text
type QueryExpressionPath = readonly PropertyKey[]
  Path from the expression root to one domain-owned leaf.
```

### root: CursorCodec

[Declaration source](mod.ts#L61)

```text
reference CursorCodec: ./packages/query/types.ts:443:1
```

### root: CursorPagination

[Declaration source](mod.ts#L62)

```text
reference CursorPagination: ./packages/query/types.ts:318:1
```

### root: CursorPaginationDefinition

[Declaration source](mod.ts#L63)

```text
reference CursorPaginationDefinition: ./packages/query/types.ts:114:1
```

### root: CursorPaginationOptions

[Declaration source](mod.ts#L64)

```text
reference CursorPaginationOptions: ./packages/query/types.ts:172:1
```

### root: CursorPaginationParameters

[Declaration source](mod.ts#L65)

```text
reference CursorPaginationParameters: ./packages/query/types.ts:94:1
```

### root: OffsetPagination

[Declaration source](mod.ts#L66)

```text
reference OffsetPagination: ./packages/query/types.ts:328:1
```

### root: OffsetPaginationDefinition

[Declaration source](mod.ts#L67)

```text
reference OffsetPaginationDefinition: ./packages/query/types.ts:132:1
```

### root: OffsetPaginationOptions

[Declaration source](mod.ts#L68)

```text
reference OffsetPaginationOptions: ./packages/query/types.ts:186:1
```

### root: OffsetPaginationParameters

[Declaration source](mod.ts#L69)

```text
reference OffsetPaginationParameters: ./packages/query/types.ts:102:1
```

### root: PaginationModesDefinition

[Declaration source](mod.ts#L70)

```text
reference PaginationModesDefinition: ./packages/query/types.ts:152:1
```

### root: PaginationModesOptions

[Declaration source](mod.ts#L71)

```text
reference PaginationModesOptions: ./packages/query/types.ts:202:1
```

### root: QueryAdapterCapabilities

[Declaration source](mod.ts#L72)

```text
reference QueryAdapterCapabilities: ./packages/query/types.ts:409:1
```

### root: QueryAdapterIssue

[Declaration source](mod.ts#L73)

```text
reference QueryAdapterIssue: ./packages/query/types.ts:423:1
```

### root: QueryAdapterValidationResult

[Declaration source](mod.ts#L74)

```text
reference QueryAdapterValidationResult: ./packages/query/types.ts:436:1
```

### root: QueryDefinition

[Declaration source](mod.ts#L75)

```text
reference QueryDefinition: ./packages/query/types.ts:451:1
```

### root: QueryDefinitionInput

[Declaration source](mod.ts#L76)

```text
reference QueryDefinitionInput: ./packages/query/types.ts:226:1
```

### root: QueryDocument

[Declaration source](mod.ts#L77)

```text
reference QueryDocument: ./packages/query/types.ts:519:1
```

### root: QueryExpressionKind

[Declaration source](mod.ts#L78)

```text
reference QueryExpressionKind: ./packages/query/types.ts:76:1
```

### root: QueryField

[Declaration source](mod.ts#L79)

```text
reference QueryField: ./packages/query/types.ts:5:1
```

### root: QueryFieldOptions

[Declaration source](mod.ts#L80)

```text
reference QueryFieldOptions: ./packages/query/types.ts:21:1
```

### root: QueryFieldSelection

[Declaration source](mod.ts#L82)

```text
reference QueryFieldSelection: ./packages/query/types.ts:313:1
```

### root: QueryFieldValue

[Declaration source](mod.ts#L86)

```text
reference QueryFieldValue: ./packages/query/types.ts:36:1
```

### root: QueryFields

[Declaration source](mod.ts#L81)

```text
reference QueryFields: ./packages/query/types.ts:33:1
```

### root: QueryFieldsetDefinition

[Declaration source](mod.ts#L83)

```text
reference QueryFieldsetDefinition: ./packages/query/types.ts:212:1
```

### root: QueryFieldsetInput

[Declaration source](mod.ts#L84)

```text
reference QueryFieldsetInput: ./packages/query/types.ts:220:1
```

### root: QueryFieldsets

[Declaration source](mod.ts#L85)

```text
reference QueryFieldsets: ./packages/query/types.ts:223:1
```

### root: QueryFilter

[Declaration source](mod.ts#L87)

```text
reference QueryFilter: ./packages/query/types.ts:276:1
```

### root: QueryFilters

[Declaration source](mod.ts#L88)

```text
reference QueryFilters: ./packages/query/types.ts:71:1
```

### root: QueryInspection

[Declaration source](mod.ts#L89)

```text
reference QueryInspection: ./packages/query/types.ts:580:1
```

### root: QueryIssue

[Declaration source](mod.ts#L90)

```text
reference QueryIssue: ./packages/query/types.ts:356:1
```

### root: QueryOperator

[Declaration source](mod.ts#L91)

```text
reference QueryOperator: ./packages/query/types.ts:57:1
```

### root: QueryOperatorName

[Declaration source](mod.ts#L92)

```text
reference QueryOperatorName: ./packages/query/types.ts:39:1
```

### root: QueryOrder

[Declaration source](mod.ts#L93)

```text
reference QueryOrder: ./packages/query/types.ts:82:1
```

### root: QueryPaginationDefinition

[Declaration source](mod.ts#L94)

```text
reference QueryPaginationDefinition: ./packages/query/types.ts:166:1
```

### root: QueryPaginationParameters

[Declaration source](mod.ts#L95)

```text
reference QueryPaginationParameters: ./packages/query/types.ts:262:1
```

### root: QueryParseResult

[Declaration source](mod.ts#L96)

```text
reference QueryParseResult: ./packages/query/types.ts:388:1
```

### root: QueryRequirements

[Declaration source](mod.ts#L97)

```text
reference QueryRequirements: ./packages/query/types.ts:393:1
```

### root: QuerySort

[Declaration source](mod.ts#L98)

```text
reference QuerySort: ./packages/query/types.ts:287:1
```

### root: QuerySortDirection

[Declaration source](mod.ts#L99)

```text
reference QuerySortDirection: ./packages/query/types.ts:79:1
```

### root: QueryValidationError

[Declaration source](mod.ts#L29)

```text
reference QueryValidationError: ./packages/query/validation.ts:5:1
```

### root: QueryValue

[Declaration source](mod.ts#L100)

```text
reference QueryValue: ./packages/query/types.ts:342:1
```

### root: ResourceFieldSelection

[Declaration source](mod.ts#L101)

```text
reference ResourceFieldSelection: ./packages/query/types.ts:305:1
```

### root: SimpleFieldSelection

[Declaration source](mod.ts#L102)

```text
reference SimpleFieldSelection: ./packages/query/types.ts:297:1
```

### root: asc

[Declaration source](mod.ts#L26)

```text
reference asc: ./packages/query/sort.ts:17:1
```

### root: between

[Declaration source](mod.ts#L34)

```text
reference between: ./packages/query/operators.ts:28:14
```

### root: contains

[Declaration source](mod.ts#L35)

```text
reference contains: ./packages/query/operators.ts:34:14
```

### root: cursor

[Declaration source](mod.ts#L27)

```text
reference cursor: ./packages/query/pagination.ts:17:1
```

### root: define

[Declaration source](mod.ts#L24)

```text
reference define: ./packages/query/definition.ts:18:1
```

### root: desc

[Declaration source](mod.ts#L26)

```text
reference desc: ./packages/query/sort.ts:25:1
```

### root: document

[Declaration source](mod.ts#L28)

```text
reference document: ./packages/query/description.ts:16:1
```

### root: endsWith

[Declaration source](mod.ts#L36)

```text
reference endsWith: ./packages/query/operators.ts:40:14
```

### root: eq

[Declaration source](mod.ts#L37)

```text
reference eq: ./packages/query/operators.ts:16:14
```

### root: field

[Declaration source](mod.ts#L25)

```text
reference field: ./packages/query/fields.ts:24:1
```

### root: gt

[Declaration source](mod.ts#L38)

```text
reference gt: ./packages/query/operators.ts:20:14
```

### root: gte

[Declaration source](mod.ts#L39)

```text
reference gte: ./packages/query/operators.ts:22:14
```

### root: icontains

[Declaration source](mod.ts#L40)

```text
reference icontains: ./packages/query/operators.ts:36:14
```

### root: in

[Declaration source](mod.ts#L42)

```text
reference in: ./packages/query/operators.ts:30:14
```

### root: inArray

[Declaration source](mod.ts#L41)

```text
reference inArray: ./packages/query/operators.ts:30:14
```

### root: is

[Declaration source](mod.ts#L24)

```text
reference is: ./packages/query/definition.ts:105:1
```

### root: isNotNull

[Declaration source](mod.ts#L43)

```text
reference isNotNull: ./packages/query/operators.ts:44:14
```

### root: isNull

[Declaration source](mod.ts#L44)

```text
reference isNull: ./packages/query/operators.ts:42:14
```

### root: lt

[Declaration source](mod.ts#L45)

```text
reference lt: ./packages/query/operators.ts:24:14
```

### root: lte

[Declaration source](mod.ts#L46)

```text
reference lte: ./packages/query/operators.ts:26:14
```

### root: ne

[Declaration source](mod.ts#L47)

```text
reference ne: ./packages/query/operators.ts:18:14
```

### root: nin

[Declaration source](mod.ts#L48)

```text
reference nin: ./packages/query/operators.ts:32:14
```

### root: notInArray

[Declaration source](mod.ts#L49)

```text
reference notInArray: ./packages/query/operators.ts:32:14
```

### root: offset

[Declaration source](mod.ts#L27)

```text
reference offset: ./packages/query/pagination.ts:35:1
```

### root: pagination

[Declaration source](mod.ts#L27)

```text
reference pagination: ./packages/query/pagination.ts:56:1
```

### root: paginationParameters

[Declaration source](mod.ts#L27)

```text
reference paginationParameters: ./packages/query/pagination.ts:80:1
```

### root: requirements

[Declaration source](mod.ts#L28)

```text
reference requirements: ./packages/query/description.ts:56:1
```

### root: startsWith

[Declaration source](mod.ts#L50)

```text
reference startsWith: ./packages/query/operators.ts:38:14
```

### root: validateAdapter

[Declaration source](mod.ts#L28)

```text
reference validateAdapter: ./packages/query/description.ts:87:1
```

## definition

Import `@okikio/query/definition`. [Source](./definition.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding           | Contract owner or source |
| -------------------------- | ------------------------ |
| `QueryAdapterCapabilities` | [Source](types.ts)       |
| `QueryDefinition`          | [Source](types.ts)       |
| `QueryDefinitionInput`     | [Source](types.ts)       |
| `QueryFields`              | [Source](types.ts)       |
| `QueryFilters`             | [Source](types.ts)       |
| `QueryValue`               | [Source](types.ts)       |
| `freezeFields`             | [Source](fields.ts)      |
| `freezeFieldsets`          | [Source](fields.ts)      |
| `freezeFilters`            | [Source](fields.ts)      |
| `validateSelectedFields`   | [Source](fields.ts)      |
| `validateOrder`            | [Source](sort.ts)        |
| `document`                 | [Source](description.ts) |
| `jsonSchema`               | [Source](description.ts) |
| `requirements`             | [Source](description.ts) |
| `validateAdapter`          | [Source](description.ts) |
| `assertPositiveInteger`    | [Source](validation.ts)  |
| `QueryValidationError`     | [Source](validation.ts)  |
| `safeParse`                | [Source](parse.ts)       |
| `encode`                   | [Source](url.ts)         |
| `stringify`                | [Source](url.ts)         |
| `inspect`                  | [Source](normalize.ts)   |
| `normalize`                | [Source](normalize.ts)   |

### definition: asc

[Declaration source](sort.ts#L17)

```text
function asc<Field extends string>(fieldName: Field, options: Readonly<{ readonly tiebreaker?: boolean; }>): QueryOrder<Field>
  Define ascending default/stable ordering.
```

### definition: cursor

[Declaration source](pagination.ts#L17)

```text
function cursor(options: CursorPaginationOptions): CursorPaginationDefinition
  Define opaque cursor pagination. Cursor verification belongs to a codec resource.
```

### definition: define

[Declaration source](definition.ts#L18)

```text
function define<Fields extends QueryFields>(input: QueryDefinitionInput<Fields>): QueryDefinition<Fields>
  Define one storage-neutral collection query contract.
```

### definition: desc

[Declaration source](sort.ts#L25)

```text
function desc<Field extends string>(fieldName: Field, options: Readonly<{ readonly tiebreaker?: boolean; }>): QueryOrder<Field>
  Define descending default/stable ordering.
```

### definition: document

[Declaration source](description.ts#L16)

```text
function document<Fields extends QueryFields>(definition: QueryDefinition<Fields>): QueryDocument
  Create JSON-safe documentation for a query definition.
```

### definition: field

[Declaration source](fields.ts#L24)

```text
function field<Schema extends StandardSchemaV1>(schema: Schema, options: QueryFieldOptions): QueryField<Schema>
  Define one public query field.
```

### definition: is

[Declaration source](definition.ts#L105)

```text
function is(value: unknown): value is QueryDefinition<QueryFields>
  Return whether a value is a collection-query definition.
```

### definition: offset

[Declaration source](pagination.ts#L35)

```text
function offset(options: OffsetPaginationOptions): OffsetPaginationDefinition
  Define bounded offset pagination with both offset/limit and page/per_page syntax.
```

### definition: pagination

[Declaration source](pagination.ts#L56)

```text
function pagination(options: PaginationModesOptions): PaginationModesDefinition
  Explicitly enable more than one pagination strategy for an endpoint.
```

### definition: paginationParameters

[Declaration source](pagination.ts#L80)

```text
function paginationParameters<Fields extends QueryFields>(definition: QueryDefinition<Fields>, mode: "cursor" | "offset"): QueryPaginationParameters | undefined
  Return exact query parameter names for request-aware pagination links.
```

### definition: requirements

[Declaration source](description.ts#L56)

```text
function requirements<Fields extends QueryFields>(definition: QueryDefinition<Fields>): QueryRequirements
  Describe provider capabilities required to execute a query definition faithfully.
```

### definition: validateAdapter

[Declaration source](description.ts#L87)

```text
function validateAdapter<Fields extends QueryFields>(definition: QueryDefinition<Fields>, capabilities: QueryAdapterCapabilities): QueryAdapterValidationResult
  Fail clearly when a provider adapter cannot honor a query definition.
```

### definition: QueryValidationError

[Declaration source](validation.ts#L5)

```text
class QueryValidationError extends Error
  Error thrown by `QueryDefinition.parse()`.

  constructor(issues: readonly QueryIssue[])
    Create this QueryValidationError from the explicit contract values supplied by its caller.
  readonly issues: readonly QueryIssue[]
    Structured rejection details; branch on their codes or paths rather than explanation wording.
```

## operators

Import `@okikio/query/operators`. [Source](./operators.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding    | Contract owner or source |
| ------------------- | ------------------------ |
| `QueryOperator`     | [Source](types.ts)       |
| `QueryOperatorName` | [Source](types.ts)       |

### operators: between

[Declaration source](operators.ts#L28)

```text
const between
  Inclusive pair/range filter.
```

### operators: contains

[Declaration source](operators.ts#L34)

```text
const contains
  Case-sensitive substring filter.
```

### operators: endsWith

[Declaration source](operators.ts#L40)

```text
const endsWith
  Suffix filter.
```

### operators: eq

[Declaration source](operators.ts#L16)

```text
const eq
  Equality filter.
```

### operators: gt

[Declaration source](operators.ts#L20)

```text
const gt
  Greater-than filter.
```

### operators: gte

[Declaration source](operators.ts#L22)

```text
const gte
  Greater-than-or-equal filter.
```

### operators: icontains

[Declaration source](operators.ts#L36)

```text
const icontains
  Case-insensitive substring filter.
```

### operators: in

[Declaration source](operators.ts#L30)

```text
const in
  Set-membership filter.
```

### operators: inArray

[Declaration source](operators.ts#L30)

```text
const inArray
  Set-membership filter.
```

### operators: isNotNull

[Declaration source](operators.ts#L44)

```text
const isNotNull
  Non-null check.
```

### operators: isNull

[Declaration source](operators.ts#L42)

```text
const isNull
  Null check.
```

### operators: lt

[Declaration source](operators.ts#L24)

```text
const lt
  Less-than filter.
```

### operators: lte

[Declaration source](operators.ts#L26)

```text
const lte
  Less-than-or-equal filter.
```

### operators: ne

[Declaration source](operators.ts#L18)

```text
const ne
  Inequality filter.
```

### operators: nin

[Declaration source](operators.ts#L32)

```text
const nin
  Set-exclusion filter.
```

### operators: notInArray

[Declaration source](operators.ts#L32)

```text
const notInArray
  Set-exclusion filter.
```

### operators: startsWith

[Declaration source](operators.ts#L38)

```text
const startsWith
  Prefix filter.
```

## types

Import `@okikio/query/types`. [Source](./types.ts).

Imported bindings connect this module to the contracts below. A local source link can name an internal module; use the
public import table when writing application imports.

| Imported binding            | Contract owner or source                                                   |
| --------------------------- | -------------------------------------------------------------------------- |
| `Ponyfill`                  | [duration contracts](../duration/API.md)                                   |
| `StandardSchemaV1`          | [External source](https://jsr.io/@standard-schema/spec/1.1.0/src/index.ts) |
| `QueryExpression`           | [Source](expression.ts)                                                    |
| `QueryExpressionInspection` | [Source](expression.ts)                                                    |

### types: CursorCodec

[Declaration source](types.ts#L443)

```text
interface CursorCodec<Payload = Readonly<Record<string, unknown>>>
  Portable opaque cursor codec contract implemented by a resource adapter.

  encode(payload: Payload): string | Promise<string>
    Encode a trusted payload into an opaque token.
  decode(cursor: string): Payload | Promise<Payload>
    Decode and authenticate an opaque token; malformed or forged tokens must fail.
```

### types: CursorPagination

[Declaration source](types.ts#L318)

```text
interface CursorPagination
  Normalized cursor pagination request.

  readonly kind: "cursor"
    Stable discriminant used to recognize this query value.
  readonly limit: number
    Maximum requested items in this page, validated against the definition bounds.
  readonly cursor?: string
    Opaque cursor token; only its codec interprets or authenticates the payload.
```

### types: CursorPaginationDefinition

[Declaration source](types.ts#L114)

```text
interface CursorPaginationDefinition
  Cursor pagination policy.

  readonly kind: "query-pagination"
    Stable discriminant used to recognize this query value.
  readonly type: "cursor"
    Pagination mode selected by this static policy.
  readonly defaultLimit: number
    Page size used when the client omits it; must fall within the configured bounds.
  readonly maximumLimit: number
    Largest accepted page size, preventing an unbounded client read.
  readonly minimumLimit: number
    Smallest accepted page size.
  readonly ttl?: Temporal.Duration | Ponyfill.Duration
    Optional cursor lifetime. Calendar units use the documented 2000-01-01 anchor when converted; native and ponyfill durations are accepted.
  readonly parameters: CursorPaginationParameters
    Explicit URL parameter names; defaults are resolved when the policy is authored.
```

### types: CursorPaginationOptions

[Declaration source](types.ts#L172)

```text
interface CursorPaginationOptions
  Input accepted by {@link cursor}.

  readonly defaultLimit?: number
    Page size used when the client omits it; must fall within the configured bounds.
  readonly maximumLimit?: number
    Largest accepted page size, preventing an unbounded client read.
  readonly minimumLimit?: number
    Smallest accepted page size.
  readonly ttl?: Temporal.Duration | Ponyfill.Duration
    Optional cursor lifetime. Calendar units use the documented 2000-01-01 anchor when converted; native and ponyfill durations are accepted.
  readonly parameters?: Partial<CursorPaginationParameters>
    Explicit URL parameter names; defaults are resolved when the policy is authored.
```

### types: CursorPaginationParameters

[Declaration source](types.ts#L94)

```text
interface CursorPaginationParameters
  Cursor query parameter names.

  readonly cursor: string
    Public URL parameter name for the opaque cursor.
  readonly limit: string
    Public URL parameter name for page size.
```

### types: OffsetPagination

[Declaration source](types.ts#L328)

```text
interface OffsetPagination
  Normalized offset or page-number pagination request.

  readonly kind: "offset"
    Stable discriminant used to recognize this query value.
  readonly limit: number
    Maximum requested items in this page, validated against the definition bounds.
  readonly offset: number
    Zero-based start of the requested result window.
  readonly source: "offset" | "page"
    Authored offset or page spelling, retained for non-canonical encoding.
  readonly page?: number
    One-based page number retained when the caller used page syntax.
```

### types: OffsetPaginationDefinition

[Declaration source](types.ts#L132)

```text
interface OffsetPaginationDefinition
  Offset pagination policy, including page-number syntax.

  readonly kind: "query-pagination"
    Stable discriminant used to recognize this query value.
  readonly type: "offset"
    Pagination mode selected by this static policy.
  readonly defaultLimit: number
    Page size used when the client omits it; must fall within the configured bounds.
  readonly maximumLimit: number
    Largest accepted page size, preventing an unbounded client read.
  readonly minimumLimit: number
    Smallest accepted page size.
  readonly maximumOffset: number
    Largest accepted offset; the provider still owns the cost of skipping rows.
  readonly defaultStyle: "offset" | "page"
    Wire spelling emitted for default offset pagination: offset/limit or page/per_page.
  readonly parameters: OffsetPaginationParameters
    Explicit URL parameter names; defaults are resolved when the policy is authored.
```

### types: OffsetPaginationOptions

[Declaration source](types.ts#L186)

```text
interface OffsetPaginationOptions
  Input accepted by {@link offset}.

  readonly defaultLimit?: number
    Page size used when the client omits it; must fall within the configured bounds.
  readonly maximumLimit?: number
    Largest accepted page size, preventing an unbounded client read.
  readonly minimumLimit?: number
    Smallest accepted page size.
  readonly maximumOffset?: number
    Largest accepted offset; the provider still owns the cost of skipping rows.
  readonly defaultStyle?: "offset" | "page"
    Wire spelling emitted for default offset pagination: offset/limit or page/per_page.
  readonly parameters?: Partial<OffsetPaginationParameters>
    Explicit URL parameter names; defaults are resolved when the policy is authored.
```

### types: OffsetPaginationParameters

[Declaration source](types.ts#L102)

```text
interface OffsetPaginationParameters
  Offset/page query parameter names.

  readonly offset: string
    Public URL parameter name for the zero-based offset.
  readonly limit: string
    Public URL parameter name for page size.
  readonly page: string
    Public URL parameter name for the one-based page.
  readonly perPage: string
    Public URL parameter name for page size in page syntax.
```

### types: PaginationModesDefinition

[Declaration source](types.ts#L152)

```text
interface PaginationModesDefinition
  Explicitly supported pagination modes for one endpoint.

  readonly kind: "query-pagination-modes"
    Stable discriminant used to recognize this query value.
  readonly type: "modes"
    Pagination mode selected by this static policy.
  readonly default: "cursor" | "offset"
    Mode used when the request has no explicit pagination selector.
  readonly cursor?: CursorPaginationDefinition
    Opaque cursor token; only its codec interprets or authenticates the payload.
  readonly offset?: OffsetPaginationDefinition
    Zero-based start of the requested result window.
```

### types: PaginationModesOptions

[Declaration source](types.ts#L202)

```text
interface PaginationModesOptions
  Input accepted by {@link pagination}.

  readonly default?: "cursor" | "offset"
    Mode used when the request has no explicit pagination selector.
  readonly cursor?: CursorPaginationDefinition
    Opaque cursor token; only its codec interprets or authenticates the payload.
  readonly offset?: OffsetPaginationDefinition
    Zero-based start of the requested result window.
```

### types: QueryAdapterCapabilities

[Declaration source](types.ts#L409)

```text
interface QueryAdapterCapabilities
  Capabilities truthfully supported by one provider adapter.

  readonly operators: "all" | readonly QueryOperatorName[]
    Filter operations that this definition requires or the provider can honor.
  readonly expressions?: readonly QueryExpressionKind[]
    Omission means conjunction only for existing flat-filter adapters.
  readonly pagination: readonly ("cursor" | "offset")[]
    Enabled static modes or one validated request window; mixed client modes are rejected.
  readonly fieldSelection: readonly ("simple" | "resource")[]
    Supported simple and resource-keyed sparse projection forms.
  readonly maximumSorts?: number
    Maximum complete order length the adapter can execute, including a stable cursor tiebreaker.
```

### types: QueryAdapterIssue

[Declaration source](types.ts#L423)

```text
interface QueryAdapterIssue
  One provider capability mismatch.

  readonly code: "unsupported-operator" | "unsupported-expression" | "unsupported-pagination" | "unsupported-field-selection" | "sort-limit"
    Stable machine-readable reason for a rejected query or provider capability.
  readonly message: string
    Explanation for a capability mismatch; callers should branch on the stable code.
```

### types: QueryDefinition

[Declaration source](types.ts#L451)

```text
interface QueryDefinition<Fields extends QueryFields = QueryFields> extends StandardSchemaV1<unknown, QueryValue<Fields>>
  Runtime and documentation contract exposed by one query definition.

  readonly kind: "query-definition"
    Stable discriminant used to recognize this query value.
  readonly fields: Fields
    Public field declarations or sparse projection; hidden fields remain unavailable to clients.
  readonly filters: QueryFilters<Fields>
    Declared operators by field; runtime values retain the conjunction compatibility view.
  readonly expressions: readonly QueryExpressionKind[]
    Enabled Boolean composition; omission at a provider boundary means conjunction only.
  readonly order: readonly QueryOrder<keyof Fields & string>[]
    Sort entries in priority order; canonical normalization does not reorder their priority.
  readonly pagination: QueryPaginationDefinition
    Enabled static modes or one validated request window; mixed client modes are rejected.
  readonly fieldsets: QueryFieldsets
    Allowed sparse field names grouped under explicit resource keys.
  readonly maximumFilters: number
    Maximum filter leaves accepted before a request reaches field validators.
  readonly maximumSorts: number
    Maximum client-selected sorts; a stable cursor tiebreaker remains required.
  readonly maximumSelectedFields: number
    Maximum selected fields across the requested projection.
  readonly maximumValuesPerFilter: number
    Maximum operands in one list filter, including tagged values.
  readonly maximumValueLength: number
    Maximum string or bigint text length accepted after decoding.
  readonly maximumParameters: number
    Maximum URL parameters, counting repeated keys separately.
  readonly maximumDepth: number
    Maximum expression depth, including leaf conditions.
  readonly maximumSiblings: number
    Maximum immediate children in one Boolean group.
  readonly defaultFields: readonly (keyof Fields & string)[]
    Public projection used when the request does not select fields explicitly.
  readonly description?: string
    Caller-authored explanation used by query documentation.
  readonly ~standard-json-schema: Readonly<{ readonly version: 1; readonly vendor: "utils-query"; readonly jsonSchema: () => Readonly<Record<string, unknown>>; }>
    Standard JSON Schema projection for the accepted wire input; runtime parsing owns full grammar validation.
  wireSchema(): Readonly<Record<string, unknown>>
    Describe the actual flat URL fields accepted by this definition.
  parse(input: unknown): Promise<QueryValue<Fields>>
    Validate URLSearchParams or plain query data; throw QueryValidationError on rejected input.
  safeParse(input: unknown): Promise<QueryParseResult<QueryValue<Fields>>>
    Validate the same input while returning structured issues instead of throwing.
  encode(value: QueryValue<Fields>): URLSearchParams
    Encode a validated query while preserving authored ordering and pagination spelling.
  normalize(value: QueryValue<Fields>): QueryValue<Fields>
    Return a separate canonical query, preserving scalar types and sort priority.
  stringify(value: QueryValue<Fields>): string
    Encode canonical query identity as an ordinary URL string; this is not a cryptographic digest.
  inspect(value: QueryValue<Fields>): QueryInspection<Fields>
    Return the authored tree, its measured bounds and a separate normalized projection.
  document(): QueryDocument
    Describe public fields, wire forms, capabilities and budgets without contacting a provider.
  requirements(): QueryRequirements
    List semantics that a provider must honor for this definition.
  validateAdapter(capabilities: QueryAdapterCapabilities): QueryAdapterValidationResult
    Compare declared provider capabilities and reject any semantic downgrade.
```

### types: QueryDefinitionInput

[Declaration source](types.ts#L226)

```text
interface QueryDefinitionInput<Fields extends QueryFields>
  Complete storage-neutral query definition input.

  readonly fields: Fields
    Public field declarations or sparse projection; hidden fields remain unavailable to clients.
  readonly filters?: QueryFilters<Fields>
    Declared operators by field; runtime values retain the conjunction compatibility view.
  readonly expressions?: readonly QueryExpressionKind[]
    Defaults to conjunction only for deployed flat-filter consumers.
  readonly order?: readonly QueryOrder<keyof Fields & string>[]
    Sort entries in priority order; canonical normalization does not reorder their priority.
  readonly pagination: QueryPaginationDefinition
    Enabled static modes or one validated request window; mixed client modes are rejected.
  readonly fieldsets?: Readonly<Record<string, QueryFieldsetInput>>
    Allowed sparse field names grouped under explicit resource keys.
  readonly maximumFilters?: number
    Maximum filter leaves accepted before a request reaches field validators.
  readonly maximumSorts?: number
    Maximum client-selected sorts; a stable cursor tiebreaker remains required.
  readonly maximumSelectedFields?: number
    Maximum selected fields across the requested projection.
  readonly maximumValuesPerFilter?: number
    Maximum operands in one list filter, including tagged values.
  readonly maximumValueLength?: number
    Maximum string or bigint text length accepted after decoding.
  readonly maximumParameters?: number
    Maximum URL parameters, counting repeated keys separately.
  readonly maximumDepth?: number
    Maximum expression depth, including leaf conditions.
  readonly maximumSiblings?: number
    Maximum immediate children in one Boolean group.
  readonly defaultFields?: readonly (keyof Fields & string)[]
    Public projection used when the request does not select fields explicitly.
  readonly description?: string
    Caller-authored explanation used by query documentation.
```

### types: QueryDocument

[Declaration source](types.ts#L519)

```text
interface QueryDocument
  JSON-safe query documentation.

  readonly description?: string
    Caller-authored explanation used by query documentation.
  readonly fields: readonly Readonly<{ readonly name: string; readonly description?: string; readonly selectable: boolean; readonly sortable: boolean; readonly operators: readonly QueryOperatorName[]; }>[]
    Public field declarations or sparse projection; hidden fields remain unavailable to clients.
  readonly fieldsets: Readonly<Record<string, QueryFieldsetDefinition>>
    Allowed sparse field names grouped under explicit resource keys.
  readonly defaultOrder: readonly QueryOrder[]
    Authored default sorts in priority order, including the cursor tiebreaker.
  readonly pagination: QueryPaginationDefinition
    Enabled static modes or one validated request window; mixed client modes are rejected.
  readonly maximumFilters: number
    Maximum filter leaves accepted before a request reaches field validators.
  readonly maximumSorts: number
    Maximum client-selected sorts; a stable cursor tiebreaker remains required.
  readonly maximumSelectedFields: number
    Maximum selected fields across the requested projection.
  readonly maximumValuesPerFilter: number
    Maximum operands in one list filter, including tagged values.
  readonly maximumValueLength: number
    Maximum string or bigint text length accepted after decoding.
  readonly maximumParameters: number
    Maximum URL parameters, counting repeated keys separately.
  readonly maximumDepth: number
    Maximum expression depth, including leaf conditions.
  readonly maximumSiblings: number
    Maximum immediate children in one Boolean group.
  readonly expressions: readonly QueryExpressionKind[]
    Enabled Boolean composition; omission at a provider boundary means conjunction only.
  readonly defaultFields: readonly string[]
    Public projection used when the request does not select fields explicitly.
  readonly wire: Readonly<{ readonly filter: "filter[field]=value / filter[field][operator]=value"; readonly expression: "filter[$all][index][field][operator]=value / filter[$any][index][field][operator]=value / filter[$not][field][operator]=value"; readonly value: "raw scalar or comma list / ~json: typed scalar or list"; readonly sort: "sort=field:direction,field:direction"; readonly fields: "fields=a,b / fields[resource]=a,b"; readonly pagination: readonly string[]; }>
    Documented public URL grammar; runtime parsing enforces its full structural bounds.
```

### types: QueryField

[Declaration source](types.ts#L5)

```text
interface QueryField<Schema extends StandardSchemaV1 = StandardSchemaV1>
  Query field schema and public documentation metadata.

  readonly kind: "query-field"
    Stable discriminant used to recognize this query value.
  readonly schema: Schema
    Standard Schema that validates and converts this field before provider work.
  readonly description?: string
    Caller-authored explanation used by query documentation.
  readonly selectable: boolean
    Whether clients may request this field in a sparse projection.
  readonly sortable: boolean
    Whether clients may place this field in the ordered sort list.
  readonly jsonSchema?: unknown
    Explicit wire schema override for documentation when inference cannot describe this field.
```

### types: QueryFieldOptions

[Declaration source](types.ts#L21)

```text
interface QueryFieldOptions
  Input accepted by {@link field}.

  readonly description?: string
    Caller-authored explanation used by query documentation.
  readonly selectable?: boolean
    Whether clients may request this field in a sparse projection.
  readonly sortable?: boolean
    Whether clients may place this field in the ordered sort list.
  readonly jsonSchema?: unknown
    Explicit wire schema override for documentation when inference cannot describe this field.
```

### types: QueryFieldsetDefinition

[Declaration source](types.ts#L212)

```text
interface QueryFieldsetDefinition
  One allowed JSON:API sparse-fieldset resource.

  readonly fields: readonly string[]
    Public field declarations or sparse projection; hidden fields remain unavailable to clients.
  readonly description?: string
    Caller-authored explanation used by query documentation.
```

### types: QueryInspection

[Declaration source](types.ts#L580)

```text
interface QueryInspection<Fields extends QueryFields = QueryFields>
  Authored tree plus a separate canonical projection for editors and identity.

  readonly filter?: QueryExpression<QueryFilter<Fields>>
    Authored Boolean tree; leaf conditions carry field-schema-validated operands.
  readonly normalized: QueryValue<Fields>
    Separate canonical value used for identity while leaving the authored tree intact.
  readonly expression: QueryExpressionInspection
    Tree grammar or measured structural information for the authored expression.
```

### types: QueryIssue

[Declaration source](types.ts#L356)

```text
interface QueryIssue extends StandardSchemaV1.Issue
  Validation issue emitted while parsing a collection query.

  readonly code: "unknown-field" | "unknown-fieldset" | "unknown-operator" | "invalid-value" | "invalid-sort" | "duplicate-sort" | "invalid-limit" | "invalid-offset" | "invalid-page" | "invalid-cursor" | "pagination-conflict" | "unsupported-pagination" | "field-selection-conflict" | "too-many-parameters" | "too-many-filter-values" | "too-many-selected-fields" | "value-too-long" | "too-many-filters" | "too-many-sorts" | "sorting-disabled" | "selection-disabled" | "invalid-expression" | "unsupported-expression" | "expression-too-deep" | "too-many-siblings" | "invalid-input"
    Stable machine-readable reason for a rejected query or provider capability.
```

### types: QueryOperator

[Declaration source](types.ts#L57)

```text
interface QueryOperator<Name extends QueryOperatorName = QueryOperatorName>
  Immutable query operator definition.

  readonly kind: "query-operator"
    Stable discriminant used to recognize this query value.
  readonly id: `query:${Name}`
    Stable identity of this operator definition.
  readonly name: Name
    Public field or operator name used in the URL grammar.
  readonly value: "none" | "one" | "many" | "pair"
    Validated operand or typed operand list; nullary operators omit it.
  readonly description: string
    Caller-authored explanation used by query documentation.
```

### types: QueryOrder

[Declaration source](types.ts#L82)

```text
interface QueryOrder<Field extends string = string>
  Static default sort entry.

  readonly kind: "query-order"
    Stable discriminant used to recognize this query value.
  readonly field: Field
    Public schema field selected by this condition or sort.
  readonly direction: QuerySortDirection
    Ascending or descending order; sort entry order remains significant.
  readonly tiebreaker: boolean
    Whether this sort makes cursor traversal stable when earlier sort values tie.
```

### types: QueryPaginationParameters

[Declaration source](types.ts#L262)

```text
interface QueryPaginationParameters
  Pagination parameter names exposed to server/response adapters.

  readonly cursor?: string
    Public URL parameter name for the opaque cursor.
  readonly limit: string
    Public URL parameter name for page size.
  readonly offset?: string
    Public URL parameter name for the zero-based offset.
  readonly page?: string
    Public URL parameter name for the one-based page.
  readonly perPage?: string
    Public URL parameter name for page size in page syntax.
```

### types: QueryRequirements

[Declaration source](types.ts#L393)

```text
interface QueryRequirements
  Query semantics required by a provider adapter.

  readonly operators: readonly QueryOperatorName[]
    Filter operations that this definition requires or the provider can honor.
  readonly expressions: readonly QueryExpressionKind[]
    Enabled Boolean composition; omission at a provider boundary means conjunction only.
  readonly pagination: readonly ("cursor" | "offset")[]
    Enabled static modes or one validated request window; mixed client modes are rejected.
  readonly fieldSelection: readonly ("simple" | "resource")[]
    Supported simple and resource-keyed sparse projection forms.
  readonly maximumSorts: number
    Maximum complete order length, including an appended stable cursor tiebreaker.
  readonly stableTiebreaker?: string
    Public field that makes cursor traversal deterministic for equal earlier sorts.
```

### types: QuerySort

[Declaration source](types.ts#L287)

```text
interface QuerySort<Field extends string = string>
  One normalized client-selected sort.

  readonly field: Field
    Public schema field selected by this condition or sort.
  readonly direction: QuerySortDirection
    Ascending or descending order; sort entry order remains significant.
  readonly tiebreaker: boolean
    Whether this sort makes cursor traversal stable when earlier sort values tie.
```

### types: QueryValue

[Declaration source](types.ts#L342)

```text
interface QueryValue<Fields extends QueryFields = QueryFields>
  Complete normalized collection query.

  readonly filter?: QueryExpression<QueryFilter<Fields>>
    Authored Boolean tree. Absent on legacy values authored with flat filters.
  readonly filters: readonly QueryFilter<Fields>[]
    Conjunction compatibility view; throws for an ANY/NOT tree.
  readonly order: readonly QuerySort<keyof Fields & string>[]
    Sort entries in priority order; canonical normalization does not reorder their priority.
  readonly fields: QueryFieldSelection<keyof Fields & string>
    Public field declarations or sparse projection; hidden fields remain unavailable to clients.
  readonly pagination: CursorPagination | OffsetPagination
    Enabled static modes or one validated request window; mixed client modes are rejected.
```

### types: ResourceFieldSelection

[Declaration source](types.ts#L305)

```text
interface ResourceFieldSelection
  JSON:API-style sparse fieldsets keyed by resource type.

  readonly kind: "resource"
    Stable discriminant used to recognize this query value.
  readonly resources: Readonly<Record<string, readonly string[]>>
    Sparse field names grouped by their declared resource type.
```

### types: SimpleFieldSelection

[Declaration source](types.ts#L297)

```text
interface SimpleFieldSelection<Field extends string = string>
  Simple sparse-field selection for the endpoint's primary resource.

  readonly kind: "simple"
    Stable discriminant used to recognize this query value.
  readonly fields: readonly Field[]
    Public field declarations or sparse projection; hidden fields remain unavailable to clients.
```

### types: QueryAdapterValidationResult

[Declaration source](types.ts#L436)

```text
type QueryAdapterValidationResult = Readonly<{ readonly valid: true; readonly requirements: QueryRequirements; }> | Readonly<{ readonly valid: false; readonly requirements: QueryRequirements; readonly issues: readonly QueryAdapterIssue[]; }>
  Provider capability validation result.
```

### types: QueryExpressionKind

[Declaration source](types.ts#L76)

```text
type QueryExpressionKind = "all" | "any" | "not"
  Boolean composition supported by a definition or provider adapter.
```

### types: QueryFieldSelection

[Declaration source](types.ts#L313)

```text
type QueryFieldSelection<Field extends string = string> = SimpleFieldSelection<Field> | ResourceFieldSelection
  Normalized sparse-field selection.
```

### types: QueryFieldValue

[Declaration source](types.ts#L36)

```text
type QueryFieldValue<Field extends QueryField> = StandardSchemaV1.InferOutput<Field["schema"]>
  Value type emitted by one query field.
```

### types: QueryFields

[Declaration source](types.ts#L33)

```text
type QueryFields = Readonly<Record<string, QueryField>>
  Named public field collection.
```

### types: QueryFieldsetInput

[Declaration source](types.ts#L220)

```text
type QueryFieldsetInput = readonly string[] | QueryFieldsetDefinition
  Authoring value accepted for a resource fieldset.
```

### types: QueryFieldsets

[Declaration source](types.ts#L223)

```text
type QueryFieldsets = Readonly<Record<string, QueryFieldsetDefinition>>
  Named sparse-fieldset resource collection.
```

### types: QueryFilter

[Declaration source](types.ts#L276)

```text
type QueryFilter<Fields extends QueryFields> = readonly [Key in keyof Fields & string]: Readonly<{ readonly field: Key; readonly operator: QueryOperatorName; readonly value?: QueryFieldValue<Fields[Key]> | readonly QueryFieldValue<Fields[Key]>[]; }>[keyof Fields & string]
  One normalized filter.
```

### types: QueryFilters

[Declaration source](types.ts#L71)

```text
type QueryFilters<Fields extends QueryFields> = Readonly<Partial<Record<keyof Fields & string, readonly QueryOperator[]>>>
  Allowed filter operators by public field.
```

### types: QueryOperatorName

[Declaration source](types.ts#L39)

```text
type QueryOperatorName = "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "between" | "in" | "nin" | "contains" | "icontains" | "startsWith" | "endsWith" | "isNull" | "isNotNull"
  Built-in filter operator names.
```

### types: QueryPaginationDefinition

[Declaration source](types.ts#L166)

```text
type QueryPaginationDefinition = CursorPaginationDefinition | OffsetPaginationDefinition | PaginationModesDefinition
  Supported pagination definitions.
```

### types: QueryParseResult

[Declaration source](types.ts#L388)

```text
type QueryParseResult<Value> = Readonly<{ readonly success: true; readonly value: Value; }> | Readonly<{ readonly success: false; readonly issues: readonly QueryIssue[]; }>
  Non-throwing query parse result.
```

### types: QuerySortDirection

[Declaration source](types.ts#L79)

```text
type QuerySortDirection = "asc" | "desc"
  Sort direction.
```

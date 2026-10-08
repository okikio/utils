# `@okikio/query`

A directory page asks for people named Ada and wants only two results. The API needs to understand that request before
its database adapter runs it. `query` declares which fields, comparisons and page sizes callers may request, then
returns checked query data. A **query definition** is the allowed search language for one collection.

![URL filters become a checked collection query before an application adapter calls the database](diagram.png)

[Editable diagram source](diagram.mmd). The demo stops at checked data and its URL round trip. The dotted arrow needs a
compatible adapter; parsing a filter does not execute it or make a database support that comparison. This view omits
sorting and complex filter groups.

The [full API reference](API.md) includes operators, normalized query shapes and adapter capabilities.

## Run a complete example

```ts runnable
import * as query from '@okikio/query';
import { z } from 'zod';
const Search = query.define({
	fields: { id: query.field(z.string(), { sortable: true }), name: query.field(z.string()) },
	filters: { name: [query.eq, query.in] },
	order: [query.asc('id', { tiebreaker: true })],
	pagination: query.offset({ defaultLimit: 20 }),
});
const value = await Search.parse(new URLSearchParams('filter[name]=Ada&limit=2'));
console.log(value.filters[0]?.field, value.pagination.limit);
console.log((await Search.parse(Search.encode(value))).filters[0]?.value);
```

Expected output:

```text output
name 2
Ada
```

The demo declares `name` filtering and a default page size of 20. The supplied URL overrides that limit to 2; the first
line prints the selected field and page size. The second line shows `Ada` survived encoding and parsing again. Remove
`limit=2` to use the default. Requesting an undeclared filter is a validation failure, not extra database authority.

## Apply a small checked search to an ordinary array

A definition is reusable configuration. Its result is data you can inspect with `if`, `filter()` and `slice()`. This
local adapter deliberately supports only equality on `name`; it rejects any comparison it cannot implement faithfully.

```ts runnable=directory-search.ts
import * as query from '@okikio/query';
import { z } from 'zod';

const Search = query.define({
	fields: { name: query.field(z.string()) },
	filters: { name: [query.eq] },
	pagination: query.offset({ defaultLimit: 20 }),
});
const checked = await Search.parse(new URLSearchParams('filter[name]=Ada&limit=1'));
const people = [{ name: 'Ada' }, { name: 'Lin' }];
const matches = people.filter((person) =>
	checked.filters.every((filter) => {
		if (filter.field !== 'name' || filter.operator !== 'eq') throw new Error('Unsupported comparison.');
		return person.name === filter.value;
	})
);
if (checked.pagination.kind !== 'offset') throw new Error('This adapter supports offset pages only.');
const { offset, limit } = checked.pagination;
console.log(JSON.stringify(matches.slice(offset, offset + limit)));
```

```text output
[{"name":"Ada"}]
```

| Part                  | Contract                                                           | What remains your job                                                                                         |
| --------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Field                 | `query.field(StandardSchema, options?)`                            | Declares a value validator and whether a field can be sorted or selected.                                     |
| `Search.parse(input)` | URL parameters or plain query data → `Promise<QueryValue>`         | Invalid grammar or values reject with `QueryValidationError`. No data source is searched.                     |
| `QueryValue`          | `{ filter?, filters, order, fields, pagination }`                  | Implement the declared semantics in an adapter. `filters` is a conjunction view and throws for ANY/NOT trees. |
| Offset page           | `{ kind: 'offset', limit: number, offset: number, source, page? }` | Zero-based window. Bounds were checked; the adapter still applies it.                                         |

Under the hood, `define()` snapshots field permissions, operators and budgets. Parsing normalizes input keys, validates
filter operands with their field schemas, then checks sorts, selected fields and pagination. It returns that checked
description rather than SQL or database-specific calls.

The separation lets the same search contract serve an in-memory list or a database without letting client text choose
arbitrary fields. A full provider adapter should call `validateAdapter()` against its capabilities and honor sorting,
projection and Boolean groups. The small adapter above promises only its explicitly declared equality and offset flow;
do not reuse it for a richer definition without extending those checks.

## Build on the example

- Parse a collection URL at a [Server endpoint](../server/endpoint/README.md) boundary, then pass the checked query to
  the application's declared database adapter. Keep adapter capability checks alongside that translation.
- Use [Schema](../schema/README.md) contracts for field meanings, then use Query for collection-level search grammar. A
  field's valid values and the operations a client may request on it are separate rules.

## Before and after: express alternatives without losing literal values

A flat filter list could only mean conjunction. Splitting list operands on commas also lost literal commas and empty
members. Enable Boolean capabilities deliberately and use the tagged codec for values that need it:

```ts runnable
import * as query from '@okikio/query';
import { z } from 'zod';
const Search = query.define({
	fields: { id: query.field(z.string(), { sortable: true }), name: query.field(z.string()) },
	filters: { name: [query.eq, query.in] },
	expressions: ['all', 'any', 'not'],
	order: [query.asc('id', { tiebreaker: true })],
	pagination: query.offset(),
});
const first = await Search.parse({ filter: { $any: [{ name: 'Ada' }, { name: 'Lin' }] } });
const second = await Search.parse({ filter: { $any: [{ name: 'Lin' }, { name: 'Ada' }] } });
console.log(Search.stringify(first) === Search.stringify(second));
const literal = await Search.parse({ filter: { name: { in: ['a,b', '', '雪'] } } });
console.log(JSON.stringify((await Search.parse(Search.encode(literal))).filters[0]?.value));
```

Expected output:

```text output
true
["a,b","","雪"]
```

The provider must declare support for the same expressions; parsing ANY does not make a conjunction-only database
adapter support it. The `.filters` compatibility view throws for ANY/NOT trees so callers cannot silently omit a
condition. Use `filter` for the full tree, `inspect()` for authored structure, and `normalize()` or `stringify()` when
equivalent queries should share identity. The ordinary `wireSchema()` method remains available beside Standard JSON
Schema projection.

| Input budget                      | Default |
| --------------------------------- | ------: |
| Filter leaves                     |      20 |
| Client sorts                      |       5 |
| Selected fields                   |     100 |
| Values per filter                 |     100 |
| String/bigint length              |    4096 |
| Parameters including repeats      |     200 |
| Expression depth including leaves |       8 |
| Siblings in a Boolean group       |     100 |

## How it fits

HTTP request parsing can produce a normalized query value from this package. A concrete database adapter then translates
the value into Drizzle, ClickHouse, SPARQL, or another native query language and rejects unsupported semantics.

Cursor signing and verification need a separate trusted codec. The query contract describes pagination; it does not
authenticate cursor tokens or construct HTTP responses.

## Declare public fields and supported comparisons

```ts
import * as query from '@okikio/query';

import { z } from 'zod';

export const WidgetQuery = query.define({
	fields: {
		id: query.field(z.string(), { sortable: true }),
		name: query.field(z.string(), { sortable: true }),
		score: query.field(z.coerce.number(), { sortable: true }),
		deletedAt: query.field(z.iso.datetime().nullable()),
		internalNote: query.field(z.string(), { selectable: false }),
	},
	filters: {
		name: [query.eq, query.icontains, query.in],
		score: [query.gte, query.between],
		deletedAt: [query.isNull, query.isNotNull],
	},
	order: [query.desc('id', { tiebreaker: true })],
	pagination: query.pagination({
		default: 'cursor',
		cursor: query.cursor({ defaultLimit: 25, maximumLimit: 100 }),
		offset: query.offset({ defaultLimit: 20, maximumLimit: 100 }),
	}),
	fieldsets: {
		widgets: ['id', 'name', 'score'],
		owners: ['id', 'name'],
	},
	defaultFields: ['id', 'name', 'score'],
});
```

Cursor support requires exactly one stable tiebreaker so keyset traversal stays deterministic.

## Documented URL syntax

```http
GET /widgets?
  filter[score][gte]=50&
  filter[deletedAt]=null&
  sort=score:desc,id:asc&
  fields=id,name,score&
  cursor=opaque&
  limit=50
```

JSON:API sparse fieldsets are preserved rather than flattened:

```http
GET /widgets?fields[widgets]=id,name&fields[owners]=id,name
```

Offset endpoints may accept either:

```http
GET /widgets?offset=40&limit=20
GET /widgets?page=3&per_page=20
```

Cursor, page, and offset modes cannot be mixed in one request. Unknown fields, disallowed operators, invalid null
semantics, duplicate sorts, excessive values, and unsupported pagination fail closed with structured issues.

## Provider adapters

```ts
const compatibility = WidgetQuery.validateAdapter({
	operators: ['eq', 'gte', 'between', 'isNull'],
	pagination: ['offset'],
	fieldSelection: ['simple'],
	maximumSorts: 3,
});
if (!compatibility.valid) console.log(compatibility.issues);
```

Adapters reject unsupported operators or pagination strategies instead of silently changing their meaning. Tenant,
authorization, and row-level-security predicates remain server-owned and are not represented by client filters.

An adapter's `maximumSorts` counts the complete normalized order. The definition's limit counts client-selected sorts.
For example, a request that selects `name:asc` may append the stable `id` field for cursor traversal, so the adapter
must support two sorts even when the definition permits only one client-selected sort. Requirements count distinct
eligible fields; a query with only `id` needs capacity for one sort.

`WidgetQuery.encode(value)` recreates canonical bracket filters, colon sorts, sparse fieldsets, and the selected
pagination form for link generation and round-trip tests.

## Request and adapter flow

```text
request URL parameters
  -> query definition checks fields, operands, sorts and page bounds
  -> application adds its trusted tenant and authorization restrictions
  -> compatible provider adapter translates checked query data
  -> provider returns rows for the application response
```

Read top to bottom as data crosses ownership boundaries. The diagram omits provider-specific SQL and connection setup.
Checked client filters never replace the application's trusted restrictions. The provider adapter owns parameterized
expressions, keyset seek predicates, count strategy and cursor codec use. The earlier array example implements the
smallest part of this flow without introducing a database or server runtime.

## Progressive usage

Read [complete compositions](../../docs/composition.md) for a bounded CSV import, allowed-page discovery and a
resource-backed operation. Each example names its result and owner. Use [the outcome guide](../../docs/outcomes.md) to
choose additional mechanisms when the application needs them.

## Convenience and the manual equivalent

| Convenience         | Manual equivalent                                                                                                               | Concrete value                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `query.define()`    | snapshot field/filter/order/pagination records, validate operators, defaults, aliases, and tiebreakers yourself                 | one storage-neutral query contract                          |
| `query.safeParse()` | descriptor-validate the raw record, parse every filter/order/page field, normalize values, and collect prefixed issues manually | untrusted query input becomes one normalized shape          |
| `query.encode()`    | serialize only deterministic scalar wire values and preserve repeated filters/order explicitly                                  | round-trippable transport without arbitrary object coercion |

`@okikio/query` is a convenience layer, not a hidden runtime. You can reproduce its core mechanics with URLSearchParams
plus your own filter/sort AST, validator calls, pagination rules, and cursor encoding.

The utility keeps query meaning storage-neutral so Postgres, ClickHouse, SPARQL, or another adapter can compile the same
normalized request.

## Operators, projection, and validation

The query vocabulary intentionally exposes operators as small named values. In addition to the operators shown above,
the public set includes `ne`, `gt`, `lt`, `lte`, `contains`, `startsWith`, `endsWith`, `inArray`, `notInArray`, and the
aliases `nin`/related selected operators supported by the definition.

Tooling and adapters also use:

- `document()` for deterministic query-definition metadata.
- `paginationParameters()` for the transport-neutral pagination parameter schema.
- `requirements()` for backend capability requirements implied by a definition.
- `QueryValidationError` when raw user query input cannot be normalized into the declared contract.

## Source guide

Start with this README, then use the source in this order when you need more detail:

1. `mod.ts` shows the supported runtime operations and the composition shape.
2. `types.ts`, when present, shows the public value and behavior contracts.
3. `*.test.ts` files show edge cases, cancellation, invalid input, and lifecycle behavior as executable examples.
4. Read internal implementation files only when you need the exact state transition or performance-sensitive loop.

The [generated API reference](API.md) lists every public function and type. These examples teach the common paths and
the design decisions behind those contracts.

## Validation shape versus wire shape

A `QueryDefinition` is a Standard Schema validator for the normalized query value. Its `wireSchema()` method has a
different job: it describes the bracketed HTTP query-string representation used by endpoint/OpenAPI documentation.

The two shapes are intentionally different. For example, `filter[name][contains]=kai` is an HTTP query-string
representation, while a database adapter consumes the normalized `QueryValue`. Endpoint documentation uses
`wireSchema()` so OpenAPI describes the HTTP input rather than the normalized JavaScript value.

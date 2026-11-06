# Give a collection one allowed search language

A directory endpoint may accept a name filter, a minimum score, a sort, a field selection, and a page. Those are user
requests, not permission to address arbitrary storage columns. Query declares the allowed requests and returns checked
data that an adapter can apply.

Start with the [package examples](../packages/query/README.md). This guide shows independent expressions and pages, then
whole-query and provider composition.

A **field** is one named property, such as `name`. A **filter** keeps matching
records, a **sort** orders them, and a **page** limits how many are returned.
Field selection chooses which properties the caller wants to receive. These are
requests within an application-approved vocabulary. They do not grant access to
private records. Apply trusted account or tenant restrictions in the provider too.

```text
caller URL -> allowed query definition -> checked request -> your provider -> records
                                                               ^
                                             trusted access restrictions
```

The arrow into the provider matters: parsing a URL does not search storage or
protect a tenant by itself. The example below implements only its declared name
filter and page on a small array, so you can see each step without a database.

## Search people with a checked name filter

Declare a name equality filter and a bounded page, parse a caller URL, then apply those checked values to a small people
array. This local provider lets you see actual matching rows before learning alternate representations.

Run from this checkout after `mise run prepare -- --kind deps`. Save the runnable block as a `.ts` file in your project and use
`mise exec -- deno run example.ts`.

```ts runnable=example.ts
import * as query from '@okikio/query';
import * as schema from '@okikio/schema';
// Expose only the supported fields and operators; a client cannot name arbitrary data fields.
const Search = query.define({
	fields: { name: query.field(schema.string()) },
	filters: { name: [query.eq] },
	pagination: query.offset({ defaultLimit: 2, maximumLimit: 10 }),
});
const checked = await Search.parse(new URL('https://example.test/people?filter[name]=Ada&limit=2'));
if (checked.pagination.kind !== 'offset') throw new Error('This provider supports offset pages.');
const name = query.conjunction(checked.filter)?.[0]?.value;
// Parsing produced checked query data. This demo provider now applies it to an in-memory collection.
const people = [{ name: 'Ada' }, { name: 'Lin' }];
const matches = people.filter((person) => name === undefined || person.name === name);
console.log(
	JSON.stringify(matches.slice(checked.pagination.offset, checked.pagination.offset + checked.pagination.limit)),
);
try {
	await Search.parse(new URL('https://example.test/people?filter[password]=secret'));
} catch (error) {
	if (!(error instanceof query.QueryValidationError)) throw error;
	console.log('Unknown filter rejected before searching');
}
```

```text output
[{"name":"Ada"}]
Unknown filter rejected before searching
```

The URL supplies a name and a page bound. Query checks which fields and operators are allowed, then returns ordinary
checked data. Our array provider applies that exact equality and page; Query does not retrieve rows or translate to SQL.
The rejected password filter never reaches the provider. A production adapter must preserve every operation enabled
by its definition and add trusted tenant/access restrictions separately.


## Three values with different jobs

| Value            | Job                                                                              | Example                                                             |
| ---------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Query definition | Declare allowed fields, operators, default sorts, projection, and limits once.   | `query.define({ fields, filters, pagination })`                     |
| Input            | Express what a caller wants, as URL parameters or typed semantic data.           | `filter[name]=Ada` or `Search.condition('name', 'eq', 'Ada')`       |
| Checked query    | Hold validated operands, the expression tree, ordered sorts, fields, and a page. | The `QueryValue` returned by `Search.parse()` or `Search.create()`. |

The input's values follow field schema input types. Checked operands follow schema output types. A numeric text field
can therefore accept `'12'` and produce `12`. That transformation does not provide an inverse automatically; URL links
need an explicit encoder when output is not also accepted input.

## One validation path, several useful entrypoints

`Search.parse(input)` reads HTTP-shaped input. `Search.create(input)` reads semantic authoring data. Both check the same
field validators, operator permissions, expression limits, sort rules, projection, and page policy. Adapters receive the
same `QueryValue` from either operation.

The standalone `/pagination` entry checks a page without requiring fake search fields. `/expression` composes a caller's
own leaves without schema or storage knowledge. `/url` supplies functional parse/encode operations when a caller keeps
the definition separate from its transport code.

This is a deliberate layered API. The root makes the normal collection-search job convenient. Independent subpaths
expose complete capabilities rather than internal functions that require mutable issue arrays or parser state.

## Preserve author intent while deriving identity

The checked filter is an ALL/ANY/NOT tree. Sort entries remain in priority order. `encode()` preserves the authored
structure and page/offset style. `normalize()` creates a separate canonical representation for comparison, and
`stringify()` writes that representation as URL text.

`conjunction(value.filter)` is a convenience for an adapter limited to ALL. It returns all leaves, an empty list for no
filter, or `undefined` if ANY/NOT prevents a conjunction-only interpretation. The full tree is always `value.filter`;
reading it does not throw because the caller used a permitted Boolean operation.

## The application still owns access and execution

A checked query limits public search syntax. It does not replace tenant restrictions, authentication, authorization, or
row access checks. Add those trusted restrictions separately in the provider adapter.

The adapter owns parameterized provider expressions, collation, null behavior, keyset traversal, cursor verification,
and row retrieval. `validateAdapter()` catches declared capability gaps before a request runs. An adapter must reject
unsupported semantics instead of dropping an operator or flattening ANY into ALL.

For a small in-memory list, the same rule can be expressed with ordinary array operations and `/expression` evaluation.
The cookbook defines the exact subset that such an adapter implements.

## What the utility saves

Without Query, each endpoint would need to maintain field permissions, operand validation, bracket parsing, repeated
parameters, typed literal escaping, expression budgets, sorting, field selection, page bounds, canonical identity, and
schema documentation. These rules interact, so keeping them in one contract gives more than a set of unrelated parsing
helpers.

The checked result remains ordinary data. Applications can inspect it, pass it to a different adapter, serialize a URL,
or test provider behavior without constructing a server or workflow runtime.

Each example starts from the public package or a supported subpath. Keep the allowed search definition, authored input,
and checked data sent to an adapter distinct as you follow the examples.

## Compose Boolean expressions on their own

ALL means every condition must match, ANY means at least one must match, and
NOT reverses its child's answer. A **leaf** is one condition without children.
In the next example each leaf is a name, and the comparison asks whether that
name belongs to a set. The rule reads “Ada or Lin is present, and Removed is not.”
It prints `true` because only Ada is present. It prints `3` because the tree
contains three name conditions; that count does not say three people matched.

The expression capability does not need fields, schemas, pagination, or a provider. Your predicate identifies a domain
leaf; your comparison supplies its meaning. ALL and ANY short-circuit in the authored order after the tree passes shape,
cycle, and budget checks.

```ts runnable
import { all, any, evaluate, inspect, not } from '@okikio/query/expression';

const rule = all(any('Ada', 'Lin'), not('Removed'));
const isName = (value: unknown): value is string => typeof value === 'string';
const names = new Set(['Ada']);
console.log(evaluate(rule, isName, (name) => names.has(name)));
console.log(inspect(rule, isName).leafCount);
```

```text output
true
3
```

`all()` and `any()` require at least one condition. Their child lists are copied; domain leaf objects remain borrowed.
Evaluation is synchronous and each comparison must return a boolean. Use the same expression values with a provider
compiler when your domain is not an in-memory membership test.

Standalone inspection defaults to depth 64, 10,000 leaves, and 1,000 children per group. Pass a `QueryExpressionLimits`
object to choose a smaller budget. These standalone limits are separate from a collection definition's HTTP budgets.

## Read pagination without searchable fields

A table, an activity log, or a feed may need page controls without a filter language. Import `/pagination` directly.

```ts runnable
import * as page from '@okikio/query/pagination';

const policy = page.offset({ defaultLimit: 20, maximumLimit: 100 });
const current = page.parse(policy, new URLSearchParams('page=2&per_page=20&view=compact'));
if (current.kind !== 'offset') throw new Error('Expected an offset page.');
console.log(current.offset, current.limit);
const next = page.encode(policy, { ...current, page: 3, offset: 40 });
console.log(next.toString());
console.log(page.safeParse(policy, new URLSearchParams('limit=1000')).success);
```

```text output
20 20
page=3&per_page=20
false
```

Page numbers start at one; offsets start at zero. The policy bounds the page size and maximum offset. Unknown unrelated
parameters such as `view` are ignored. Repeated names still count toward the standalone default budget of 32 parameters.

`parse()` throws `QueryValidationError` for invalid user input. `safeParse()` returns issues for a form or HTTP error
response. `encode()` checks that the page remains within policy and that page number, offset, and limit describe the
same window.

Opaque cursors use a different policy. The application selects the field names and authenticates the token separately.

```ts runnable
import { min } from '@okikio/duration';
import * as page from '@okikio/query/pagination';

const policy = page.cursor({
	defaultLimit: 25,
	maximumLimit: 100,
	ttl: min(15),
	parameters: { cursor: 'after', limit: 'count' },
});
const value = page.parse(policy, new URLSearchParams('after=opaque%2Ftoken&count=5'));
console.log(value.kind, value.limit);
console.log(page.encode(policy, value).get('after'));
```

```text output
cursor 5
opaque/token
```

A cursor TTL is fixed elapsed time. Months, years, zero, and negative TTLs reject. A TTL declaration does not itself
check an incoming token's expiry. A trusted codec and adapter own that check.

`pagination({ cursor, offset, default })` enables both modes. A request cannot combine cursor, offset, and page
controls. A first cursor page with no token is representable only when cursor is the default; otherwise the wire request
has no cursor marker that distinguishes it from the default offset page.

## Share a definition between code and HTTP

A definition connects each field's schema to the operators clients may request. Typed authoring avoids bracket strings;
URL parsing accepts those strings from an HTTP request.

```ts runnable
import * as query from '@okikio/query';
import * as schema from '@okikio/schema';
import * as parameters from '@okikio/query/url';

// Expose only the supported fields and operators; a client cannot name arbitrary data fields.
const Search = query.define({
	fields: { name: query.field(schema.string()), score: query.field(schema.number()) },
	filters: { name: [query.eq, query.in], score: [query.gte, query.between] },
	expressions: ['all', 'any', 'not'],
	pagination: query.offset({ defaultLimit: 20 }),
});
const value = await Search.create({
	filter: query.any(
		Search.condition('name', 'in', ['a,b', '', '雪']),
		Search.condition('score', 'gte', 90),
	),
	fields: ['name'],
	pagination: { kind: 'page', page: 2, limit: 5 },
});
const url = new URL('https://example.test/people');
url.search = parameters.encode(Search, value).toString();
const restored = await parameters.parse(Search, url);
console.log(Search.stringify(restored) === Search.stringify(value));
console.log(restored.pagination.kind === 'offset' ? restored.pagination.offset : 0);
```

```text output
true
5
```

The tagged scalar codec preserves literal commas, empty strings, bigint, dates, booleans, and negative zero. Callers do
not have to escape a list operand manually. Encoding returns only the query's parameters. If an application also owns
unrelated URL parameters, it decides how to merge or replace those separately.

`Search.condition('score', 'between', [10, 20])` is a pair. `Search.condition('name', 'in', ['Ada'])` is a nonempty
list. A null operator takes no operand. Type inference rejects unknown fields, operators disabled for a field, wrong
operand types, and wrong arity. The same rules remain runtime checks for JavaScript and unknown data.

`safeCreate()` checks a semantic request without throwing `QueryValidationError`; `safeParse()` does the same for wire
input. The condition helper checks its declared field/operator and argument count at construction, while `create()` owns
actual schema validation of values.

## Keep transformed input and output connected

A transform such as numeric text to a number has different input and output types. Use the existing Schema codec to
declare both directions together. Query uses the decode schema for validation and the encode schema when writing a URL.

```ts runnable
import * as query from '@okikio/query';
import * as schema from '@okikio/schema';
import * as codec from '@okikio/schema/codec';

const Score = codec.define({
	decode: schema.transform(schema.string(), Number),
	encode: schema.transform(schema.number(), String),
});
// Expose only the supported fields and operators; a client cannot name arbitrary data fields.
const Search = query.define({
	fields: { score: query.field(Score, { outputJsonSchema: { type: 'number' } }) },
	filters: { score: [query.gte] },
	pagination: query.offset(),
});
const value = await Search.create({ filter: Search.condition('score', 'gte', '12') });
console.log(query.conjunction(value.filter)?.[0]?.value);
console.log(Search.stringify(await Search.parse(Search.encode(value))) === Search.stringify(value));
```

```text output
12
true
```

The authoring operand is a string and the checked operand is a number. `outputJsonSchema` supplies the output projection
because an arbitrary transformation cannot be inspected to infer that type. The decode schema already supplies its
string input projection.

A field may instead use `field(schema, { encode(value) { ... } })` for a focused synchronous inverse. That callback has
the schema's output-to-input types. Query's URL encoding is synchronous, so a codec encoder that returns a promise is
rejected with a clear error. The general Schema codec remains available for asynchronous conversions elsewhere; Query
does not invent a competing codec abstraction.

Encoders must be deterministic and return supported scalar input. Query applies its literal escaping after the field
conversion. A one-way transform with no inverse can still validate a request, but cannot promise that its output can be
written back into a URL accepted by the same schema.

## Apply a real search to an array

This adapter supports name equality, minimum score, Boolean groups, simple projection, and offset pages. Those are
concrete promises. Its declaration excludes sorting and cursor pagination, so it does not need to guess their semantics.

```ts runnable
import * as query from '@okikio/query';
import { evaluate } from '@okikio/query/expression';
import * as schema from '@okikio/schema';

// Expose only the supported fields and operators; a client cannot name arbitrary data fields.
const Search = query.define({
	fields: { name: query.field(schema.string()), score: query.field(schema.number()) },
	filters: { name: [query.eq], score: [query.gte] },
	expressions: ['all', 'any', 'not'],
	pagination: query.offset(),
});
const compatibility = Search.validateAdapter({
	operators: ['eq', 'gte'],
	expressions: ['all', 'any', 'not'],
	pagination: ['offset'],
	fieldSelection: ['simple'],
	maximumSorts: 0,
});
if (!compatibility.valid) throw new Error('This definition needs a different adapter.');
const value = await Search.create({
	filter: query.any(Search.condition('name', 'eq', 'Ada'), Search.condition('score', 'gte', 90)),
	fields: ['name'],
	pagination: { kind: 'offset', limit: 2 },
});
const people = [{ name: 'Ada', score: 40 }, { name: 'Lin', score: 95 }, { name: 'Bea', score: 10 }];
type Filter = query.QueryFilter<typeof Search.fields>;
const isFilter = (entry: query.QueryExpression<Filter>): entry is Filter => 'field' in entry;
const matches = people.filter((person) =>
	value.filter === undefined || evaluate(value.filter, isFilter, (filter) => {
		if (filter.field === 'name' && filter.operator === 'eq') return person.name === filter.value;
		if (filter.field === 'score' && filter.operator === 'gte') return person.score >= filter.value;
		throw new Error('Unsupported field/operator pair.');
	})
);
if (value.pagination.kind !== 'offset' || value.fields.kind !== 'simple') {
	throw new Error('Unsupported page or projection.');
}
const { offset, limit } = value.pagination;
const selected = value.fields.fields;
const rows = matches.slice(offset, offset + limit).map((person) =>
	Object.fromEntries(selected.map((field) => [field, person[field]]))
);
console.log(JSON.stringify(rows));
```

```text output
[{"name":"Ada"},{"name":"Lin"}]
```

This is an actual end-to-end consumer of the definition, expression, pagination, and projection contracts. The leaf
comparison belongs to the adapter, so Query does not silently choose string collation, database null behavior, or
ordering for arbitrary values.

For a storage adapter, use parameterized provider expressions instead of the array filter. Add trusted tenant and
authorization restrictions separately. The checked client expression never replaces them.

## Sort and paginate a provider-backed collection

Mark sortable fields explicitly and declare a stable tiebreaker when cursor pagination is enabled.

```ts runnable
import * as query from '@okikio/query';
import * as schema from '@okikio/schema';

// Expose only the supported fields and operators; a client cannot name arbitrary data fields.
const Search = query.define({
	fields: {
		id: query.field(schema.string(), { sortable: true }),
		score: query.field(schema.number(), { sortable: true }),
	},
	filters: { score: [query.gte] },
	order: [query.asc('id', { tiebreaker: true })],
	pagination: query.cursor({ defaultLimit: 25 }),
});
const value = await Search.parse(new URLSearchParams('sort=score:desc&limit=5'));
console.log(value.order.map((sort) => sort.field).join(','));
console.log(value.pagination.limit);
```

```text output
score,id
5
```

The adapter's maximum sort count includes the appended tiebreaker. A limit of one client-selected sort can therefore
require two provider sort keys. The provider must use that complete order to build seek predicates and cursor payloads.

## Failures, budgets, and schema projections

| Input budget                             | Default |
| ---------------------------------------- | ------: |
| Filter leaves                            |      20 |
| Client-selected sorts                    |       5 |
| Selected fields                          |     100 |
| Values per filter                        |     100 |
| String/bigint text length                |    4096 |
| URL parameters, including repeated names |     200 |
| Expression depth, including leaves       |       8 |
| Children in a Boolean group              |     100 |

A malformed query produces stable issue codes and paths. Examples include `unknown-field`, `unknown-operator`,
`invalid-value`, `pagination-conflict`, and the `too-many-*` limits. Safe parsing does not invoke accessor properties
from plain-data input and rejects cyclic semantic expression records.

The definition implements Standard Schema from wire input to checked `QueryValue`; it is a transforming validator.
`wireSchema()` is its explicit HTTP documentation projection. Standard JSON Schema input conversion throws because
tagged operands must first be decoded and checked by their field validators. A prefix pattern cannot represent that
operation. Input metadata cannot stand in for a differently typed output projection.

Wire documentation requires inline field `jsonSchema` metadata. Documents containing resource IDs, anchors or references
fail with the field name and a request for inline constraints, because separate HTTP parameter schemas cannot preserve
that shared scope. Output projection can keep identified resources and rejects collisions across different field
documents.

Standard JSON Schema output describes the parsed structural type, including field constraints, permitted operators,
expression depth, immediate group limits, sorts, selected fields and page variants. It does not replace parser-only
checks that span values: total leaves, total resource selections, unique sort fields or page/offset arithmetic. A
structurally valid JSON value is not automatically a checked `QueryValue`. Use `parse()` for wire data and `create()`
for semantic input. See the [package contract](../packages/query/README.md#validation-and-documentation) for exact scope
and reference-resource requirements.

`normalize()` and `stringify()` derive canonical identity without rewriting the original authored tree or reordering
sort priority. Neither performs a search or authenticates a cursor.

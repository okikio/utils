# `@okikio/query`

Declare which collection fields a caller may search, sort, or select, then validate a request before applying it to a
data source. The same definition accepts URL parameters and typed programmatic input. It produces checked query data;
your application or provider adapter performs the search.

For Deno, Node, and Bun execution, see [run a portable example](../../docs/05-runtime.md#run-a-portable-example-in-your-own-project). Host-specific adapters keep their native runtime requirements.

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

Start with `query.define()` and its returned `parse()` method. The focused definition, operator, URL and pagination
subpaths let you reuse a single part independently; they are not extra setup steps. Add the PostgreSQL compiler when
SQL should implement the allowed operations. Add signed cursors only when clients need continuation tokens that must
resist changes: a signature checks the token, while the application still checks who may read the resulting rows.

## Read an allowed search

Allow only name equality and bounded offset pages. Parse the caller's URL, apply that exact operation to local people,
then reject an unknown filter before searching. Validation describes allowed operations; the array provider performs them.

These examples use the current experimental source checkout, not an assumed registry release. From the `utils`
repository root, review `mise.toml`, run `mise trust`, then `mise install` and `mise run prepare -- --kind deps`.
Save the following module as `example.ts` and run `mise exec -- deno run example.ts`.
[Checkout prerequisites](../../README.md#work-on-the-repository) explain installing Mise.

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
checked data. Our array provider applies that exact equality and page. `Search.parse()` only checks the request; it retrieves no rows.
The optional `@okikio/query/postgres` compiler can translate that checked request into SQL, which the application executes.
The rejected password filter never reaches the provider. A production adapter must preserve every operation enabled
by its definition and add trusted tenant/access restrictions separately.


A definition says what callers may request. A parsed value contains `{ filter?, order, fields, pagination }`. The field
schema validates an operand; Query validates whether that field, operator, sort, projection, and page are allowed
together.

## Compile a checked request for PostgreSQL

The optional `postgres` entry translates the checked query vocabulary into a
parameterized SELECT statement. Your application owns its PostgreSQL driver,
connection lifetime, transaction, row decoding, timeout, and access policy.
This adapter adds no database dependency to the root query import.

```ts
import * as query from '@okikio/query';
import * as pg from '@okikio/query/postgres';
import * as schema from '@okikio/schema';

const Search = query.define({
	fields: {
		id: query.field(schema.number(), { sortable: true }),
		name: query.field(schema.string()),
	},
	filters: { name: [query.contains] },
	order: [query.asc('id', { tiebreaker: true })],
	pagination: query.offset({ defaultLimit: 20, maximumLimit: 100 }),
});

// Check this once when binding an endpoint, before it accepts client requests.
const support = Search.validateAdapter(pg.capabilities);
if (!support.valid) throw new Error('This query requests unsupported PostgreSQL adapter features.');

const checked = await Search.parse(new URLSearchParams('filter[name][contains]=Ada'));

const statement = pg.compile(checked, {
	// The application chooses the relation and private columns; clients choose only public fields.
	table: ['public', 'people'],
	columns: { id: 'person_id', name: 'display_name' },
});

console.log(statement.text, statement.values);
// With postgres.js, pass text and values separately to database.unsafe().
// Do not interpolate the values into the SQL text.
```

The compiler supports bounded offset and cursor pages, simple field selection,
all declared operators, and ALL/ANY/NOT groups. Resource fieldsets still require
an application projection. Identifiers come from your mapping and are quoted; operands use
numbered placeholders. Text contains/prefix/suffix comparisons treat `%`, `_`,
and backslash literally. Case conversion and collation follow PostgreSQL.

Equality and list membership use null-safe distinctness. Other comparisons use
SQL's three-valued logic: a comparison with NULL is unknown, including under NOT,
and a WHERE clause drops that row. Sorts use NULLS LAST in both directions.
Operands must be strings, finite numbers, booleans, bigint, or null. Text
operators require strings. Applications needing timestamps should use explicit
validated scalar representations that their database column accepts.

This SELECT compiler does not add tenant restrictions. Use a server-owned view,
row-level security, or combine trusted restrictions with the client filter before
creating the checked value. Never let client choices replace the trusted filter.
A unique final sort key gives deterministic ordering within a snapshot; offset
pages can still shift across concurrent writes. Counts and deployment policy
remain with the application.

### Continue in a stable database order

Cursor pages use a lexicographic keyset rather than skipping earlier rows. Declare
an immutable, non-null unique key as the final tiebreaker. Earlier keys may be
nullable and may mix ascending and descending order; PostgreSQL NULLS LAST is
part of the contract. The compiler checks the order shape and rejects a null
final boundary key. The application must enforce actual uniqueness and
immutability in its database model.

```ts
import * as query from '@okikio/query';
import * as pg from '@okikio/query/postgres';
import * as cursors from '@okikio/query/cursor';
import * as hmac from '@okikio/hash/hmac';
import * as schema from '@okikio/schema';

const Search = query.define({
	fields: { id: query.field(schema.number(), { sortable: true }) },
	order: [query.asc('id', { tiebreaker: true })],
	pagination: query.cursor({ defaultLimit: 20 }),
});

// Demo key only. In a service, borrow a persistent signing key from its owner.
const signer = await hmac.create('sha256', crypto.getRandomValues(new Uint8Array(32)));

const cursor = cursors.create({
	contract: 'people.v1',
	order: Search.order,
	semantics: 'postgres;nulls-last;immutable-unique-id',
	context: 'authorized-tenant-and-filter-digest',
	values: schema.array(schema.number(), { minLength: 1, maxLength: 1 }),
}, {
	keys: [{ id: 'current', signer }],
	activeKey: 'current',
	maximumKeys: 1,
	maximumTokenBytes: 4096,
	expiresIn: 60_000,
	now: Date.now,
});

// Use the last fetched row's ordered keys to create the next token.
const token = await cursor.encode([42]);
const checked = await Search.create({ pagination: { kind: 'cursor', cursor: token, limit: 20 } });

const statement = await pg.compilePage(checked, {
	table: ['public', 'people'],
	columns: { id: 'person_id' },
}, cursor);

console.log(statement.text, statement.values);
```

The existing cursor codec authenticates contract, order, provider semantics,
authorized filter/tenant context, expiry, and ordered key values. Rebuild that
binding from server-owned policy for each authorized query; a valid token is not
an access grant. `compilePage()` authenticates the opaque token before compiling.
Use `compile()` with `continuation: { values }` only when the boundary has already
been authenticated and validated by a trusted owner. A raw cursor token without
that boundary rejects. The initial page has no token or continuation.

For previous pages, pass `direction: 'before'` to `compilePage()`. SQL then fetches
the nearest preceding rows in reversed order, with NULLS FIRST. When
`statement.reversed` is true, reverse the fetched rows before presenting them in
canonical order. Use the first canonical row's keys for another previous page,
and the last row's keys for the next page. Keyset traversal avoids offset shifts
caused by inserts before a boundary; updates to sort keys still require a
transaction snapshot or an application consistency policy.

Keep the ordered keys available to the provider when building a continuation.
If a client's sparse projection omits them, fetch them privately in the provider
and remove them from the public response. The compiler does not manufacture row
keys or widen a requested projection automatically.

A keyset predicate does not guarantee a range scan. The final non-null unique key
uses a plain comparison so a single-key cursor can become an index condition.
Nullable multi-key alternatives may still become residual filters, depending on
indexes, collation, and PostgreSQL's plan. Inspect EXPLAIN ANALYZE with the actual
index and data distribution before claiming that a deep page avoids scanning a
prefix. [PostgreSQL's ordering rules](https://www.postgresql.org/docs/current/queries-order.html)
and [LIMIT/OFFSET behavior](https://www.postgresql.org/docs/current/queries-limit.html)
describe the underlying contracts.

### Measure the database work

From the repository checkout, set `UTILS_BENCH_DATABASE_URL` to an explicitly
disposable PostgreSQL database. The optional
[SQL benchmark](../../bench/query-postgres.bench.ts) creates a unique 20,000-row
fixture, checks that deep offset and keyset queries return the same twenty IDs,
and drops its own tables when it finishes. It borrows that database and closes
its connection pool. Run each mode separately:

```sh
node bench/query-postgres.bench.ts --check
node bench/query-postgres.bench.ts
node bench/query-postgres.bench.ts --explain
```

The first mode checks actual rows without timings. The second measures SQL
execution and result transfer for both a base relation and a unique-key join.
The third prints EXPLAIN ANALYZE/BUFFERS plans, so compare rows visited and index
conditions as well as duration. These are local observations rather than
production latency guarantees. In particular, the fixture's single non-null
primary key does not prove range scans for nullable composite ordering.

To measure compiler CPU separately, run
`node packages/query/postgres.bench.ts`. Its fixtures cover up to 32 keyset keys
and sixteen joins; database setup, execution, and token signing are excluded.

### Join a unique related record without multiplying pages

An application can add explicit INNER or LEFT joins and expose joined columns
through the same public field map. Every join target must match at most one row
per incoming row. The compiler requires `cardinality: 'one'` as an explicit
application assertion; it does not inspect database constraints. Back that
assertion with a PRIMARY KEY or UNIQUE constraint over the complete joined target
key. Many people may share one account; each person still occupies one page row.

```ts
import * as query from '@okikio/query';
import * as pg from '@okikio/query/postgres';
import * as schema from '@okikio/schema';

const Search = query.define({
	fields: {
		id: query.field(schema.number(), { sortable: true }),
		name: query.field(schema.nullable(schema.string())),
	},
	order: [query.asc('id', { tiebreaker: true })],
	pagination: query.offset({ defaultLimit: 20 }),
});

const checked = await Search.create();

const statement = pg.compile(checked, {
	table: ['public', 'people'],
	alias: 'p',
	columns: {
		id: 'person_id',
		name: { relation: 'a', column: 'display_name' },
	},
	joins: [{
		table: ['public', 'accounts'],
		alias: 'a',
		kind: 'left',
		cardinality: 'one',
		on: [{
			left: { relation: 'p', column: 'account_id' },
			right: { relation: 'a', column: 'id' },
		}],
	}],
});
```

Here the offset query exposes `id` and the related account `name`. LEFT retains people without accounts; their
account name is null. INNER removes them. Each ON pair connects an already
declared alias to the new target. Unknown/duplicate aliases, disconnected joins,
and to-many cardinality reject. Joins and physical identifiers are trusted
configuration; clients cannot introduce them. A to-many child collection needs
a separate query or an explicitly modeled row relation, rather than silently
changing what the parent page counts.

## Author the same request without URL notation

`condition()` keeps field names, enabled operators, and operand types connected. `create()` validates the complete
request and supplies omitted defaults.
Here `eq` means “equals” and `gte` means “greater than or equal to.” The request
means “name equals Ada OR score is at least 90.” `any()` supplies that OR;
`all()` requires every condition and `not()` reverses a condition. The first
printed value, `2`, counts the two conditions, not two matching people. The
second, `true`, checks that encoding and parsing preserve this request.

```ts runnable
import * as query from '@okikio/query';
import * as schema from '@okikio/schema';

// Expose only the supported fields and operators; a client cannot name arbitrary data fields.
const Search = query.define({
	fields: { name: query.field(schema.string()), score: query.field(schema.number()) },
	filters: { name: [query.eq], score: [query.gte, query.between] },
	expressions: ['all', 'any', 'not'],
	pagination: query.offset(),
});
const value = await Search.create({
	filter: query.any(
		Search.condition('name', 'eq', 'Ada'),
		Search.condition('score', 'gte', 90),
	),
	pagination: { kind: 'offset', limit: 10 },
	fields: ['name'],
});
console.log(Search.inspect(value).expression.leafCount);
console.log(Search.stringify(await Search.parse(Search.encode(value))) === Search.stringify(value));
```

```text output
2
true
```

A scalar operator requires one value, `between` requires a pair, `in`/`nin` require a nonempty list, and
`isNull`/`isNotNull` take no operand. These rules apply to types and runtime validation. A condition helper constructs
authoring data; the complete request becomes checked data only after `create()` succeeds.

## Choose the capability you need

| Import                     | Consumer job                                                                                                                        |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `@okikio/query`            | Define a collection search and use typed or HTTP input through one facade.                                                          |
| `@okikio/query/definition` | Declare fields, sort defaults, page policies, and the complete search contract.                                                     |
| `@okikio/query/operators`  | Reuse the named operator declarations without importing a complete definition.                                                      |
| `@okikio/query/expression` | Build `all`, `any`, and `not` trees, inspect them, or evaluate domain-owned leaves. No schema or data source is required.           |
| `@okikio/query/pagination` | Parse and encode bounded pages independently with `cursor`, `offset`, `pagination`, `parse`, `safeParse`, and `encode`.             |
| `@okikio/query/url`        | Use functional `parse(policy, input)`, `safeParse`, `encode(policy, value)`, and `stringify` with a separately imported definition. |
| `@okikio/query/types`      | Share the same policy, authoring, result, and adapter contracts.                                                                    |
| `@okikio/query/postgres`   | Compile checked filters, keyset or offset pages, and trusted to-one joins into bound PostgreSQL SELECT statements. |
| `@okikio/query/cursor`     | Authenticate ordered continuation keys against a caller-owned query, tenant, expiry, and signing-key policy. |

## Definition operations

| Operation                                                       | Contract                                                                                                                    |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `Search.parse(input)`                                           | Validate a URL, URLSearchParams, or documented plain wire record; returns a promise for `QueryValue`.                       |
| `Search.safeParse(input)`                                       | Same validation as `parse`, with `{ success, value }` or `{ success: false, issues }`.                                      |
| `Search.condition(field, operator, ...operand)`                 | Author a field condition with the definition's field/operator/input types.                                                  |
| `Search.create(input?)`, `Search.safeCreate(input?)`            | Validate semantic input and apply definition defaults.                                                                      |
| `Search.encode(value)`                                          | Encode checked output as URLSearchParams. Field transforms need a supported inverse if they cannot accept their own output. |
| `Search.normalize(value)`                                       | Create a canonical query without changing authored tree order or sort priority.                                             |
| `Search.stringify(value)`                                       | Encode canonical identity as ordinary URL text, not a cryptographic digest.                                                 |
| `Search.inspect(value)`                                         | Return authored structure, measured expression dimensions, and a separate canonical query.                                  |
| `Search.document()`, `Search.wireSchema()`                      | Describe fields, grammar, permissions, and budgets without contacting a provider.                                           |
| `Search.requirements()`, `Search.validateAdapter(capabilities)` | Check that a provider can preserve this definition's declared semantics.                                                    |

The output is data. It holds no live resource, opens no connection, and does not own cancellation. Parsing is
asynchronous because a field's Standard Schema validator may be asynchronous.

## Practical defaults and limits

Fields are selectable and unsortable by default. Filtering is disabled until an operator is declared for that field.
Boolean input defaults to ALL; enable ANY and NOT when the provider supports them. Pagination is explicit; each page
policy defaults to 50 results and permits at most 200.

Query input defaults to 20 filter leaves, 5 client sorts, 100 selected fields, 100 values per filter, 4096 characters
per string/bigint, 200 URL parameters, depth 8, and 100 siblings. These limits bound work before provider execution.
Unknown unrelated outer URL parameters are ignored so search can coexist with other endpoint controls. Unknown filter
fields, unsupported operators, and invalid requested values are errors.

`QueryValidationError` carries stable issue codes and paths. Use `safeParse` or `safeCreate` to display those issues.
Definition mistakes and invalid helper arguments throw at authoring time. A cursor remains opaque: a codec and
data-source adapter must authenticate it, check expiry, and implement stable traversal.

## Preserve transformed fields

A Standard Schema describes validation and transformation in one direction. Query accepts those validators directly,
including `@okikio/schema` readers. If a transform cannot accept its own output, use an owned `@okikio/schema/codec`
directly in `field()` or provide a typed synchronous `encode` inverse. A codec's encode direction must be synchronous
for URL encoding. Returned wire values still pass through Query's scalar codec; arbitrary objects are not serialized
implicitly.

Query's Standard Schema validator consumes wire input and returns `QueryValue`. Field `jsonSchema` metadata documents
the field's accepted input, while `outputJsonSchema` describes its JSON output when a transform cannot supply that
representation. Metadata is an explicit author contract; a Date or bigint value still needs an actual JSON-compatible
representation before it can be exported as JSON.

## Validation and documentation

`Search.wireSchema()` describes HTTP parameter names, syntax, examples and parser budgets. Use it explicitly for OpenAPI
documentation, for example `endpoint.input(Search, { jsonSchema: Search.wireSchema() })`. The document includes Query
extension metadata and broad descriptions of tagged values. It cannot validate the JSON decoded from a `~json:` operand
or reproduce the full URL/URLSearchParams/entry/record input contract.

HTTP documentation copies field schemas into separate parameter locations. A resource identifier, anchor or reference
would be duplicated or lose its original scope there, so `wireSchema()` rejects those field documents by name. Supply
inline `jsonSchema` metadata with the field's constraints for HTTP documentation. Resource-based `outputJsonSchema`
metadata remains available for the parsed output projection.

For that reason, Standard JSON Schema **input conversion throws**, naming an affected representation and field.
`Search.parse()`, `safeParse()` and `~standard.validate()` continue to validate all supported inputs. Documentation does
not bypass runtime field checks. A bare Query validator in a public endpoint fails automatic OpenAPI projection until
the endpoint supplies its explicit wire document.

Standard JSON Schema output conversion describes the parsed **structural type** in draft 07 or draft 2020-12. It retains
field constraints, operator membership, list arity, expression kinds/depth/immediate-child limits, selection
permissions, sort and stable-field membership, and pagination variants. An opaque or JavaScript-only scalar output fails
conversion with its field name. A field document containing relative `$ref` values needs an absolute resource `$id`
before embedding. Each complete field document is stored once and referenced by its operators, preserving nested
resource IDs as well as root IDs. Identical complete documents are shared across fields. Different field documents
cannot reuse a resource ID or anchor, even for an identical nested fragment; give them distinct identifiers or share the
same complete document.

Output JSON validation does not replace `parse()` or `create()`. The parser also checks total filter leaves across the
tree, total selected fields across resource sets, unique sort fields, wire lengths/parameter counts and relationships
such as `offset = (page - 1) * limit`. For example, a tree with two groups of two leaves can satisfy each group's
structural limit while exceeding a total budget of three filters. A page object can have valid integer fields yet
disagree with its calculated offset. Field transforms may add their own executable rejection rules.

The consumer tests validate real parsed and authored results using strict Ajv in both supported drafts and include those
structural counterexamples. Revalidating normalized output as raw wire input is not the same operation; use `create()`
for semantic authoring and `parse()` for wire input.

Continue with the [model](../../docs/query.md) and [cookbook](../../docs/query.md) for complete standalone and composed
examples, including a real array adapter, pages, URLs, transformed fields, and provider checks.

## Dates in typed URL values

Typed filters intentionally preserve a caller's native Date. Encoding writes its canonical ISO spelling; decoding
constructs a Date only when re-serializing it produces that exact spelling and the epoch value is finite. That check
rejects rollover dates and alternative spellings without changing the promised decoded type. A Temporal instant is a
different application type and belongs in an explicit field codec. Query's other regular expressions describe URL
operators, identifiers, and numeric value text, rather than calendar semantics.

## Use the same search contract with another provider

A search screen authors typed filters, while a public URL supplies untrusted text. Both can describe the same allowed
request through one definition.

Use Definition to declare allowed fields, Expression for typed authoring, URL for external syntax, and Pagination for
cursor policy. The storage provider still executes the query.

A validated request is not authorization or SQL. The application must enforce tenant access and the provider must
translate only the allowed operations.

## Choose an entry point

Use the table to find a focused import for the job you need. Contract links open the exact public source, including its
options and types.

| Import                     | Use it to                                                                      | Exact contract              |
| -------------------------- | ------------------------------------------------------------------------------ | --------------------------- |
| `@okikio/query`            | Use the package entry shown in the complete examples above.                    | [Contract](./mod.ts)        |
| `@okikio/query/definition` | Declare allowed fields, operators, sorting, and limits.                        | [Contract](./definition.ts) |
| `@okikio/query/operators`  | Select supported filter operations for a query definition.                     | [Contract](./operators.ts)  |
| `@okikio/query/types`      | Import public types for this capability; this entry does not start work.       | [Contract](./types.ts)      |
| `@okikio/query/expression` | Author typed filter expressions without URL syntax.                            | [Contract](./expression.ts) |
| `@okikio/query/pagination` | Construct and check pagination and cursor policy.                              | [Contract](./page.ts)       |
| `@okikio/query/url`        | Parse and serialize query URLs against an explicit definition.                 | [Contract](./parameters.ts) |
| `@okikio/query/cursor`     | Sign and verify bound, expiring pagination cursors with explicit key rotation. | [Contract](./cursor.ts)     |

## Authenticate a continuation token

A cursor is a next-page bookmark: it records where the previous page ended.
The provider needs a stable order and a unique tie-breaker so equal sort values
do not skip or repeat records. Here the unique ID supplies that tie-breaker.
The token is bound to the query contract and trusted tenant/filter context, so a
bookmark from one search is not accepted as a bookmark for another.

HMAC signs the token so the server can detect changes. It does not hide the
contents or authorize the caller. The server must still check access to the
underlying records. This complete example signs and reads one local bookmark;
it does not perform a database query.

```ts runnable=cursor-bookmark.ts
import * as schema from '@okikio/schema';
import { asc } from '@okikio/query';
import { create } from '@okikio/query/cursor';
import * as hmac from '@okikio/hash/hmac';
const signer = await hmac.create('sha256', crypto.getRandomValues(new Uint8Array(32)));
const cursor = create({
	contract: 'people.v1',
	order: [asc('id', { tiebreaker: true })],
	semantics: 'binary-text;nulls-last;unique-id',
	context: 'authorized-tenant-7|active-only',
	values: schema.string({ maxLength: 128 }),
}, {
	keys: [{ id: 'current', signer }],
	activeKey: 'current',
	maximumKeys: 2,
	maximumTokenBytes: 4096,
	expiresIn: 60000,
	now: Date.now,
});
const token = await cursor.encode('last-person-id');
console.log(await cursor.decode(token));
```

```text output
last-person-id
```

The example creates a temporary key. A service supplies its owned persistent key policy so tokens remain valid across
requests and restarts. Keep retired keys in `keys` while old tokens remain valid; encoding selects `activeKey` and
decoding tries only the addressed authorized key. `maximumKeys` bounds retained signers. There is no global key cache or
implicit key generation.

The versioned envelope authenticates the contract revision, exact sort priority, provider semantics, caller-selected
context, expiry and typed key values. Reusing a token with a different binding rejects with `CursorError`. Expiry uses
explicit safe epoch milliseconds; the exact expiry instant is rejected. Set `expiresIn` to null deliberately when no
expiry is required. Invalid clock and signer/codec defects keep their original errors. Authentication runs before
application-value validation. The token is visible data, not encryption: choose an opaque digest rather than placing
private tenant/filter details in its context.

`maximumTokenBytes` bounds the complete ASCII token, including identity and tag, before decoding; encoding checks both
the unsigned prefix and complete token. Application codecs must encode a scalar or a flat scalar list. The list length
must match the sort count. Query's tagged wire representation preserves empty strings, commas, finite numbers including
negative zero, bigint and valid Dates. Use an explicit codec when application objects need a scalar/list wire shape.

The last sort must be the sole unique tiebreaker, but the application must prove that uniqueness in its data source.
`semantics` records its null/collation policy; the codec does not derive SQL predicates, inspect database collation or
authorize a tenant. Select context from authorized, normalized query data before creating the codec. A signed token from
the wrong context cannot bypass those checks.

## Measure authenticated continuations

The focused benchmarks measure signed cursor encode/decode for 1, 4 and 8 order keys and query URL round trips with 1,
32 and 100 repeated values, plus rejection at 101. The benchmark compares against native signer over raw values. Raw
signatures omit expiry, context binding and cursor-envelope validation.

From the repository root, run the package's tests and untimed benchmark checks before collecting timings:

```sh
deno task --cwd=packages/query test
deno task --cwd=packages/query bench:check
deno task --cwd=packages/query bench
```

These commands use package-owned fixtures and development dependencies. The
[benchmark protocol](../../docs/benchmarks/01-running.md#choose-a-comparison-that-answers-the-question) explains fair
comparisons, raw report collection and the limits of local measurements.

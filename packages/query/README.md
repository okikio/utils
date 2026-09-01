`@okikio/query`
==============

Purpose
-------

`@okikio/query` defines storage-neutral collection queries for filters, sorting,
sparse fieldsets, and bounded pagination. It validates and normalizes public
query input but does not execute a database query.

How it fits
-----------

HTTP request parsing can produce a normalized query value from this package.
A concrete database adapter then translates the value into Drizzle, ClickHouse,
SPARQL, or another native query language and rejects unsupported semantics.

Storage-neutral public collection-query definitions for filtering, sorting,
sparse fieldsets, bounded pagination, validation, encoding, documentation, and
provider capability checks.

The package does not execute database queries, construct HTTP responses, or
implement cursor cryptography. Drizzle/PostgreSQL, ClickHouse, SPARQL, and
Supabase adapters translate the normalized query value into their native query
language and must declare which semantics they can honor.

Start here
----------

```ts
import * as query from '@okikio/query';

export const WidgetQuery = query.define({
  fields: {
    id: query.field(IdSchema, { sortable: true }),
    name: query.field(NameSchema, { sortable: true }),
    score: query.field(ScoreSchema, { sortable: true }),
    deletedAt: query.field(InstantSchema),
    internalNote: query.field(NoteSchema, { selectable: false }),
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

Cursor support requires exactly one stable tiebreaker so keyset traversal stays
deterministic.

Documented URL syntax
---------------------

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

Cursor, page, and offset modes cannot be mixed in one request. Unknown fields,
disallowed operators, invalid null semantics, duplicate sorts, excessive
values, and unsupported pagination fail closed with structured issues.

Provider adapters
-----------------

```ts
const compatibility = WidgetQuery.validateAdapter({
  operators: ['eq', 'gte', 'between', 'isNull'],
  pagination: ['offset'],
  fieldSelection: ['simple'],
  maximumSorts: 3,
});
```

Adapters reject unsupported operators or pagination strategies instead of
silently changing their meaning. Tenant, authorization, and row-level-security
predicates remain server-owned and are not represented by client filters.

`WidgetQuery.encode(value)` recreates canonical bracket filters, colon sorts,
sparse fieldsets, and the selected pagination form for link generation and
round-trip tests.


Request and adapter flow
------------------------

```ts
const ListImports = endpoint.get({
  id: 'imports.list',
  path: '/imports',
  query: ListImportsQuery,
  responses: [ImportPage],
  resources: [SelectImports],
});

const ListImportsHandler = endpoint.handler(ListImports, async (context) => {
  const selectImports = await context.resources.get(SelectImports);

  const page = await selectImports.execute({
    query: context.input.query,
    base: {
      organizationId: context.organization.id,
    },
    execution: context.execution,
  });

  return response.create(ImportPage, page);
});
```

The service runtime parses raw `URLSearchParams` and validates them through the
query definition before the handler runs. The handler receives a normalized
query value, not raw strings.

A provider package compiles the public definition once:

```ts
const SelectImports = postgres.collection(ListImportsQuery, {
  from: imports,
  columns: {
    id: imports.id,
    filename: imports.filename,
    status: imports.status,
    createdAt: imports.createdAt,
  },
  base: {
    organizationId: imports.organizationId,
  },
});
```

The adapter owns parameterized Drizzle expressions, keyset seek predicates,
count strategy, and cursor codec use. ClickHouse and SPARQL adapters map the
same normalized public contract into their native semantics and reject
unsupported combinations at adapter compilation.

Progressive usage
-----------------

The package participates in the complete domain-enrichment example in
`../../docs/composition.md`.  Read that guide when the
individual helpers make sense in isolation but their place in a service,
resource graph, runtime host, or workflow is not yet clear.

Convenience and the manual equivalent
-------------------------------------

Concrete map
~~~~~~~~~~~~

| Convenience | Manual equivalent | Concrete value |
| --- | --- | --- |
| `query.define()` | snapshot field/filter/order/pagination records, validate operators, defaults, aliases, and tiebreakers yourself | one storage-neutral query contract |
| `query.safeParse()` | descriptor-validate the raw record, parse every filter/order/page field, normalize values, and collect prefixed issues manually | untrusted query input becomes one normalized shape |
| `query.encode()` | serialize only deterministic scalar wire values and preserve repeated filters/order explicitly | round-trippable transport without arbitrary object coercion |

The table is intentionally mechanical: each row names the convenience, the lower-level work it replaces, and the invariant the utility actually owns. Use the manual column when debugging, extending the utility, or deciding whether the abstraction is buying enough to justify using it.


`@okikio/query` is a convenience layer, not a hidden runtime. You can reproduce its
core mechanics with URLSearchParams plus your own filter/sort AST, validator calls, pagination rules, and cursor encoding.

The utility keeps query meaning storage-neutral so Postgres, ClickHouse, SPARQL, or another adapter can compile the same normalized request.

When debugging or extending the package, keep that manual model in mind. The
utility should remove repetitive correctness work without making the underlying
Web, ECMAScript, Standard Schema, or runtime primitives impossible to recognize.


Operators, projection, and validation
------------------------------------

The query vocabulary intentionally exposes operators as small named values. In
addition to the operators shown above, the public set includes `ne`, `gt`, `lt`,
`lte`, `contains`, `startsWith`, `endsWith`, `inArray`, `notInArray`, and the
aliases `nin`/related selected operators supported by the definition.

Tooling and adapters also use:

- `document()` for deterministic query-definition metadata.
- `paginationParameters()` for the transport-neutral pagination parameter schema.
- `requirements()` for backend capability requirements implied by a definition.
- `QueryValidationError` when raw user query input cannot be normalized into the declared contract.


Source guide
------------

Start with this README, then use the source in this order when you need more
detail:

1. `mod.ts` shows the supported runtime operations and the composition shape.
2. `types.ts`, when present, shows the public value and behavior contracts.
3. `*_test.ts` files show edge cases, cancellation, invalid input, and lifecycle
   behavior as executable examples.
4. Read internal implementation files only when you need the exact state
   transition or performance-sensitive loop.

The README is the primary user documentation. It intentionally stays close to
the public source instead of maintaining a separate hand-written API reference.

import type { Temporal as Ponyfill } from '@okikio/duration/temporal';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { QueryExpression, QueryExpressionInspection } from './expression.ts';

/** Query field schema and public documentation metadata. */
export interface QueryField<Schema extends StandardSchemaV1 = StandardSchemaV1> {
	/** Stable discriminant used to recognize this query value. */
	readonly kind: 'query-field';
	/** Standard Schema that validates and converts this field before provider work. */
	readonly schema: Schema;
	/** Caller-authored explanation used by query documentation. */
	readonly description?: string;
	/** Whether clients may request this field in a sparse projection. */
	readonly selectable: boolean;
	/** Whether clients may place this field in the ordered sort list. */
	readonly sortable: boolean;
	/** Explicit wire schema override for documentation when inference cannot describe this field. */
	readonly jsonSchema?: unknown;
}

/** Input accepted by {@link field}. */
export interface QueryFieldOptions {
	/** Caller-authored explanation used by query documentation. */
	readonly description?: string;
	/** Whether clients may request this field in a sparse projection. */
	readonly selectable?: boolean;
	/** Whether clients may place this field in the ordered sort list. */
	readonly sortable?: boolean;
	/** Explicit wire schema override for documentation when inference cannot describe this field. */
	readonly jsonSchema?: unknown;
}

/** Named public field collection. */
export type QueryFields = Readonly<Record<string, QueryField>>;

/** Value type emitted by one query field. */
export type QueryFieldValue<Field extends QueryField> = StandardSchemaV1.InferOutput<Field['schema']>;

/** Built-in filter operator names. */
export type QueryOperatorName =
	| 'eq'
	| 'ne'
	| 'gt'
	| 'gte'
	| 'lt'
	| 'lte'
	| 'between'
	| 'in'
	| 'nin'
	| 'contains'
	| 'icontains'
	| 'startsWith'
	| 'endsWith'
	| 'isNull'
	| 'isNotNull';

/** Immutable query operator definition. */
export interface QueryOperator<Name extends QueryOperatorName = QueryOperatorName> {
	/** Stable discriminant used to recognize this query value. */
	readonly kind: 'query-operator';
	/** Stable identity of this operator definition. */
	readonly id: `query:${Name}`;
	/** Public field or operator name used in the URL grammar. */
	readonly name: Name;
	/** Validated operand or typed operand list; nullary operators omit it. */
	readonly value: 'none' | 'one' | 'many' | 'pair';
	/** Caller-authored explanation used by query documentation. */
	readonly description: string;
}

/** Allowed filter operators by public field. */
export type QueryFilters<Fields extends QueryFields> = Readonly<
	Partial<Record<keyof Fields & string, readonly QueryOperator[]>>
>;

/** Boolean composition supported by a definition or provider adapter. */
export type QueryExpressionKind = 'all' | 'any' | 'not';

/** Sort direction. */
export type QuerySortDirection = 'asc' | 'desc';

/** Static default sort entry. */
export interface QueryOrder<Field extends string = string> {
	/** Stable discriminant used to recognize this query value. */
	readonly kind: 'query-order';
	/** Public schema field selected by this condition or sort. */
	readonly field: Field;
	/** Ascending or descending order; sort entry order remains significant. */
	readonly direction: QuerySortDirection;
	/** Whether this sort makes cursor traversal stable when earlier sort values tie. */
	readonly tiebreaker: boolean;
}

/** Cursor query parameter names. */
export interface CursorPaginationParameters {
	/** Public URL parameter name for the opaque cursor. */
	readonly cursor: string;
	/** Public URL parameter name for page size. */
	readonly limit: string;
}

/** Offset/page query parameter names. */
export interface OffsetPaginationParameters {
	/** Public URL parameter name for the zero-based offset. */
	readonly offset: string;
	/** Public URL parameter name for page size. */
	readonly limit: string;
	/** Public URL parameter name for the one-based page. */
	readonly page: string;
	/** Public URL parameter name for page size in page syntax. */
	readonly perPage: string;
}

/** Cursor pagination policy. */
export interface CursorPaginationDefinition {
	/** Stable discriminant used to recognize this query value. */
	readonly kind: 'query-pagination';
	/** Pagination mode selected by this static policy. */
	readonly type: 'cursor';
	/** Page size used when the client omits it; must fall within the configured bounds. */
	readonly defaultLimit: number;
	/** Largest accepted page size, preventing an unbounded client read. */
	readonly maximumLimit: number;
	/** Smallest accepted page size. */
	readonly minimumLimit: number;
	/** Optional cursor lifetime. Calendar units use the documented 2000-01-01 anchor when converted; native and ponyfill durations are accepted. */
	readonly ttl?: Temporal.Duration | Ponyfill.Duration;
	/** Explicit URL parameter names; defaults are resolved when the policy is authored. */
	readonly parameters: CursorPaginationParameters;
}

/** Offset pagination policy, including page-number syntax. */
export interface OffsetPaginationDefinition {
	/** Stable discriminant used to recognize this query value. */
	readonly kind: 'query-pagination';
	/** Pagination mode selected by this static policy. */
	readonly type: 'offset';
	/** Page size used when the client omits it; must fall within the configured bounds. */
	readonly defaultLimit: number;
	/** Largest accepted page size, preventing an unbounded client read. */
	readonly maximumLimit: number;
	/** Smallest accepted page size. */
	readonly minimumLimit: number;
	/** Largest accepted offset; the provider still owns the cost of skipping rows. */
	readonly maximumOffset: number;
	/** Wire spelling emitted for default offset pagination: offset/limit or page/per_page. */
	readonly defaultStyle: 'offset' | 'page';
	/** Explicit URL parameter names; defaults are resolved when the policy is authored. */
	readonly parameters: OffsetPaginationParameters;
}

/** Explicitly supported pagination modes for one endpoint. */
export interface PaginationModesDefinition {
	/** Stable discriminant used to recognize this query value. */
	readonly kind: 'query-pagination-modes';
	/** Pagination mode selected by this static policy. */
	readonly type: 'modes';
	/** Mode used when the request has no explicit pagination selector. */
	readonly default: 'cursor' | 'offset';
	/** Opaque cursor token; only its codec interprets or authenticates the payload. */
	readonly cursor?: CursorPaginationDefinition;
	/** Zero-based start of the requested result window. */
	readonly offset?: OffsetPaginationDefinition;
}

/** Supported pagination definitions. */
export type QueryPaginationDefinition =
	| CursorPaginationDefinition
	| OffsetPaginationDefinition
	| PaginationModesDefinition;

/** Input accepted by {@link cursor}. */
export interface CursorPaginationOptions {
	/** Page size used when the client omits it; must fall within the configured bounds. */
	readonly defaultLimit?: number;
	/** Largest accepted page size, preventing an unbounded client read. */
	readonly maximumLimit?: number;
	/** Smallest accepted page size. */
	readonly minimumLimit?: number;
	/** Optional cursor lifetime. Calendar units use the documented 2000-01-01 anchor when converted; native and ponyfill durations are accepted. */
	readonly ttl?: Temporal.Duration | Ponyfill.Duration;
	/** Explicit URL parameter names; defaults are resolved when the policy is authored. */
	readonly parameters?: Partial<CursorPaginationParameters>;
}

/** Input accepted by {@link offset}. */
export interface OffsetPaginationOptions {
	/** Page size used when the client omits it; must fall within the configured bounds. */
	readonly defaultLimit?: number;
	/** Largest accepted page size, preventing an unbounded client read. */
	readonly maximumLimit?: number;
	/** Smallest accepted page size. */
	readonly minimumLimit?: number;
	/** Largest accepted offset; the provider still owns the cost of skipping rows. */
	readonly maximumOffset?: number;
	/** Wire spelling emitted for default offset pagination: offset/limit or page/per_page. */
	readonly defaultStyle?: 'offset' | 'page';
	/** Explicit URL parameter names; defaults are resolved when the policy is authored. */
	readonly parameters?: Partial<OffsetPaginationParameters>;
}

/** Input accepted by {@link pagination}. */
export interface PaginationModesOptions {
	/** Mode used when the request has no explicit pagination selector. */
	readonly default?: 'cursor' | 'offset';
	/** Opaque cursor token; only its codec interprets or authenticates the payload. */
	readonly cursor?: CursorPaginationDefinition;
	/** Zero-based start of the requested result window. */
	readonly offset?: OffsetPaginationDefinition;
}

/** One allowed JSON:API sparse-fieldset resource. */
export interface QueryFieldsetDefinition {
	/** Public field declarations or sparse projection; hidden fields remain unavailable to clients. */
	readonly fields: readonly string[];
	/** Caller-authored explanation used by query documentation. */
	readonly description?: string;
}

/** Authoring value accepted for a resource fieldset. */
export type QueryFieldsetInput = readonly string[] | QueryFieldsetDefinition;

/** Named sparse-fieldset resource collection. */
export type QueryFieldsets = Readonly<Record<string, QueryFieldsetDefinition>>;

/** Complete storage-neutral query definition input. */
export interface QueryDefinitionInput<Fields extends QueryFields> {
	/** Public field declarations or sparse projection; hidden fields remain unavailable to clients. */
	readonly fields: Fields;
	/** Declared operators by field; runtime values retain the conjunction compatibility view. */
	readonly filters?: QueryFilters<Fields>;
	/** Defaults to conjunction only for deployed flat-filter consumers. */
	readonly expressions?: readonly QueryExpressionKind[];
	/** Sort entries in priority order; canonical normalization does not reorder their priority. */
	readonly order?: readonly QueryOrder<keyof Fields & string>[];
	/** Enabled static modes or one validated request window; mixed client modes are rejected. */
	readonly pagination: QueryPaginationDefinition;
	/** Allowed sparse field names grouped under explicit resource keys. */
	readonly fieldsets?: Readonly<Record<string, QueryFieldsetInput>>;
	/** Maximum filter leaves accepted before a request reaches field validators. */
	readonly maximumFilters?: number;
	/** Maximum client-selected sorts; a stable cursor tiebreaker remains required. */
	readonly maximumSorts?: number;
	/** Maximum selected fields across the requested projection. */
	readonly maximumSelectedFields?: number;
	/** Maximum operands in one list filter, including tagged values. */
	readonly maximumValuesPerFilter?: number;
	/** Maximum string or bigint text length accepted after decoding. */
	readonly maximumValueLength?: number;
	/** Maximum URL parameters, counting repeated keys separately. */
	readonly maximumParameters?: number;
	/** Maximum expression depth, including leaf conditions. */
	readonly maximumDepth?: number;
	/** Maximum immediate children in one Boolean group. */
	readonly maximumSiblings?: number;
	/** Public projection used when the request does not select fields explicitly. */
	readonly defaultFields?: readonly (keyof Fields & string)[];
	/** Caller-authored explanation used by query documentation. */
	readonly description?: string;
}

/** Pagination parameter names exposed to server/response adapters. */
export interface QueryPaginationParameters {
	/** Public URL parameter name for the opaque cursor. */
	readonly cursor?: string;
	/** Public URL parameter name for page size. */
	readonly limit: string;
	/** Public URL parameter name for the zero-based offset. */
	readonly offset?: string;
	/** Public URL parameter name for the one-based page. */
	readonly page?: string;
	/** Public URL parameter name for page size in page syntax. */
	readonly perPage?: string;
}

/** One normalized filter. */
export type QueryFilter<Fields extends QueryFields> = {
	readonly [Key in keyof Fields & string]: Readonly<{
		/** Public schema field selected by this condition or sort. */
		readonly field: Key;
		readonly operator: QueryOperatorName;
		/** Validated operand or typed operand list; nullary operators omit it. */
		readonly value?: QueryFieldValue<Fields[Key]> | readonly QueryFieldValue<Fields[Key]>[];
	}>;
}[keyof Fields & string];

/** One normalized client-selected sort. */
export interface QuerySort<Field extends string = string> {
	/** Public schema field selected by this condition or sort. */
	readonly field: Field;
	/** Ascending or descending order; sort entry order remains significant. */
	readonly direction: QuerySortDirection;
	/** Whether this sort makes cursor traversal stable when earlier sort values tie. */
	readonly tiebreaker: boolean;
}

/** Simple sparse-field selection for the endpoint's primary resource. */
export interface SimpleFieldSelection<Field extends string = string> {
	/** Stable discriminant used to recognize this query value. */
	readonly kind: 'simple';
	/** Public field declarations or sparse projection; hidden fields remain unavailable to clients. */
	readonly fields: readonly Field[];
}

/** JSON:API-style sparse fieldsets keyed by resource type. */
export interface ResourceFieldSelection {
	/** Stable discriminant used to recognize this query value. */
	readonly kind: 'resource';
	/** Sparse field names grouped by their declared resource type. */
	readonly resources: Readonly<Record<string, readonly string[]>>;
}

/** Normalized sparse-field selection. */
export type QueryFieldSelection<Field extends string = string> =
	| SimpleFieldSelection<Field>
	| ResourceFieldSelection;

/** Normalized cursor pagination request. */
export interface CursorPagination {
	/** Stable discriminant used to recognize this query value. */
	readonly kind: 'cursor';
	/** Maximum requested items in this page, validated against the definition bounds. */
	readonly limit: number;
	/** Opaque cursor token; only its codec interprets or authenticates the payload. */
	readonly cursor?: string;
}

/** Normalized offset or page-number pagination request. */
export interface OffsetPagination {
	/** Stable discriminant used to recognize this query value. */
	readonly kind: 'offset';
	/** Maximum requested items in this page, validated against the definition bounds. */
	readonly limit: number;
	/** Zero-based start of the requested result window. */
	readonly offset: number;
	/** Authored offset or page spelling, retained for non-canonical encoding. */
	readonly source: 'offset' | 'page';
	/** One-based page number retained when the caller used page syntax. */
	readonly page?: number;
}

/** Complete normalized collection query. */
export interface QueryValue<Fields extends QueryFields = QueryFields> {
	/** Authored Boolean tree. Absent on legacy values authored with flat filters. */
	readonly filter?: QueryExpression<QueryFilter<Fields>>;
	/** Conjunction compatibility view; throws for an ANY/NOT tree. */
	readonly filters: readonly QueryFilter<Fields>[];
	/** Sort entries in priority order; canonical normalization does not reorder their priority. */
	readonly order: readonly QuerySort<keyof Fields & string>[];
	/** Public field declarations or sparse projection; hidden fields remain unavailable to clients. */
	readonly fields: QueryFieldSelection<keyof Fields & string>;
	/** Enabled static modes or one validated request window; mixed client modes are rejected. */
	readonly pagination: CursorPagination | OffsetPagination;
}

/** Validation issue emitted while parsing a collection query. */
export interface QueryIssue extends StandardSchemaV1.Issue {
	/** Stable machine-readable reason for a rejected query or provider capability. */
	readonly code:
		| 'unknown-field'
		| 'unknown-fieldset'
		| 'unknown-operator'
		| 'invalid-value'
		| 'invalid-sort'
		| 'duplicate-sort'
		| 'invalid-limit'
		| 'invalid-offset'
		| 'invalid-page'
		| 'invalid-cursor'
		| 'pagination-conflict'
		| 'unsupported-pagination'
		| 'field-selection-conflict'
		| 'too-many-parameters'
		| 'too-many-filter-values'
		| 'too-many-selected-fields'
		| 'value-too-long'
		| 'too-many-filters'
		| 'too-many-sorts'
		| 'sorting-disabled'
		| 'selection-disabled'
		| 'invalid-expression'
		| 'unsupported-expression'
		| 'expression-too-deep'
		| 'too-many-siblings'
		| 'invalid-input';
}

/** Non-throwing query parse result. */
export type QueryParseResult<Value> =
	| Readonly<{ readonly success: true; readonly value: Value }>
	| Readonly<{ readonly success: false; readonly issues: readonly QueryIssue[] }>;

/** Query semantics required by a provider adapter. */
export interface QueryRequirements {
	/** Filter operations that this definition requires or the provider can honor. */
	readonly operators: readonly QueryOperatorName[];
	/** Enabled Boolean composition; omission at a provider boundary means conjunction only. */
	readonly expressions: readonly QueryExpressionKind[];
	/** Enabled static modes or one validated request window; mixed client modes are rejected. */
	readonly pagination: readonly ('cursor' | 'offset')[];
	/** Supported simple and resource-keyed sparse projection forms. */
	readonly fieldSelection: readonly ('simple' | 'resource')[];
	/** Maximum complete order length, including an appended stable cursor tiebreaker. */
	readonly maximumSorts: number;
	/** Public field that makes cursor traversal deterministic for equal earlier sorts. */
	readonly stableTiebreaker?: string;
}

/** Capabilities truthfully supported by one provider adapter. */
export interface QueryAdapterCapabilities {
	/** Filter operations that this definition requires or the provider can honor. */
	readonly operators: 'all' | readonly QueryOperatorName[];
	/** Omission means conjunction only for existing flat-filter adapters. */
	readonly expressions?: readonly QueryExpressionKind[];
	/** Enabled static modes or one validated request window; mixed client modes are rejected. */
	readonly pagination: readonly ('cursor' | 'offset')[];
	/** Supported simple and resource-keyed sparse projection forms. */
	readonly fieldSelection: readonly ('simple' | 'resource')[];
	/** Maximum complete order length the adapter can execute, including a stable cursor tiebreaker. */
	readonly maximumSorts?: number;
}

/** One provider capability mismatch. */
export interface QueryAdapterIssue {
	/** Stable machine-readable reason for a rejected query or provider capability. */
	readonly code:
		| 'unsupported-operator'
		| 'unsupported-expression'
		| 'unsupported-pagination'
		| 'unsupported-field-selection'
		| 'sort-limit';
	/** Explanation for a capability mismatch; callers should branch on the stable code. */
	readonly message: string;
}

/** Provider capability validation result. */
export type QueryAdapterValidationResult =
	| Readonly<{ readonly valid: true; readonly requirements: QueryRequirements }>
	| Readonly<
		{ readonly valid: false; readonly requirements: QueryRequirements; readonly issues: readonly QueryAdapterIssue[] }
	>;

/** Portable opaque cursor codec contract implemented by a resource adapter. */
export interface CursorCodec<Payload = Readonly<Record<string, unknown>>> {
	/** Encode a trusted payload into an opaque token. */
	encode(payload: Payload): string | Promise<string>;
	/** Decode and authenticate an opaque token; malformed or forged tokens must fail. */
	decode(cursor: string): Payload | Promise<Payload>;
}

/** Runtime and documentation contract exposed by one query definition. */
export interface QueryDefinition<Fields extends QueryFields = QueryFields>
	extends StandardSchemaV1<unknown, QueryValue<Fields>> {
	/** Stable discriminant used to recognize this query value. */
	readonly kind: 'query-definition';
	/** Public field declarations or sparse projection; hidden fields remain unavailable to clients. */
	readonly fields: Fields;
	/** Declared operators by field; runtime values retain the conjunction compatibility view. */
	readonly filters: QueryFilters<Fields>;
	/** Enabled Boolean composition; omission at a provider boundary means conjunction only. */
	readonly expressions: readonly QueryExpressionKind[];
	/** Sort entries in priority order; canonical normalization does not reorder their priority. */
	readonly order: readonly QueryOrder<keyof Fields & string>[];
	/** Enabled static modes or one validated request window; mixed client modes are rejected. */
	readonly pagination: QueryPaginationDefinition;
	/** Allowed sparse field names grouped under explicit resource keys. */
	readonly fieldsets: QueryFieldsets;
	/** Maximum filter leaves accepted before a request reaches field validators. */
	readonly maximumFilters: number;
	/** Maximum client-selected sorts; a stable cursor tiebreaker remains required. */
	readonly maximumSorts: number;
	/** Maximum selected fields across the requested projection. */
	readonly maximumSelectedFields: number;
	/** Maximum operands in one list filter, including tagged values. */
	readonly maximumValuesPerFilter: number;
	/** Maximum string or bigint text length accepted after decoding. */
	readonly maximumValueLength: number;
	/** Maximum URL parameters, counting repeated keys separately. */
	readonly maximumParameters: number;
	/** Maximum expression depth, including leaf conditions. */
	readonly maximumDepth: number;
	/** Maximum immediate children in one Boolean group. */
	readonly maximumSiblings: number;
	/** Public projection used when the request does not select fields explicitly. */
	readonly defaultFields: readonly (keyof Fields & string)[];
	/** Caller-authored explanation used by query documentation. */
	readonly description?: string;
	/** Standard JSON Schema projection for the accepted wire input; runtime parsing owns full grammar validation. */
	readonly '~standard-json-schema': Readonly<{
		/** Standard JSON Schema protocol version. */
		readonly version: 1;
		/** Stable schema provider identifier. */
		readonly vendor: 'utils-query';
		/** Explicit wire schema override for documentation when inference cannot describe this field. */
		readonly jsonSchema: () => Readonly<Record<string, unknown>>;
	}>;
	/** Describe the actual flat URL fields accepted by this definition. */
	wireSchema(): Readonly<Record<string, unknown>>;
	/** Validate URLSearchParams or plain query data; throw QueryValidationError on rejected input. */
	parse(input: unknown): Promise<QueryValue<Fields>>;
	/** Validate the same input while returning structured issues instead of throwing. */
	safeParse(input: unknown): Promise<QueryParseResult<QueryValue<Fields>>>;
	/** Encode a validated query while preserving authored ordering and pagination spelling. */
	encode(value: QueryValue<Fields>): URLSearchParams;
	/** Return a separate canonical query, preserving scalar types and sort priority. */
	normalize(value: QueryValue<Fields>): QueryValue<Fields>;
	/** Encode canonical query identity as an ordinary URL string; this is not a cryptographic digest. */
	stringify(value: QueryValue<Fields>): string;
	/** Return the authored tree, its measured bounds and a separate normalized projection. */
	inspect(value: QueryValue<Fields>): QueryInspection<Fields>;
	/** Describe public fields, wire forms, capabilities and budgets without contacting a provider. */
	document(): QueryDocument;
	/** List semantics that a provider must honor for this definition. */
	requirements(): QueryRequirements;
	/** Compare declared provider capabilities and reject any semantic downgrade. */
	validateAdapter(capabilities: QueryAdapterCapabilities): QueryAdapterValidationResult;
}

/** JSON-safe query documentation. */
export interface QueryDocument {
	/** Caller-authored explanation used by query documentation. */
	readonly description?: string;
	/** Public field declarations or sparse projection; hidden fields remain unavailable to clients. */
	readonly fields: readonly Readonly<{
		/** Public field or operator name used in the URL grammar. */
		readonly name: string;
		/** Caller-authored explanation used by query documentation. */
		readonly description?: string;
		/** Whether clients may request this field in a sparse projection. */
		readonly selectable: boolean;
		/** Whether clients may place this field in the ordered sort list. */
		readonly sortable: boolean;
		/** Filter operations that this definition requires or the provider can honor. */
		readonly operators: readonly QueryOperatorName[];
	}>[];
	/** Allowed sparse field names grouped under explicit resource keys. */
	readonly fieldsets: Readonly<Record<string, QueryFieldsetDefinition>>;
	/** Authored default sorts in priority order, including the cursor tiebreaker. */
	readonly defaultOrder: readonly QueryOrder[];
	/** Enabled static modes or one validated request window; mixed client modes are rejected. */
	readonly pagination: QueryPaginationDefinition;
	/** Maximum filter leaves accepted before a request reaches field validators. */
	readonly maximumFilters: number;
	/** Maximum client-selected sorts; a stable cursor tiebreaker remains required. */
	readonly maximumSorts: number;
	/** Maximum selected fields across the requested projection. */
	readonly maximumSelectedFields: number;
	/** Maximum operands in one list filter, including tagged values. */
	readonly maximumValuesPerFilter: number;
	/** Maximum string or bigint text length accepted after decoding. */
	readonly maximumValueLength: number;
	/** Maximum URL parameters, counting repeated keys separately. */
	readonly maximumParameters: number;
	/** Maximum expression depth, including leaf conditions. */
	readonly maximumDepth: number;
	/** Maximum immediate children in one Boolean group. */
	readonly maximumSiblings: number;
	/** Enabled Boolean composition; omission at a provider boundary means conjunction only. */
	readonly expressions: readonly QueryExpressionKind[];
	/** Public projection used when the request does not select fields explicitly. */
	readonly defaultFields: readonly string[];
	/** Documented public URL grammar; runtime parsing enforces its full structural bounds. */
	readonly wire: Readonly<{
		/** Authored Boolean tree; leaf conditions carry field-schema-validated operands. */
		readonly filter: 'filter[field]=value / filter[field][operator]=value';
		/** Tree grammar or measured structural information for the authored expression. */
		readonly expression:
			'filter[$all][index][field][operator]=value / filter[$any][index][field][operator]=value / filter[$not][field][operator]=value';
		/** Validated operand or typed operand list; nullary operators omit it. */
		readonly value: 'raw scalar or comma list / ~json: typed scalar or list';
		/** Documented colon-delimited sort grammar. */
		readonly sort: 'sort=field:direction,field:direction';
		/** Public field declarations or sparse projection; hidden fields remain unavailable to clients. */
		readonly fields: 'fields=a,b / fields[resource]=a,b';
		/** Enabled static modes or one validated request window; mixed client modes are rejected. */
		readonly pagination: readonly string[];
	}>;
}

/** Authored tree plus a separate canonical projection for editors and identity. */
export interface QueryInspection<Fields extends QueryFields = QueryFields> {
	/** Authored Boolean tree; leaf conditions carry field-schema-validated operands. */
	readonly filter?: QueryExpression<QueryFilter<Fields>>;
	/** Separate canonical value used for identity while leaving the authored tree intact. */
	readonly normalized: QueryValue<Fields>;
	/** Tree grammar or measured structural information for the authored expression. */
	readonly expression: QueryExpressionInspection;
}

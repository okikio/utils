/** Serializable session references and authoritative lease records. No live resource crosses this contract. @module */
import * as schema from '@okikio/schema';

/** Bound persisted identities before any authority operation allocates or locks a record. */
const IdSchema: schema.JsonReader<string, string> = schema.string({ minLength: 1, maxLength: 192 });
/** Whole-millisecond policy budgets, capped at one day; these are durations, not timestamps. */
const MillisecondsSchema: schema.JsonReader<number, number> = schema.number({
	integer: true,
	minimum: 30,
	maximum: 86400000,
});
/** Exact registered executor and its deployment generation; this is placement metadata, not authentication. */
export const OwnerSchema: schema.ObjectReader<
	{ readonly id: schema.JsonReader<string, string>; readonly generation: schema.JsonReader<number, number> },
	'reject'
> = schema.object({
	/** Registered executor name used for placement, distinct from an OS PID or pool index. */
	id: IdSchema,
	/** Deployment generation; replacing that registration must not accept saved older work. */
	generation: schema.number({ integer: true, minimum: 1 }),
});
/** Address of one host in a provider pool. It is routing data, not an OS identifier or a credential. */
export const HostSchema: schema.ObjectReader<
	{ readonly pool: schema.JsonReader<string, string>; readonly id: schema.JsonReader<string, string> },
	'reject'
> = schema.object({ pool: IdSchema, id: IdSchema });
/** Physical host lifetime carried with a session when its provider owns several hosts. */
export type HostType = schema.Output<typeof HostSchema>;
/** Portable reference that may be saved in workflow history. It never contains the resource value or a borrow token. */
export const ReferenceSchema: schema.ObjectReader<
	{
		readonly id: schema.JsonReader<string, string>;
		readonly resource: schema.JsonReader<string, string>;
		readonly owner: typeof OwnerSchema;
		readonly incarnation: schema.JsonReader<string, string>;
		readonly host: schema.JsonReader<
			schema.Output<typeof HostSchema> | undefined,
			schema.Input<typeof HostSchema> | undefined
		>;
	},
	'reject'
> = schema.object({
	/** Unique session identity. A replacement always receives a new ID. */
	id: IdSchema,
	/** Resource kind checked by the receiving owner before any borrow. */
	resource: IdSchema,
	/** Exact executor and deployment generation that must receive later uses. */
	owner: OwnerSchema,
	/** Random owner incarnation, distinct from a deployment's reusable executor name. */
	incarnation: IdSchema,
	/** Exact pool host, captured by the creation activity rather than reconstructed by every caller. */
	host: schema.optional(HostSchema),
});
/** Validated portable session reference. */
export type ReferenceType = schema.Output<typeof ReferenceSchema>;
/** Placement identity supplied by deployment. */
export type OwnerType = schema.Output<typeof OwnerSchema>;
/** Explicit bounds; renewal extends liveness, never idle retention. Durations are whole milliseconds. */
export const PolicySchema: schema.ObjectReader<
	{
		readonly leaseMs: schema.JsonReader<number, number>;
		readonly idleMs: schema.JsonReader<number, number>;
		readonly borrowMs: schema.JsonReader<number, number>;
		readonly maximumBorrows: schema.JsonReader<number, number | undefined>;
	},
	'reject'
> = schema.object({
	/** Owner heartbeat expiry in whole milliseconds, from 30 through 86400000. */
	leaseMs: MillisecondsSchema,
	/** Idle retention after the last borrow release. Heartbeats do not extend it. */
	idleMs: MillisecondsSchema,
	/** Borrow liveness renewed only while its action/cleanup is still held by the physical owner. */
	borrowMs: MillisecondsSchema,
	/** One is exclusive. Higher values require a concurrency-safe resource and borrower implementation. */
	maximumBorrows: schema.defaults(schema.number({ integer: true, minimum: 1, maximum: 128 }), () => 1),
});
/** Authoring policy; omitted maximumBorrows selects exclusive borrowing. */
export type PolicyInputType = schema.Input<typeof PolicySchema>;
/** Validated session lease and borrowing policy. */
export type PolicyType = schema.Output<typeof PolicySchema>;
/** Short-lived borrow receipt. Never reuse it for another operation or persist it as a resumable resource handle. */
export const ClaimSchema: schema.ObjectReader<
	{ readonly reference: typeof ReferenceSchema; readonly id: schema.JsonReader<string, string> },
	'reject'
> = schema.object({
	/** Session whose admission was granted; a token cannot cross resource lifetimes. */
	reference: ReferenceSchema,
	/** Fresh borrow token; release and renewal require this exact active claim. */
	id: IdSchema,
});
/** Borrow identity checked during release and renewal. */
export type ClaimType = schema.Output<typeof ClaimSchema>;
/** Stored authority; expiry is evaluated using the store's clock while holding its serialization lock. */
export const RecordSchema: schema.ObjectReader<
	{
		readonly reference: typeof ReferenceSchema;
		readonly policy: typeof PolicySchema;
		readonly state: schema.JsonReader<'open' | 'closed' | 'lost', 'open' | 'closed' | 'lost'>;
		readonly expires: schema.JsonReader<number, number>;
		readonly idleExpires: schema.JsonReader<number, number>;
		readonly updated: schema.JsonReader<number, number>;
		readonly claims: schema.JsonReader<
			{ id: string; expires: number }[],
			schema.ObjectInput<
				{ readonly id: schema.JsonReader<string, string>; readonly expires: schema.JsonReader<number, number> }
			>[]
		>;
	},
	'reject'
> = schema.object({
	reference: ReferenceSchema,
	policy: PolicySchema,
	/** Both terminal states revoke admission; neither proves physical cleanup has finished. */
	state: schema.oneOf(['open', 'closed', 'lost']),
	/** Absolute milliseconds from the authority's clock. Late renewal cannot revive this record. */
	expires: schema.number(),
	/** Absolute idle deadline on the authority clock; heartbeats do not extend it. */
	idleExpires: schema.number(),
	/** Last authoritative mutation time in absolute milliseconds, not client-local time. */
	updated: schema.number(),
	/** At most policy.maximumBorrows entries. An expired entry loses the entire session. */
	claims: schema.array(schema.object({ id: IdSchema, expires: schema.number() }), { maxLength: 128 }),
});
/** Stored session state; the resource itself remains solely on its physical owner. */
export type RecordType = schema.Output<typeof RecordSchema>;

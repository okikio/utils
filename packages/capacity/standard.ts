import type { StandardSchemaV1 } from '@standard-schema/spec';
import * as recordCore from '@okikio/record';
import * as schema from '@okikio/schema';

import type {
	CheckResult,
	CapacityConstraint,
	ConstraintResult,
	CapacityDefinition,
	CapacityField,
	CapacityFields,
	CapacityValues,
	CapacityStatusType,
	CapacityUnit,
} from './types.ts';

/** Compile composed capacity field records into one statically visible field contract. */
export type MergeFields<Definitions extends readonly CapacityFields[]> =
	Definitions extends readonly [infer Head extends CapacityFields, ...infer Tail extends readonly CapacityFields[]]
		? Head & MergeFields<Tail>
		: Readonly<Record<never, never>>;

/** Error raised when validated values exceed one or more declared capacity constraints. */
export class CapacityExceededError extends RangeError {
	readonly check: CheckResult;

	constructor(check: CheckResult) {
		const exceeded = check.constraints.filter((entry) => entry.status === 'exceeded');
		const details = exceeded.map((entry) =>
			`${entry.id}: used ${entry.used}, maximum ${entry.maximum} ${entry.unit.symbol ?? entry.unit.id}`
		).join('; ');
		super(details.length === 0 ? 'Capacity was exceeded.' : `Capacity was exceeded: ${details}.`);
		this.name = 'CapacityExceededError';
		this.check = check;
	}
}

/** Define one reusable unit without attaching it to a runtime resource. */
export function unit<const Id extends string>(
	id: Id,
	input: Readonly<{ readonly description: string; readonly symbol?: string }>,
): CapacityUnit<Id> {
	identifier(id, 'unit id');
	text(input.description, 'unit description');
	if (input.symbol !== undefined) text(input.symbol, 'unit symbol');
	return Object.freeze({ id, description: input.description, ...(input.symbol === undefined ? {} : { symbol: input.symbol }) });
}

/** Attach a Standard Schema contract and meaning to one capacity field. */
export function field<
	const Schema extends StandardSchemaV1,
	const UnitType extends CapacityUnit,
>(
	valueSchema: Schema,
	valueUnit: UnitType,
	input: Readonly<{ readonly description: string }>,
): CapacityField<Schema, UnitType> {
	schema.assert(valueSchema, 'capacity field schema');
	assertUnit(valueUnit);
	text(input.description, 'capacity field description');
	return Object.freeze({ schema: valueSchema, unit: valueUnit, description: input.description });
}

/** Define one measurable relationship between used and maximum capacity. */
export function constraint<
	Value extends Readonly<Record<string, unknown>>,
	const UnitType extends CapacityUnit,
>(input: Readonly<{
	readonly id: string;
	readonly description: string;
	readonly unit: UnitType;
	readonly used: (value: Value) => number;
	readonly maximum: (value: Value) => number;
}>): CapacityConstraint<Value, UnitType> {
	identifier(input.id, 'constraint id');
	text(input.description, 'constraint description');
	assertUnit(input.unit);
	if (typeof input.used !== 'function' || typeof input.maximum !== 'function') {
		throw new TypeError('Capacity constraint used and maximum must be functions.');
	}
	return Object.freeze({
		id: input.id,
		description: input.description,
		unit: input.unit,
		used: input.used,
		maximum: input.maximum,
	});
}

/** Create an import-safe capacity definition from canonical fields and constraints. */
export function define<const DefinitionFields extends CapacityFields>(
	fields: DefinitionFields,
	input: Readonly<{
		readonly constraints?: readonly CapacityConstraint<CapacityValues<DefinitionFields>>[];
	}> = {},
): CapacityDefinition<DefinitionFields> {
	const entries = recordCore.entries(fields, 'capacity fields');
	if (entries.length === 0) throw new TypeError('Capacity definitions must contain at least one field.');
	for (const [key, value] of entries) {
		identifier(key, 'capacity field key');
		assertField(value);
	}
	const constraints = Object.freeze([...(input.constraints ?? [])]);
	assertUniqueConstraints(constraints);
	return Object.freeze({
		fields: recordCore.snapshot(fields, 'capacity fields'),
		keys: recordCore.keys(fields, 'capacity fields'),
		constraints,
	});
}

/**
 * Compose definitions without creating a second semantic owner for the same field.
 *
 * Reusing the exact same field or constraint object is intentional deduplication.
 * A same-name field or same-id constraint created independently is rejected.
 */
export function compose<const Definitions extends readonly CapacityFields[]>(
	...definitions: { [Key in keyof Definitions]: CapacityDefinition<Definitions[Key]> }
): CapacityDefinition<MergeFields<Definitions>> {
	if (definitions.length === 0) throw new TypeError('capacity.compose() requires at least one definition.');
	const fields: Record<string, CapacityField> = Object.create(null);
	type ComposedValues = CapacityValues<MergeFields<Definitions>>;
	const constraints: CapacityConstraint<ComposedValues>[] = [];
	const constraintById = new Map<string, CapacityConstraint<ComposedValues>>();
	for (const definition of definitions) {
		for (const key of definition.keys) {
			const candidate = definition.fields[key];
			const existing = fields[key];
			if (existing !== undefined && existing !== candidate) {
				throw new TypeError(`Capacity field ${JSON.stringify(key)} has conflicting definitions.`);
			}
			fields[key] = candidate!;
		}
		for (const candidate of definition.constraints) {
			const existing = constraintById.get(candidate.id);
			if (existing !== undefined && existing !== candidate) {
				throw new TypeError(`Capacity constraint ${JSON.stringify(candidate.id)} has conflicting definitions.`);
			}
			if (existing === undefined) {
				constraintById.set(candidate.id, candidate);
				constraints.push(candidate);
			}
		}
	}
	return define(fields as MergeFields<Definitions>, { constraints });
}

/** Validate values and report whether each capacity relationship is satisfied, hit, or exceeded. */
export async function check<const DefinitionFields extends CapacityFields>(
	definition: CapacityDefinition<DefinitionFields>,
	input: Readonly<Record<string, unknown>>,
): Promise<CheckResult<CapacityValues<DefinitionFields>>> {
	assertDefinition(definition);
	const unknown = Object.keys(input).filter((key) => !(key in definition.fields));
	if (unknown.length > 0) {
		throw new TypeError(`Unknown capacity field${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}.`);
	}
	const parsed: Array<readonly [string, unknown]> = [];
	for (const key of definition.keys) {
		parsed.push([key, await schema.parse(definition.fields[key]!.schema, input[key])]);
	}
	const value = Object.freeze(Object.fromEntries(parsed)) as CapacityValues<DefinitionFields>;
	const checks = Object.freeze(definition.constraints.map((entry) => evaluate(entry, value)));
	return Object.freeze({ value, status: overall(checks), constraints: checks });
}

/** Validate values and throw only when one or more declared constraints are exceeded. */
export async function assert<const DefinitionFields extends CapacityFields>(
	definition: CapacityDefinition<DefinitionFields>,
	input: Readonly<Record<string, unknown>>,
): Promise<CheckResult<CapacityValues<DefinitionFields>>> {
	const result = await check(definition, input);
	if (result.status === 'exceeded') throw new CapacityExceededError(result);
	return result;
}

/** Evaluate one declared constraint after schemas have produced canonical capacity values. */
function evaluate<Value extends Readonly<Record<string, unknown>>>(
	entry: CapacityConstraint<Value>,
	value: Value,
): ConstraintResult {
	const used = amount(entry.used(value), `${entry.id} used`);
	const maximum = amount(entry.maximum(value), `${entry.id} maximum`);
	const remaining = maximum - used;
	let status: CapacityStatusType = 'satisfied';
	if (used > maximum) status = 'exceeded';
	else if (used === maximum) status = 'hit';
	return Object.freeze({
		id: entry.id,
		description: entry.description,
		unit: entry.unit,
		status,
		used,
		maximum,
		remaining,
	});
}

function overall(checks: readonly ConstraintResult[]): CapacityStatusType {
	if (checks.some((entry) => entry.status === 'exceeded')) return 'exceeded';
	if (checks.some((entry) => entry.status === 'hit')) return 'hit';
	return 'satisfied';
}

function amount(value: number, name: string): number {
	if (!Number.isFinite(value) || value < 0) throw new TypeError(`${name} must be a finite non-negative number.`);
	return value;
}

function identifier(value: string, name: string): void {
	if (value.length === 0 || value.trim() !== value) throw new TypeError(`${name} must be a non-empty trimmed string.`);
}

function text(value: string, name: string): void {
	if (value.trim().length === 0) throw new TypeError(`${name} must not be empty.`);
}

function assertUnit(value: CapacityUnit): void {
	if (typeof value !== 'object' || value === null) throw new TypeError('capacity unit must be an object.');
	identifier(value.id, 'unit id');
	text(value.description, 'unit description');
}

function assertField(value: CapacityField): void {
	if (typeof value !== 'object' || value === null) throw new TypeError('capacity field must be an object.');
	schema.assert(value.schema, 'capacity field schema');
	assertUnit(value.unit);
	text(value.description, 'capacity field description');
}

function assertUniqueConstraints<Value extends Readonly<Record<string, unknown>>>(
	constraints: readonly CapacityConstraint<Value>[],
): void {
	const seen = new Set<string>();
	for (const entry of constraints) {
		identifier(entry.id, 'constraint id');
		if (seen.has(entry.id)) throw new TypeError(`Capacity constraint ${JSON.stringify(entry.id)} is duplicated.`);
		seen.add(entry.id);
	}
}


function assertDefinition(value: unknown): void {
	if (typeof value !== 'object' || value === null) throw new TypeError('capacity definition is invalid.');
	const candidate = value as Readonly<{ readonly keys?: unknown; readonly constraints?: unknown }>;
	if (!Array.isArray(candidate.keys) || !Array.isArray(candidate.constraints)) {
		throw new TypeError('capacity definition is invalid.');
	}
}

export type {
	CapacityUnit,
	CapacityField,
	CapacityFields,
	CapacityValues,
	CapacityConstraint,
	CapacityDefinition,
	CapacityStatusType,
	ConstraintResult,
	CheckResult,
	AdmissionLimits,
	AdmissionRequest,
	Admission,
	AdmissionCancellation,
	AdmissionSnapshot,
	AdmissionLease,
} from './types.ts';

/** Serializable nested placement and trusted compute registration contracts. @module */
import * as schema from '@okikio/schema';
import * as record from '@okikio/collection/record';
import type { ComputeType, WorkflowInstruction, WorkflowOperation } from './types.ts';

/** An incarnation reference never aliases a replacement with the same name. */
export const ReferenceSchema: schema.Reader<Readonly<{ id: string; generation: number }>, unknown> = schema.define(
	(input) => {
		record.assert(input, 'compute reference');
		const value = input as Record<string, unknown>;
		if (Object.keys(value).some((key) => !['id', 'generation'].includes(key))) {
			schema.reject('Unknown compute reference field.');
		}
		if (typeof value.id !== 'string' || !value.id.trim() || value.id.length > 256) {
			schema.reject('Expected compute id.');
		}
		if (!Number.isSafeInteger(value.generation) || (value.generation as number) < 1) {
			schema.reject('Expected positive compute generation.');
		}
		return Object.freeze({ id: value.id, generation: value.generation as number });
	},
);
/** One native host within one provider lifetime. Neither identifier is reused after replacement. */
export const HostSchema: schema.ObjectReader<
	{ readonly pool: schema.JsonReader<string, string>; readonly id: schema.JsonReader<string, string> },
	'reject'
> = schema.object({
	/** Random provider incarnation; restarting even the same executor invalidates this reference. */
	pool: schema.string({ minLength: 1, maxLength: 192 }),
	/** Unique host lifetime, independent from OS PID or recyclable pool position. */
	id: schema.string({ minLength: 1, maxLength: 192 }),
});
/** Portable physical-host reference; deployment authorization remains separate. */
export type HostType = schema.Output<typeof HostSchema>;

/** Dense data-only references prevent accessor-backed arrays from running caller code. */
const ReferencesSchema = schema.array(ReferenceSchema, { maxLength: 64 });

/** Exact identity of a registered compute incarnation. */
export type ReferenceType = schema.Output<typeof ReferenceSchema>;

/** Intersected required ancestors and optional exact leaf. Preferences never weaken these requirements. */
export const SelectionSchema: schema.Reader<
	Readonly<
		{
			host?: Readonly<{ id: string; pool: string }> | undefined;
			on?: Readonly<{ id: string; generation: number }> | undefined;
			within: readonly Readonly<{ id: string; generation: number }>[];
		}
	>,
	unknown
> = schema.define((input) => {
	record.assert(input, 'placement selection');
	const value = input as Record<string, unknown>;
	if (Object.keys(value).some((key) => !['within', 'on', 'host'].includes(key))) {
		schema.reject('Unknown placement field.');
	}
	const refs = ReferencesSchema.parse(value.within);
	const seen = new Map<string, number>();
	for (const ref of refs) {
		if (seen.has(ref.id) && seen.get(ref.id) !== ref.generation) schema.reject('Conflicting compute generations.');
		seen.set(ref.id, ref.generation);
	}
	const on = value.on === undefined ? undefined : ReferenceSchema.parse(value.on);
	const host = value.host === undefined ? undefined : Object.freeze(HostSchema.parse(value.host));
	if (host && !on) schema.reject('A physical host requires an exact executor.');
	if (on !== undefined && seen.has(on.id) && seen.get(on.id) !== on.generation) {
		schema.reject('Conflicting exact compute generation.');
	}
	return Object.freeze({
		within: Object.freeze(
			[...seen].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([id, generation]) =>
				Object.freeze({ id, generation })
			),
		),
		...(on === undefined ? {} : { on }),
		...(host === undefined ? {} : { host }),
	});
});
/** Saved constraints, not an authorization grant or live reservation. */
export type SelectionType = schema.Output<typeof SelectionSchema>;

/** One trusted registration boundary with an optional shared whole-attempt budget. */
export type BoundaryType = Readonly<{
	/** Stable compute identity. */
	id: string;
	/** Monotonically increasing incarnation fence. */
	generation: number;
	/** Parent ID; the complete ordered path pins its incarnation too. */
	parent?: string;
	/** Whole-attempt limit shared by descendant executors. */
	capacity?: number;
}>;

/** Require execution at or below a registered incarnation. */
export function within(reference: ReferenceType): SelectionType {
	return SelectionSchema.parse({ within: [reference] });
}
/** Require the exact leaf compute incarnation; this does not select a resource instance. */
export function on(reference: ReferenceType): SelectionType {
	return SelectionSchema.parse({ within: [], on: reference });
}
/** Require one physical host inside an exact executor. A busy or lost host never falls back to a sibling. */
export function host(executor: ReferenceType, reference: HostType): SelectionType {
	return SelectionSchema.parse({ within: [], on: executor, host: reference });
}
/** Combine scopes without allowing a child to replace its parent's requirements. */
export function intersect(parent?: SelectionType, child?: SelectionType): SelectionType {
	const a = parent === undefined ? undefined : SelectionSchema.parse(parent);
	const b = child === undefined ? undefined : SelectionSchema.parse(child);
	if (a?.on && b?.on && (a.on.id !== b.on.id || a.on.generation !== b.on.generation)) {
		throw new TypeError('Nested placement requires conflicting exact executors.');
	}
	if (a?.host && b?.host && (a.host.pool !== b.host.pool || a.host.id !== b.host.id)) {
		throw new TypeError('Nested placement requires conflicting physical hosts.');
	}
	return SelectionSchema.parse({
		within: [...(a?.within ?? []), ...(b?.within ?? [])],
		on: b?.on ?? a?.on,
		host: b?.host ?? a?.host,
	});
}

/**
 * Validate a complete root-to-leaf path. Legacy parent-only metadata remains
 * diagnostic: it cannot prove membership in an unregistered ancestor.
 */
export function path(compute?: ComputeType): readonly BoundaryType[] {
	if (compute === undefined) return Object.freeze([]);
	record.assert(compute, 'compute');
	const ancestors = schema.array(schema.unknown(), { maxLength: 63 }).parse(compute.ancestors ?? []);
	const values = [...ancestors, compute] as ComputeType[];
	const output: BoundaryType[] = [];
	const seen = new Set<string>();
	for (const [index, value] of values.entries()) {
		record.assert(value, 'compute boundary');
		const ref = ReferenceSchema.parse({ id: value.id, generation: value.generation ?? 1 });
		if (
			value.parent !== undefined &&
			(typeof value.parent !== 'string' || !value.parent.trim() || value.parent.length > 256)
		) {
			throw new TypeError('Expected compute parent id.');
		}
		if (value.parent === value.id) throw new TypeError('Compute cannot parent itself.');
		if (seen.has(ref.id)) throw new TypeError('Compute ancestry contains a cycle or repeated identity.');
		seen.add(ref.id);
		if (ancestors.length && value.parent !== (index === 0 ? undefined : values[index - 1]!.id)) {
			throw new TypeError('Compute ancestry must be a complete ordered root-to-leaf path.');
		}
		if (value.capacity !== undefined && (!Number.isSafeInteger(value.capacity) || value.capacity < 1)) {
			throw new TypeError('Compute capacity must be a positive safe integer.');
		}
		output.push(
			Object.freeze({
				...ref,
				...(value.parent === undefined ? {} : { parent: value.parent }),
				...(value.capacity === undefined ? {} : { capacity: value.capacity }),
			}),
		);
	}
	return Object.freeze(output);
}

/** Eligibility only. An authority must also validate current generations and reserve budgets atomically. */
export function matches(selection: SelectionType | undefined, lineage: readonly BoundaryType[]): boolean {
	if (selection === undefined) return true;
	const same = (ref: ReferenceType, node: ReferenceType) => ref.id === node.id && ref.generation === node.generation;
	return selection.within.every((ref) => lineage.some((node) => same(ref, node))) &&
		(selection.on === undefined || (lineage.length > 0 && same(selection.on, lineage.at(-1)!)));
}

/**
 * Apply required placement to a generator and its controls, including cleanup
 * and child workflow requests. Native generator delegation preserves thrown
 * completions and finally blocks. Saved child runs must inherit the selection.
 */
export function scope<Value, Failure>(
	selection: SelectionType,
	program: WorkflowOperation<Value, Failure>,
): WorkflowOperation<Value, Failure> {
	const required = SelectionSchema.parse(selection);
	return Object.freeze({
		*[Symbol.iterator]() {
			const iterator = program[Symbol.iterator]();
			const map = (result: IteratorResult<WorkflowInstruction, Value>): IteratorResult<WorkflowInstruction, Value> =>
				result.done ? result : { done: false, value: constrain(required, result.value) };
			return yield* {
				[Symbol.iterator]() {
					return {
						next: (...args: Parameters<typeof iterator.next>) => map(iterator.next(...args)),
						throw: (error: unknown) => map(iterator.throw(error)),
						return: (value: Value) => map(iterator.return(value)),
					};
				},
			};
		},
	});
}

/** Controls carry live generators; transform them lazily instead of serializing closures. */
function constrain(selection: SelectionType, instruction: WorkflowInstruction): WorkflowInstruction {
	if (instruction.type === 'activity' || instruction.type === 'child-workflow') {
		return Object.freeze({
			...instruction,
			options: Object.freeze({ ...instruction.options, location: intersect(selection, instruction.options.location) }),
		});
	}
	if (instruction.type === 'defer') {
		return Object.freeze({
			...instruction,
			cleanup: constrain(selection, instruction.cleanup) as typeof instruction.cleanup,
		});
	}
	if (instruction.type === 'parallel' || instruction.type === 'race') {
		return Object.freeze({
			...instruction,
			operations: Object.freeze(
				Object.fromEntries(
					Object.entries(instruction.operations).map(([key, operation]) => [key, scope(selection, operation)]),
				),
			),
		});
	}
	if (instruction.type === 'map') {
		return Object.freeze({
			...instruction,
			entries: Object.freeze(
				instruction.entries.map((entry) => Object.freeze({ ...entry, operation: scope(selection, entry.operation) })),
			),
		});
	}
	if (instruction.type === 'retry') {
		return Object.freeze({ ...instruction, operation: scope(selection, instruction.operation) });
	}
	return instruction;
}

/** Namespace-local authority. Only trusted deployment registration may add paths. @internal */
export class Registry {
	/** Current boundary incarnations outlive host departures to prevent generation rollback. */
	readonly #nodes = new Map<string, BoundaryType>();

	register(lineage: readonly BoundaryType[]): void {
		for (const node of lineage) {
			const previous = this.#nodes.get(node.id);
			if (
				previous && (node.generation < previous.generation ||
					(node.generation === previous.generation && JSON.stringify(node) !== JSON.stringify(previous)))
			) {
				throw new TypeError(`Stale or conflicting compute registration: ${node.id}.`);
			}
		}
		for (const node of lineage) this.#nodes.set(node.id, node);
	}

	/** Every ancestor must still denote the exact current registered incarnation. */
	current(lineage: readonly BoundaryType[]): boolean {
		return lineage.every((node) => this.#nodes.get(node.id)?.generation === node.generation);
	}
}

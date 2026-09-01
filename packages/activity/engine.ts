/**
 * Import-safe activity-engine definitions and deterministic placement choices.
 *
 * An engine definition names an execution target. It is not a live process,
 * Worker, extension context, or remote connection. Live providers register an
 * exact definition with a workflow Scheduler.
 *
 * @module
 */
import type { CatalogEntryIdentity } from '@okikio/catalog';

/** Immutable execution-target contract used by activity placement. */
export interface EngineDefinition<Id extends string = string> extends CatalogEntryIdentity {
	/** Stable discriminant that prevents placement values from being confused with other catalog entries. */
	readonly kind: 'activity-engine';
	/** Stable execution-target identity recorded in activity placement and Scheduler history. */
	readonly id: Id;
	/** Human-readable explanation of the execution environment this engine represents. */
	readonly description?: string;
}

/** Options accepted by `engines.define()`. */
export interface EngineOptions<Id extends string = string> {
	/** Stable execution-target identity. It must remain unchanged across live provider generations. */
	readonly id: Id;
	/** Optional human-readable purpose used by documentation and diagnostics. */
	readonly description?: string;
}

/** Selection meaning attached to one engine candidate. */
export type EngineChoiceModeType = 'required' | 'preferred' | 'allowed';

/** One immutable engine candidate before placement normalization. */
export interface EngineChoiceType<Engine extends EngineDefinition = EngineDefinition> {
	/** Stable discriminant for one engine-placement contribution. */
	readonly kind: 'activity-engine-choice';
	/** Selection strength used when the Scheduler chooses among live registrations. */
	readonly mode: EngineChoiceModeType;
	/** Exact import-safe engine definition selected by this contribution. */
	readonly engine: Engine;
}

/** Ordered activity placement contract. */
export interface EnginePlacementType<Engine extends EngineDefinition = EngineDefinition> {
	/** Stable discriminant for one normalized engine-placement declaration. */
	readonly kind: 'activity-engine-placement';
	/** Ordered candidates retained in authored priority after duplicate normalization. */
	readonly choices: readonly EngineChoiceType<Engine>[];
}

/** Recursive input accepted where activity placement is declared. */
export type EnginePlacementInputType =
	| EngineChoiceType
	| EnginePlacementType
	| readonly EnginePlacementInputType[];

/** JSON-safe placement documentation. */
export interface EnginePlacementDocumentType {
	/** Stable engine ID safe to persist or expose in generated documentation. */
	readonly engine: string;
	/** Selection strength associated with the documented engine. */
	readonly mode: EngineChoiceModeType;
}

/** Define one immutable engine contract without starting a live host. */
export function define<const Id extends string>(input: EngineOptions<Id>): EngineDefinition<Id> {
	assertId(input.id);
	return Object.freeze({
		kind: 'activity-engine',
		id: input.id,
		...(input.description === undefined ? {} : { description: input.description }),
	});
}

/** Select one exact engine with no fallback. */
export function require<Engine extends EngineDefinition>(engine: Engine): EngineChoiceType<Engine> {
	return choice(engine, 'required');
}

/** Add one fallback engine after preferred candidates. */
export function allow<Engine extends EngineDefinition>(engine: Engine): EngineChoiceType<Engine> {
	return choice(engine, 'allowed');
}

/** Give one engine priority over allowed fallback candidates. */
export function prefer<Engine extends EngineDefinition>(engine: Engine): EngineChoiceType<Engine> {
	return choice(engine, 'preferred');
}

/** Normalize one ordered engine selection and reject ambiguous declarations. */
export function oneOf(
	...input: readonly EnginePlacementInputType[]
): EnginePlacementType {
	return compose(...input);
}

/**
 * Flatten engine placement contributions while preserving authored priority.
 *
 * A required engine is exclusive. Preferred and allowed candidates can be
 * combined. Duplicate exact definitions collapse to their strongest authored
 * mode without changing the first occurrence order.
 */
export function compose(
	...input: readonly EnginePlacementInputType[]
): EnginePlacementType {
	const flattened: EngineChoiceType[] = [];
	for (const value of input) collect(value, flattened);
	if (flattened.length === 0) throw new TypeError('Activity placement requires at least one engine.');

	const required = flattened.filter((entry) => entry.mode === 'required');
	if (required.length > 0 && flattened.length !== 1) {
		throw new TypeError('A required engine cannot be combined with fallback engine choices.');
	}

	const index = new Map<EngineDefinition, number>();
	const choices: EngineChoiceType[] = [];
	for (const entry of flattened) {
		const at = index.get(entry.engine);
		if (at === undefined) {
			index.set(entry.engine, choices.length);
			choices.push(entry);
			continue;
		}
		const previous = choices[at]!;
		if (rank(entry.mode) > rank(previous.mode)) choices[at] = entry;
	}
	return Object.freeze({ kind: 'activity-engine-placement', choices: Object.freeze(choices) });
}

/** Create deterministic documentation for one normalized placement. */
export function document(input: EnginePlacementInputType): readonly EnginePlacementDocumentType[] {
	return Object.freeze(compose(input).choices.map((entry) => Object.freeze({ engine: entry.engine.id, mode: entry.mode })));
}

/** Create one validated immutable candidate. */
function choice<Engine extends EngineDefinition>(engine: Engine, mode: EngineChoiceModeType): EngineChoiceType<Engine> {
	assertDefinition(engine);
	return Object.freeze({ kind: 'activity-engine-choice', mode, engine });
}

/** Recursively flatten placement input without losing the caller's order. */
function collect(input: EnginePlacementInputType, output: EngineChoiceType[]): void {
	if (Array.isArray(input)) {
		for (const entry of input) collect(entry, output);
		return;
	}

	const value = input as EngineChoiceType | EnginePlacementType;
	if (value.kind === 'activity-engine-placement') {
		for (const entry of value.choices) collect(entry, output);
		return;
	}
	if (value.kind !== 'activity-engine-choice') throw new TypeError('Unknown activity engine placement value.');
	assertDefinition(value.engine);
	output.push(value);
}

/** Rank duplicate candidate modes without changing the candidate's original position. */
function rank(mode: EngineChoiceModeType): number {
	if (mode === 'required') return 3;
	if (mode === 'preferred') return 2;
	return 1;
}

/** Reject a forged or malformed engine definition before it enters placement state. */
function assertDefinition(value: EngineDefinition): void {
	if (typeof value !== 'object' || value === null || value.kind !== 'activity-engine' || typeof value.id !== 'string') {
		throw new TypeError('Activity engine placement requires an engine definition.');
	}
	assertId(value.id);
}

/** Reject an invalid stable engine identifier before definition creation. */
function assertId(id: string): void {
	if (!/^[a-z0-9][a-z0-9._:-]*$/i.test(id)) throw new TypeError(`Invalid activity engine id ${JSON.stringify(id)}.`);
}

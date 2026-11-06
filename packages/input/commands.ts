/** Typed command identity shared by key bindings, menus and command palettes. @module */
import * as catalogs from '@okikio/collection/catalog';
import type { Catalog } from '@okikio/collection/catalog';

/** A command's behavior; rendering and focus policy remain with the application. */
export interface Command<Input = void, Output = unknown, Id extends string = string> {
	/** Stable catalog domain discriminator. */
	readonly kind: 'input-command';
	/** Identity reused by the menu, shortcut and command palette. */
	readonly id: Id;
	/** Human-readable action label. */
	readonly label: string;
	/** Optional explanation for generated help or a command palette. */
	readonly description?: string;
	/** Dynamic eligibility for this application value; run() checks it before invocation. */
	readonly enabled?: (input: Input) => boolean;
	/** Invoke application behavior after the caller has selected this command. */
	readonly invoke: (input: Input) => Output;
}

/** Author one typed command without listeners, global registration, or a required input source. */
export function define<Input = void, Output = unknown, const Id extends string = string>(
	options: Omit<Command<Input, Output, Id>, 'kind'>,
): Command<Input, Output, Id> {
	if (typeof options.id !== 'string' || options.id.trim().length === 0) {
		throw new TypeError('A command needs a non-empty id.');
	}
	if (typeof options.label !== 'string' || options.label.trim().length === 0) {
		throw new TypeError('A command needs a non-empty label.');
	}
	if (typeof options.invoke !== 'function') throw new TypeError('A command needs an invoke function.');
	return { ...options, kind: 'input-command' };
}

/** Read eligibility for menus and bindings without invoking application work. */
export function enabled<Input>(command: Command<Input>, input: Input): boolean {
	return command.enabled?.(input) !== false;
}

/** A command was invoked while its authored eligibility predicate rejected the supplied input. */
export class CommandDisabledError extends Error {
	/** Stable command identity, suitable for matching without parsing the message. */
	readonly commandId: string;
	/** Describe the rejected action; no application work has run. */
	constructor(id: string) {
		super(`Command ${id} is disabled.`);
		this.name = 'CommandDisabledError';
		this.commandId = id;
	}
}

/**
 * Run an eligible command with an ordinary typed value and preserve its return type.
 * The source event belongs to the binding; commands can instead receive a draft,
 * selection or number from keys, menus, a gamepad, or another application source.
 * A returned Promise is unchanged: its caller owns awaiting and cancellation.
 * @throws {CommandDisabledError} The eligibility predicate rejected this input.
 */
export function run<Input, Output>(command: Command<Input, Output>, input: Input): Output {
	if (!enabled(command, input)) throw new CommandDisabledError(command.id);
	return command.invoke(input);
}

/** Group exact command objects through the existing Catalog contract, preserving named entries and IDs. */
export function catalog<const Entries extends Readonly<Record<string, Command<never, unknown>>>>(
	name: string,
	entries: Entries,
): Catalog<Entries[keyof Entries], Entries> {
	return catalogs.create(name, entries);
}

/** Select and describe commands through the same catalog implementation used by other definition families. */
export { get, has, ids, select, values } from '@okikio/collection/catalog';

/** Callback-free command metadata suitable for a menu/help projection; not an execution capability. */
export interface InspectionType {
	readonly id: string;
	readonly label: string;
	readonly description?: string;
	/** Unknown means a dynamic predicate exists and no explicit caller evaluation was supplied. */
	readonly availability: 'enabled' | 'disabled' | 'unknown';
}
/**
 * Capture bounded command metadata without invoking enabled or invoke. Use values(catalog) for a
 * selected catalog. Heterogeneous command inputs remain with their typed owners; optional availability
 * receives only ID and can consult that owner's current snapshot. Predicate defects propagate.
 */
export function inspect(
	source: readonly Command<never>[],
	options: Readonly<
		{
			readonly maximumItems: number;
			readonly maximumTextCodeUnits: number;
			readonly availability?: (id: string) => boolean | 'unknown';
		}
	>,
): readonly InspectionType[] {
	const { maximumItems, maximumTextCodeUnits, availability } = options;
	if (!Number.isSafeInteger(maximumItems) || maximumItems < 0 || source.length > maximumItems) {
		throw new RangeError('Commands exceed maximumItems.');
	}
	if (!Number.isSafeInteger(maximumTextCodeUnits) || maximumTextCodeUnits < 0) {
		throw new RangeError('Invalid command text limit.');
	}
	if (availability !== undefined && typeof availability !== 'function') {
		throw new TypeError('Command availability must be a function.');
	}
	const metadata = source.map((command) => ({
		id: command.id,
		label: command.label,
		...(command.description === undefined ? {} : { description: command.description }),
		dynamic: command.enabled !== undefined,
	}));
	return Object.freeze(metadata.map(({ dynamic, ...command }) => {
		if (command.id.length + command.label.length + (command.description?.length ?? 0) > maximumTextCodeUnits) {
			throw new RangeError('Command metadata exceeds text limit.');
		}
		const selected = availability === undefined ? (dynamic ? 'unknown' : true) : availability(command.id);
		if (selected !== 'unknown' && typeof selected !== 'boolean') {
			throw new TypeError('Command availability must return boolean or unknown.');
		}
		return Object.freeze({
			...command,
			availability: selected === 'unknown' ? 'unknown' as const : selected ? 'enabled' as const : 'disabled' as const,
		});
	}));
}

/**
 * Search metadata by locale-independent lower-case token inclusion, preserving authored order.
 * This is bounded literal discovery, not fuzzy ranking. Disabled visibility is explicit; unknown
 * eligibility stays visible. No live callbacks or listeners are involved.
 */
export function search(
	source: readonly InspectionType[],
	query: string,
	options: Readonly<
		{
			readonly maximumItems: number;
			readonly maximumResults: number;
			readonly maximumQueryCodeUnits: number;
			readonly maximumTextCodeUnits: number;
			readonly includeDisabled: boolean;
		}
	>,
): readonly InspectionType[] {
	for (
		const value of [
			options.maximumItems,
			options.maximumResults,
			options.maximumQueryCodeUnits,
			options.maximumTextCodeUnits,
		]
	) {
		if (!Number.isSafeInteger(value) || value < 0) {
			throw new RangeError('Command search requires nonnegative safe limits.');
		}
	}
	if (source.length > options.maximumItems || query.length > options.maximumQueryCodeUnits) {
		throw new RangeError('Command search exceeds input limits.');
	}
	if (typeof options.includeDisabled !== 'boolean') {
		throw new TypeError('Command search requires disabled visibility policy.');
	}
	const tokens = query.toLowerCase().trim().split(/\s+/u).filter(Boolean);
	const output: InspectionType[] = [];
	for (const command of source) {
		if (output.length === options.maximumResults) break;
		if (!options.includeDisabled && command.availability === 'disabled') continue;
		if (command.id.length + command.label.length + (command.description?.length ?? 0) > options.maximumTextCodeUnits) {
			throw new RangeError('Search metadata exceeds text limit.');
		}
		const text = `${command.id}\n${command.label}\n${command.description ?? ''}`.toLowerCase();
		if (tokens.every((token) => text.includes(token))) output.push(command);
	}
	return Object.freeze(output);
}

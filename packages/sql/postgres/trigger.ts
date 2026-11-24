/**
 * Trigger functions and triggers, built from typed steps instead of PL/pgSQL text.
 *
 * A trigger runs inside the statement that changed a row, so it holds an invariant for every writer: this library, an
 * older worker and an operator's own SQL. Its function body is a short list of steps from a fixed set: `perform`,
 * `assign`, `branch`, `run`, `ensure` and `result`. Each step takes typed expressions over the changed row, which
 * {@link changed} gives as `new` or `old` with the table's column types.
 *
 * Scope is checked like a statement's. A step, and a statement in {@link run}, may read only `new`, `old` and
 * {@link operation} from outside. A trigger's condition may read only `new` and `old`, because PostgreSQL evaluates it
 * before the function runs.
 *
 * Function bodies are written with literals, because PostgreSQL takes no parameters in DDL. A string literal there may
 * not hold `$`, so it cannot end the dollar quote around the body.
 *
 * @example Notify listeners when a row is inserted
 * ```ts ignore
 * const notify = sql.declare('pg_notify', [types.text(), types.text()], types.empty);
 * const wake = trigger.routine('app', 'wake', [
 * 	trigger.perform(notify('app', trigger.changed(jobs, 'new').c.namespace)),
 * 	trigger.result('null'),
 * ]);
 * const statements = [wake.ddl, ...trigger.create({ name: 'jobs_insert', table: jobs, timing: 'after', events: ['insert'], routine: wake })];
 * ```
 *
 * @module
 */
import { type Dialect, same } from '../dialect.ts';
import { type Column, Expr, lift, reads, type ValueOf } from '../expr.ts';
import { type Fragment, group, identifier, join, keyword, qualified } from '../fragment.ts';
import { type Ddl, ddl } from '../statement.ts';
import { type Columns, record, type Refs, type Table } from '../table.ts';
import { dialect } from './dialect.ts';
import * as types from './types/mod.ts';

const brand: unique symbol = Symbol('okikio.sql.step');

/** The rows a trigger's condition can read. */
export type RowType = 'new' | 'old';

/** What a step of a trigger function can read: the changed rows and the operation. */
export type BodyType = RowType | 'tg_op';

/** One PL/pgSQL statement of a trigger function. */
export interface StepType {
	readonly [brand]: true;
	readonly fragment: Fragment;
	/** Whether the step ends the function. */
	readonly last: boolean;
}

/** A statement a trigger can run: it may read `new`, `old` and {@link operation} from outside. */
export interface RunnableType {
	readonly dialect: Dialect;
	/** The SQL, without the scope check. */
	readonly fragment: Fragment;
	readonly free: ReadonlySet<string>;
	readonly [reads]?: BodyType;
}

function step(fragment: Fragment, last = false): StepType {
	return Object.freeze({ [brand]: true as const, fragment, last });
}

function block(steps: readonly StepType[]): Fragment {
	return join(steps.map((item) => item.fragment), ' ');
}

/** Fail when a part reads anything but the allowed owners. */
function inside(owners: ReadonlySet<string>, allowed: readonly string[], what: string): void {
	for (const owner of owners) {
		if (!allowed.includes(owner)) {
			throw new TypeError(`A ${what} reads ${owner}; it may read only ${allowed.join(', ')}.`);
		}
	}
}

/** The checked SQL of an expression in a function body. */
function body(expression: Expr<unknown, string>, what: string): Fragment {
	same(dialect, expression.dialect);
	inside(expression.owners, ['new', 'old', 'tg_op'], what);
	return expression.fragment;
}

/** The operation that fired the trigger. A trigger's condition cannot read it. */
export const operation: Expr<'INSERT' | 'UPDATE' | 'DELETE', 'tg_op'> = new Expr(
	keyword('tg_op'),
	types.text(['INSERT', 'UPDATE', 'DELETE'] as const),
	true,
	Object.freeze(new Set(['tg_op'])),
);

/** The row after the change (`new`) or before it (`old`), with the table's column types. `old` is NULL on insert. */
export function changed<C extends Columns, const W extends RowType>(
	table: Table<C>,
	which: W,
): { readonly c: Refs<C, W> } {
	same(dialect, table.dialect);
	return record(table, which);
}

/** Evaluate an expression for its effect, such as a function call: `perform …;`. */
export function perform(expression: Expr<unknown, BodyType>): StepType {
	return step(join([keyword('perform '), body(expression, 'perform step'), keyword(';')]));
}

/** Change a column of the new row before it is written: `new.column = value;`. Only `before` triggers can do this. */
export function assign<C extends Column<unknown, 'new'>>(
	target: C,
	value: ValueOf<C> | Expr<ValueOf<C>, BodyType>,
): StepType {
	const [part] = target.fragment;
	if (target.fragment.length !== 1 || part?.kind !== 'column' || part.owner.join('.') !== 'new') {
		throw new TypeError('A trigger can assign only a column of the new row.');
	}
	return step(
		join([target.fragment, keyword(' = '), body(lift(value as unknown, target.type), 'assign step'), keyword(';')]),
	);
}

/** Run `then` when the condition holds, and `otherwise` when it does not: `if … then … else … end if;`. */
export function branch(
	condition: Expr<boolean, BodyType>,
	then: readonly StepType[],
	otherwise: readonly StepType[] = [],
): StepType {
	const parts: Fragment[] = [keyword('if '), body(condition, 'branch condition'), keyword(' then '), block(then)];
	if (otherwise.length) parts.push(keyword(' else '), block(otherwise));
	parts.push(keyword(' end if;'));
	return step(join(parts));
}

/** Run a statement, such as an insert into a history table. Its rows are discarded. */
export function run(statement: RunnableType): StepType {
	same(dialect, statement.dialect);
	inside(statement.free, ['new', 'old', 'tg_op'], 'statement in a trigger');
	return step(join([statement.fragment, keyword(';')]));
}

/**
 * Fail the change when the previous statement found or changed no row. This keeps a trigger from writing incomplete
 * history when a row it depends on is missing.
 */
export function ensure(message: string): StepType {
	return step(join([
		keyword('if not found then raise exception using message = '),
		lift(message, types.text()).fragment,
		keyword('; end if;'),
	]));
}

/**
 * End the function. A `before` trigger returns `new` to write the row, as changed by `assign`. An `after` trigger's
 * result is ignored, so it returns `null`.
 */
export function result(value: 'new' | 'null'): StepType {
	return step(keyword(`return ${value};`), true);
}

/** A trigger function and the statement that creates or replaces it. */
export interface RoutineType {
	readonly schema: string;
	readonly name: string;
	/** `create or replace function`, safe to run again. */
	readonly ddl: Ddl;
}

/** Define a trigger function from steps. The last step must be a {@link result}. */
export function routine(schema: string, name: string, steps: readonly StepType[]): RoutineType {
	if (!steps.at(-1)?.last) throw new TypeError(`Trigger function ${schema}.${name} must end with result().`);
	return Object.freeze({
		schema,
		name,
		ddl: ddl(
			dialect,
			join([
				keyword('create or replace function '),
				qualified(schema, name),
				keyword('() returns trigger language plpgsql as $body$ begin '),
				block(steps),
				keyword(' end; $body$'),
			]),
			true,
		),
	});
}

/** A row change that fires a trigger. An update may list the columns whose change fires it. */
export type EventType = 'insert' | 'delete' | { readonly update: readonly Column<unknown>[] };

/** A row-level trigger. */
export interface TriggerType {
	readonly name: string;
	readonly table: Table<Columns>;
	/** `before` can change the new row; `after` sees the written row. */
	readonly timing: 'before' | 'after';
	readonly events: readonly EventType[];
	/**
	 * Fire only when this holds. It may read only `new` and `old`, not {@link operation}, so an insert and an update
	 * with different conditions need two triggers.
	 */
	readonly condition?: Expr<boolean, RowType>;
	readonly routine: RoutineType;
}

function event(table: Table<Columns>, item: EventType): Fragment {
	if (typeof item === 'string') return keyword(item);
	if (!item.update.length) return keyword('update');
	for (const column of item.update) inside(column.owners, [table.key], `update event of ${table.key}`);
	return join([keyword('update of '), join(item.update.map((column) => identifier(column.name)), ', ')]);
}

/**
 * Drop and create a row-level trigger, so a later revision can change its events or condition. Run both statements in
 * the migration transaction; the table never runs without the trigger after the transaction commits.
 */
export function create(trigger: TriggerType): readonly Ddl[] {
	same(dialect, trigger.table.dialect);
	if (!trigger.events.length) throw new TypeError(`Trigger ${trigger.name} needs at least one event.`);
	if (trigger.condition) inside(trigger.condition.owners, ['new', 'old'], `condition of trigger ${trigger.name}`);
	const table = qualified(trigger.table.schema, trigger.table.name);
	const parts: Fragment[] = [
		keyword('create trigger '),
		identifier(trigger.name),
		keyword(` ${trigger.timing} `),
		join(trigger.events.map((item) => event(trigger.table, item)), ' or '),
		keyword(' on '),
		table,
		keyword(' for each row'),
	];
	if (trigger.condition) parts.push(keyword(' when '), group(trigger.condition.fragment));
	parts.push(keyword(' execute function '), qualified(trigger.routine.schema, trigger.routine.name), keyword('()'));
	return [
		ddl(dialect, join([keyword('drop trigger if exists '), identifier(trigger.name), keyword(' on '), table])),
		ddl(dialect, join(parts), true),
	];
}

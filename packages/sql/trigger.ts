/**
 * Trigger functions and triggers, built from typed steps instead of PL/pgSQL text.
 *
 * A trigger runs inside the statement that changed a row, so it holds an invariant for every writer: this library, an
 * older worker and an operator's own SQL. Its function body is a short list of steps from a fixed set: `perform`,
 * `assign`, `branch`, `run`, `ensure` and `result`. Each step takes typed expressions over the changed row, which
 * {@link changed} gives as `new` or `old` with the table's column types.
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
import { type AnyExpr, type Column, Expr, type Input, lift } from './expr.ts';
import { type Fragment, group, identifier, join, keyword, qualified } from './fragment.ts';
import { type Ddl, ddl } from './ddl.ts';
import { type Statement } from './statement.ts';
import { type Columns, record, type Refs, type Table } from './table.ts';
import * as types from './type.ts';

const brand: unique symbol = Symbol('okikio.sql.step');

/** One PL/pgSQL statement of a trigger function. */
export interface StepType {
	readonly [brand]: true;
	readonly fragment: Fragment;
}

function step(fragment: Fragment): StepType {
	return Object.freeze({ [brand]: true as const, fragment });
}

function block(steps: readonly StepType[]): Fragment {
	return join(steps.map((item) => item.fragment), ' ');
}

/** The operation that fired the trigger. */
export const operation: Expr<'INSERT' | 'UPDATE' | 'DELETE'> = new Expr(
	keyword('tg_op'),
	types.text(['INSERT', 'UPDATE', 'DELETE'] as const),
	true,
);

/** The row after the change (`new`) or before it (`old`), with the table's column types. `old` is NULL on insert. */
export function changed<C extends Columns>(table: Table<C>, which: 'new' | 'old'): { readonly c: Refs<C> } {
	return record(table, which);
}

/** Evaluate an expression for its effect, such as a function call: `perform …;`. */
export function perform(expression: AnyExpr): StepType {
	return step(join([keyword('perform '), expression.fragment, keyword(';')]));
}

/** Change a column of the new row before it is written: `new.column = value;`. Only `before` triggers can do this. */
export function assign<T>(target: Column<T>, value: Input<T>): StepType {
	const [part] = target.fragment;
	if (target.fragment.length !== 1 || part?.kind !== 'column' || part.owner.join('.') !== 'new') {
		throw new TypeError('A trigger can assign only a column of the new row.');
	}
	return step(join([target.fragment, keyword(' = '), lift(value, target.type).fragment, keyword(';')]));
}

/** Run `then` when the condition holds, and `otherwise` when it does not: `if … then … else … end if;`. */
export function branch(
	condition: Expr<boolean>,
	then: readonly StepType[],
	otherwise: readonly StepType[] = [],
): StepType {
	const parts: Fragment[] = [keyword('if '), condition.fragment, keyword(' then '), block(then)];
	if (otherwise.length) parts.push(keyword(' else '), block(otherwise));
	parts.push(keyword(' end if;'));
	return step(join(parts));
}

/** Run a statement, such as an insert into a history table. Its rows are discarded. */
export function run(statement: Statement<unknown>): StepType {
	return step(join([statement.query, keyword(';')]));
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
	return step(keyword(`return ${value};`));
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
	if (!steps.length || !steps.at(-1)!.fragment.some((part) => part.kind === 'text' && part.text.startsWith('return'))) {
		throw new TypeError(`Trigger function ${schema}.${name} must end with result().`);
	}
	return Object.freeze({
		schema,
		name,
		ddl: ddl(
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
	readonly condition?: Expr<boolean>;
	readonly routine: RoutineType;
}

function event(item: EventType): Fragment {
	if (typeof item === 'string') return keyword(item);
	if (!item.update.length) return keyword('update');
	return join([keyword('update of '), join(item.update.map((column) => identifier(column.name)), ', ')]);
}

/**
 * Drop and create a row-level trigger, so a later revision can change its events or condition. Run both statements in
 * the migration transaction; the table never runs without the trigger after the transaction commits.
 */
export function create(trigger: TriggerType): readonly Ddl[] {
	if (!trigger.events.length) throw new TypeError(`Trigger ${trigger.name} needs at least one event.`);
	if (trigger.condition?.fragment.some((part) => part.kind === 'text' && part.text.includes('tg_op'))) {
		throw new TypeError(`Trigger ${trigger.name} cannot test the operation in its condition.`);
	}
	const table = qualified(trigger.table.schema, trigger.table.name);
	const parts: Fragment[] = [
		keyword('create trigger '),
		identifier(trigger.name),
		keyword(` ${trigger.timing} `),
		join(trigger.events.map(event), ' or '),
		keyword(' on '),
		table,
		keyword(' for each row'),
	];
	if (trigger.condition) parts.push(keyword(' when '), group(trigger.condition.fragment));
	parts.push(keyword(' execute function '), qualified(trigger.routine.schema, trigger.routine.name), keyword('()'));
	return [
		ddl(join([keyword('drop trigger if exists '), identifier(trigger.name), keyword(' on '), table])),
		ddl(join(parts), true),
	];
}

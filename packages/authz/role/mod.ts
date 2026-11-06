/**
 * Provider-neutral role definitions backed by exact permission identity.
 *
 * Roles are declarative permission bundles. Provider adapters can translate a
 * canonical role into their native role representation, but they must not
 * recreate the role ID or permission grants independently.
 *
 * @module
 */
import * as catalogCore from '@okikio/collection/catalog';
import type { DefinitionInput as CatalogDefinitionInput } from '@okikio/collection/catalog';
import * as permission from '@okikio/authz/permission';
import { check } from '@okikio/context';
import type { Context } from '@okikio/context';
import type { PermissionChecker, PermissionDecision, PermissionRequest } from '../permission/types.ts';
import { decisions } from '../decisions.ts';

import type { RoleCatalog, RoleDefinition, RoleIds, RoleOptions, RoleSelection } from './types.ts';

/** Runtime identity set for role definitions admitted through `define()`. */
const roleDefinitions = new WeakSet<object>();

/** Explicit static bounds and mandatory application-owned target/tenant policy. */
export interface CheckerOptionsType {
	/** Largest authored role list; duplicates count toward this scan limit. */
	readonly maximumRoles: number;
	/** Largest total authored permission list across roles, including repeated grants. */
	readonly maximumGrants: number;
	/** Largest request batch accepted by the resulting checker. */
	readonly maximumChecks: number;
	/** Called only for exact granted definitions, even when the target is undefined. */
	readonly policy: (ctx: Context, request: PermissionRequest) => PermissionDecision | PromiseLike<PermissionDecision>;
}

/**
 * Snapshot exact static grants, then require application policy for every granted
 * target. This does not authenticate users or refresh membership. Create a new
 * checker after membership changes. Foreign lookalike IDs deny without invoking
 * policy. Provider faults propagate; the permission evaluator owns fault reporting.
 */
export function checker(roles: readonly RoleDefinition[], options: CheckerOptionsType): PermissionChecker {
	const { maximumRoles, maximumGrants, maximumChecks, policy } = options;
	for (const value of [maximumRoles, maximumGrants, maximumChecks]) {
		if (!Number.isSafeInteger(value) || value < 1) {
			throw new RangeError('Role checker bounds must be positive safe integers.');
		}
	}
	if (typeof policy !== 'function') throw new TypeError('Role checker requires an explicit target policy.');
	if (roles.length > maximumRoles) throw new RangeError('Role checker exceeds maximumRoles.');
	const grants = new Set<permission.PermissionDefinition>();
	const identities = new Map<string, RoleDefinition>();
	let count = 0;
	for (const role of roles) {
		if (!is(role)) throw new TypeError('Role checker requires canonical role definitions.');
		const previous = identities.get(role.id);
		if (previous !== undefined && previous !== role) throw new TypeError('Conflicting role definitions share an ID.');
		identities.set(role.id, role);
		for (const definition of role.permissions) {
			if (++count > maximumGrants) throw new RangeError('Role checker exceeds maximumGrants.');
			grants.add(definition);
		}
	}
	return Object.freeze({
		maximumChecks,
		/** Check the borrowed operation before and after each policy call; never cache its actor-specific answer. */
		async check(ctx: Context, requests: readonly PermissionRequest[]) {
			check(ctx);
			if (requests.length > maximumChecks) throw new RangeError('Role checker exceeds maximumChecks.');
			const output: PermissionDecision[] = [];
			for (const request of requests) {
				check(ctx);
				// Static membership is only the first gate. Every granted target still needs current policy.
				if (!grants.has(request.definition)) {
					output.push(Object.freeze({ allowed: false }));
					continue;
				}
				const decision = decisions([await policy(ctx, request)], 1, (message) => new TypeError(message))[0]!;
				check(ctx);
				output.push(decision);
			}
			return Object.freeze(output);
		},
	});
}

/** Define one immutable provider-neutral role. */
export function define<
	const Id extends string,
	Permission extends import('@okikio/authz/permission').PermissionDefinition =
		import('@okikio/authz/permission').PermissionDefinition,
>(input: RoleOptions<Id, Permission>): RoleDefinition<Id, Permission> {
	assertIdentifier(input.id);
	if (input.description !== undefined && input.description.trim().length === 0) {
		throw new TypeError('Role description cannot be empty.');
	}
	const permissions = Object.freeze([...(input.permissions ?? [])]);
	for (const definition of permissions) {
		if (!permission.is(definition)) {
			throw new TypeError(`Role ${JSON.stringify(input.id)} contains a permission not created by permission.define().`);
		}
	}
	if (new Set(permissions).size !== permissions.length) {
		throw new TypeError(`Role ${JSON.stringify(input.id)} contains the same permission more than once.`);
	}
	const definition = Object.freeze({
		kind: 'role',
		id: input.id,
		...(input.description === undefined ? {} : { description: input.description }),
		permissions,
	}) as RoleDefinition<Id, Permission>;
	roleDefinitions.add(definition);
	return definition;
}

/** Return whether a value is a role definition created by `define()`. */
export function is(value: unknown): value is RoleDefinition {
	return typeof value === 'object' && value !== null && roleDefinitions.has(value);
}

/** Create a named immutable role catalog. */
export function catalog<
	const Namespace extends string,
	const Entries extends Readonly<Record<PropertyKey, RoleDefinition>>,
>(namespace: Namespace, entries: Entries): RoleCatalog<Entries> {
	return catalogCore.create(namespace, entries);
}

/** Select a key-preserving role catalog subset. */
export function select<
	const Entries extends Readonly<Record<PropertyKey, RoleDefinition>>,
	const Keys extends readonly (keyof Entries & string)[],
>(
	source: RoleCatalog<Entries>,
	keys: Keys,
): RoleSelection<Entries[keyof Entries], Pick<Entries, Keys[number]>> {
	return catalogCore.select(source, keys);
}

/** Compose role definitions, catalogs, selections, and nested arrays. */
export function compose<Entry extends RoleDefinition>(
	...input: readonly CatalogDefinitionInput<Entry>[]
): readonly Entry[] {
	return catalogCore.compose(...input);
}

/** Return whether one exact role definition belongs to a catalog or selection. */
export function has<Entry extends RoleDefinition>(
	source: import('@okikio/collection/catalog').CatalogLike<Entry>,
	definition: unknown,
): definition is Entry {
	return catalogCore.has(source, definition);
}

/** Resolve one stable role ID back to an exact trusted definition. */
export function get<Entry extends RoleDefinition>(
	input: CatalogDefinitionInput<Entry>,
	id: string,
): Entry | undefined {
	return catalogCore.get(input, id);
}

/** Project stable role identifiers while preserving catalog keys. */
export function ids<const Entries extends Readonly<Record<PropertyKey, RoleDefinition>>>(
	source: RoleCatalog<Entries>,
): RoleIds<Entries>;
/** Project stable role identifiers from a key-preserving selection. */
export function ids<
	Entry extends RoleDefinition,
	const Entries extends Readonly<Record<PropertyKey, Entry>>,
>(source: RoleSelection<Entry, Entries>): RoleIds<Entries>;
/** Build the role identifier projection after catalog-kind narrowing. */
export function ids(
	source: import('@okikio/collection/catalog').CatalogLike<RoleDefinition>,
): Readonly<Record<string, string>> {
	return catalogCore.ids(source as never);
}

/** Return whether one exact canonical role grants one exact canonical permission. */
export function grants(
	definition: RoleDefinition,
	requested: import('@okikio/authz/permission').PermissionDefinition,
): boolean {
	if (!is(definition) || !permission.is(requested)) return false;
	return definition.permissions.includes(requested);
}

/** Reject invalid role IDs before they become durable catalog identities. */
function assertIdentifier(value: string): void {
	if (!/^[a-z0-9][a-z0-9._:-]*$/i.test(value)) {
		throw new TypeError(`Invalid role identifier ${JSON.stringify(value)}.`);
	}
}

export type { RoleCatalog, RoleDefinition, RoleDefinitions, RoleIds, RoleOptions, RoleSelection } from './types.ts';

/**
 * Which clients run against which targets. The suite and the CI planner both read this, so a cell the planner keys is
 * a cell the suite runs.
 *
 * @module
 */
import type { ClientType } from './clients/types.ts';
import type { TargetType } from './targets/types.ts';

/** Whether a client can reach a target at all: over a URL, through Neon's proxy, or in this process. */
export const reaches = (client: ClientType, target: TargetType): boolean => client.reach === (target.reach ?? 'url');

/** Every target and client pair that runs, in report order. */
export function cells(
	targets: readonly TargetType[],
	clients: readonly ClientType[],
): readonly { readonly target: TargetType; readonly client: ClientType }[] {
	return targets.flatMap((target) =>
		clients.filter((client) => reaches(client, target)).map((client) => ({ target, client }))
	);
}

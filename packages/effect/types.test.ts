import type { StandardSchemaV1 } from '@standard-schema/spec';
import * as effect from './mod.ts';

const RouteValueSchema: StandardSchemaV1<string, Readonly<{ routeId: string }>> = {
	'~standard': {
		version: 1,
		vendor: 'type-test',
		validate(value: unknown) {
			return typeof value === 'string'
				? { value: { routeId: value } }
				: { issues: [{ message: 'Expected route ID.' }] };
		},
	},
};

const RouteCommitted = effect.define({
	id: 'capture.route-committed',
	value: RouteValueSchema,
});

async function check(): Promise<void> {
	const occurrence = await effect.create(RouteCommitted, 'route-1', { key: 'route-1' });
	const definition: typeof RouteCommitted = occurrence.definition;
	const routeId: string = occurrence.value.routeId;

	void definition;
	void routeId;

	// @ts-expect-error the schema input is a string, not a numeric route ID.
	await effect.create(RouteCommitted, 1, { key: 'route-1' });

	// @ts-expect-error the validated occurrence value is the schema output object.
	const raw: string = occurrence.value;
	void raw;
}

void check;

import type { StandardSchemaV1 } from '@standard-schema/spec';
import * as failure from './mod.ts';

const Timeout = failure.define({
	id: 'capture.timeout',
	description: 'Capture exceeded its deadline.',
	data: {
		'~standard': {
			version: 1,
			vendor: 'type-test',
			validate(value: unknown) {
				return { value: { milliseconds: Number(value) } };
			},
		},
	} satisfies StandardSchemaV1<unknown, Readonly<{ milliseconds: number }>>,
});

async function check(): Promise<void> {
	const occurrence = await failure.create(Timeout, { data: 250 });
	const exactDefinition: typeof Timeout = occurrence.definition;
	const milliseconds: number = occurrence.data.milliseconds;

	void exactDefinition;
	void milliseconds;

	// @ts-expect-error validated failure data is not a string.
	const invalidData: string = occurrence.data.milliseconds;
	void invalidData;
}

void check;

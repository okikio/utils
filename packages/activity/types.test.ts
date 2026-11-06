/** Compiler checks for exact authored declarations, selected catalogs and directional inputs. */
import * as activity from './mod.ts';
import * as engine from './engine.ts';
import * as resource from '@okikio/capability/resource';
import * as failure from '@okikio/result/failure';
import * as schema from '@okikio/schema';
import * as codec from '@okikio/schema/codec';

const Database = resource.define<{ read(): string }>()({ id: 'types.database', description: 'Read application data.' });
const OtherDatabase = resource.define<{ read(): string }>()({
	id: 'types.other',
	description: 'Same shape, separate authority.',
});
const Resources = resource.catalog('types', { Database, OtherDatabase });
const Missing = failure.define({ id: 'types.missing', description: 'Missing value.', data: schema.string() });
const Denied = failure.define({ id: 'types.denied', description: 'Denied value.', data: schema.number() });
const Dates = codec.define({
	decode: schema.transform(schema.string(), (value) => new Date(value)),
	encode: schema.transform(schema.date(), (value) => value.toISOString()),
});
const Read = activity.define({
	id: 'types.read',
	version: '1',
	input: Dates,
	result: Dates,
	placement: engine.require(engine.define({ id: 'types.local' })),
	resources: resource.select(Resources, ['Database']),
	failures: [Missing, Denied],
});

activity.implement(Read, {
	async run(ctx) {
		const input: Date = ctx.input;
		const database: { read(): string } = await ctx.get(Database);
		void database;
		// @ts-expect-error Same-shaped definitions with a different authored ID are not declared here.
		await ctx.get(OtherDatabase);
		return input;
	},
});

function contracts(reason: activity.ActivityFailures<typeof Read>): void {
	const correlated: failure.Occurrence<typeof Missing> | failure.Occurrence<typeof Denied> = reason;
	void correlated;
	if (failure.is(reason, Missing)) {
		const text: string = reason.data;
		void text;
	}
	activity.request(Read, '2026-01-01T00:00:00Z');
	// @ts-expect-error The request accepts encoded input; the implementation receives Date.
	activity.request(Read, new Date());
}
void contracts;

/** Check the default local call through source and emitted public declarations; never launch it as a fixture. */
async function localCall(): Promise<void> {
	const Upper = activity.define({ id: 'types.call', version: '1', input: schema.string(), result: schema.string() });
	const live = activity.implement(Upper, { run: (ctx) => ctx.input.toUpperCase() });
	const text: string = await activity.call(live, 'hello');
	void text;
	// @ts-expect-error A local call accepts the input declared by its exact implementation.
	await activity.call(live, 1);
	// @ts-expect-error The checked output remains string, including in emitted declarations.
	const number: number = await activity.call(live, 'hello');
	void number;
}
void localCall;

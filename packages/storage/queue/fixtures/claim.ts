import postgres from 'postgres';
import * as context from '@okikio/context';
import * as schema from '@okikio/schema';
import { open } from '../postgres.ts';

/** Crash fixture announces only after PostgreSQL committed its live claim. */
const database = postgres(process.argv[2]!, { max: 1 });
const queue = open({
	database,
	namespace: process.argv[3]!,
	contract: 'text-v1',
	input: schema.string(),
	output: schema.string(),
	pollMilliseconds: 5,
});
const ctx = context.create({ id: 'doomed' });
const [claim] = await queue.claim(ctx, { duration: { milliseconds: 100 } });
if (claim === undefined) throw new Error('No claim was available.');
process.stdout.write('claimed\n');
setInterval(() => {}, 1000);

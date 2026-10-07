import { run } from '../../bench/run.ts';
import { bench, do_not_optimize, group } from 'mitata';
import { z } from 'zod';

import * as env from './zod.ts';

const BenchmarkEnvironment = env.define({
	PORT: z.coerce.number().int().positive().meta({
		description: 'Benchmark HTTP port.',
	}),
	MODE: z.enum(['development', 'production']).meta({
		description: 'Benchmark runtime mode.',
	}),
});

const source = env.record({
	PORT: '8787',
	MODE: 'production',
});

const initial = BenchmarkEnvironment.parseSync(source);
if (initial.PORT !== 8787 || initial.MODE !== 'production') {
	throw new Error('Environment benchmark fixture did not parse its typed values.');
}

const DirectSchema = z.object({
	PORT: z.coerce.number().int().positive(),
	MODE: z.enum(['development', 'production']),
});
const raw = { PORT: '8787', MODE: 'production' };
const direct = DirectSchema.parse(raw);
if (direct.PORT !== initial.PORT || direct.MODE !== initial.MODE) {
	throw new Error('Direct Zod baseline differs from environment fixture.');
}

group('@okikio/env', () => {
	bench('parse two Zod-backed fields', () => {
		do_not_optimize(BenchmarkEnvironment.parseSync(source));
	}).gc('once');
});

group('direct npm Zod: no source diagnostics or environment metadata', () => {
	bench('parse the same two fields directly', () => do_not_optimize(DirectSchema.parse(raw))).gc('once');
});

await run();

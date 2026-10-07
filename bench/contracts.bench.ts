/**
 * Service admission and authoritative announcements, with provider I/O excluded.
 * Fixed target and reading oracles protect the validation and exact definition
 * contracts. Counters retain no events across timed iterations.
 */
import { deepStrictEqual, strictEqual } from 'node:assert';
import { bench, do_not_optimize, group } from 'mitata';
import { z } from 'zod';
import * as context from '@okikio/context';
import * as effect from '@okikio/effect';
import * as entitlement from '@okikio/entitlement';
import * as meter from '@okikio/meter';
import * as permission from '@okikio/permission';
import * as requirement from '@okikio/requirement';
import * as resilience from '@okikio/resilience';
import { run } from './run.ts';

const TargetSchema = z.object({ id: z.string() });
const Read = permission.define({ id: 'bench.asset.read', target: TargetSchema });
const Export = entitlement.define({ id: 'bench.export.csv' });
const NeedsExport = entitlement.require(Export);
const Saved = effect.define({
	id: 'bench.asset.saved',
	description: 'A stored asset was accepted.',
	value: TargetSchema,
});
const Bytes = meter.define({ id: 'bench.download.bytes', unit: 'byte', aggregation: 'sum' });
const clock = new context.TestClock();
await using owner = context.create({ id: 'contracts-benchmark', clock });
const permissions = permission.scope(owner, {
	permissions: [Read],
	checker: {
		maximumChecks: 100,
		async check(_ctx, requests) {
			return requests.map((entry) => ({ allowed: TargetSchema.parse(entry.target).id === 'public' }));
		},
	},
});
let admitted = 0;
const requirements = requirement.scope(owner, {
	interpreters: {
		entitlement: {
			async apply(_ctx, entries) {
				admitted += entries.length;
			},
		},
	},
});
let accepted = 0;
const effects = effect.scope(owner, {
	effects: [Saved, meter.effect(Bytes)],
	emitter: {
		async emit() {
			accepted++;
		},
	},
});
const policy = [
	resilience.timeout('PT2S'),
	resilience.retry({ maximumAttempts: 3, jitter: false }),
	resilience.idempotent({ maximumKeyBytes: 128 }),
];

strictEqual(await permission.check(permissions, Read, { id: 'public' }), true);
strictEqual(await permission.check(permissions, Read, { id: 'private' }), false);
await requirement.apply(requirements, [NeedsExport]);
strictEqual(admitted, 1);
strictEqual(requirement.document(NeedsExport)[0]?.definition, 'bench.export.csv');
const occurrence = await effect.emit(effects, Saved, { id: 'asset-1' }, { key: 'save:asset-1' });
const encoded = await effect.encode(occurrence);
const decoded = await effect.decode(encoded, [Saved]);
strictEqual(decoded.definition, Saved);
strictEqual(decoded.key, 'save:asset-1');
deepStrictEqual(decoded.value, { id: 'asset-1' });
const reading = await meter.record(effects, Bytes, 2048, { key: 'download:asset-1' });
deepStrictEqual(reading.value, { value: 2048, at: clock.now().toString() });
strictEqual(accepted, 2);
const valid = resilience.validate(policy, { safety: 'unsafe' });
if (!valid.valid) throw new Error('Bounded idempotent retry fixture was rejected.');
strictEqual(valid.policies.length, 3);
const invalid = resilience.validate([policy[1]!], { safety: 'unsafe' });
if (invalid.valid || !invalid.issues.some((issue) => issue.code === 'unsafe-retry')) {
	throw new Error('Resilience fixture failed to distinguish unsafe unprotected retry.');
}

group('Per-operation service contracts: no network or external policy engine', () => {
	bench('permission target validation and accepted decision', async () => {
		do_not_optimize(await permission.check(permissions, Read, { id: 'public' }));
	});
	bench('permission target validation and denied decision', async () => {
		do_not_optimize(await permission.check(permissions, Read, { id: 'private' }));
	});
	bench('activate exact entitlement through requirement interpreter', async () => {
		await requirement.apply(requirements, [NeedsExport]);
		do_not_optimize(admitted);
	});
	bench('effect acceptance plus durable envelope round trip', async () => {
		const value = await effect.emit(effects, Saved, { id: 'asset-1' }, { key: 'save:asset-1' });
		do_not_optimize(await effect.decode(await effect.encode(value), [Saved]));
	});
	bench('meter clock reading, validation and effect acceptance', async () => {
		do_not_optimize(await meter.record(effects, Bytes, 2048, { key: 'download:asset-1' }));
	});
	bench('compile bounded idempotent retry/timeout plan', () => {
		do_not_optimize(resilience.validate(policy, { safety: 'unsafe' }));
	});
});
await run();

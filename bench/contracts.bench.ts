/**
 * Service admission and authoritative announcements, with provider I/O excluded.
 * Fixed target and reading oracles protect the validation and exact definition
 * contracts. Counters retain no events across timed iterations.
 */
import { deepStrictEqual, strictEqual } from 'node:assert';
import { bench, do_not_optimize, group } from 'mitata';
import * as schema from '@okikio/schema';
import * as context from '@okikio/context';
import * as effect from '@okikio/capability/effect';
import * as entitlement from '@okikio/authz/entitlement';
import * as meter from '@okikio/capability/effect/meter';
import * as permission from '@okikio/authz/permission';
import * as requirement from '@okikio/capability/requirement';
import * as resilience from '@okikio/capability/resilience';
import { run } from '#tools/bench/run.ts';

const TargetSchema = schema.object({ id: schema.string() });
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
			return requests.map((entry) => ({ allowed: permission.matches(entry, Read) && entry.target.id === 'public' }));
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
deepStrictEqual(Object.entries(decoded.value), [['id', 'asset-1']]);
strictEqual(Object.getPrototypeOf(decoded.value), null);
const reading = await meter.record(effects, Bytes, 2048, { key: 'download:asset-1' });
if (reading.value === null || typeof reading.value !== 'object') {
	throw new TypeError('Meter reading must be an object.');
}
deepStrictEqual({ ...reading.value }, { value: 2048, at: clock.now().toString() });
strictEqual(Object.getPrototypeOf(reading.value), null);
strictEqual(accepted, 2);
const valid = resilience.validate(policy, { safety: 'unsafe' });
if (!valid.valid) throw new Error('Bounded idempotent retry fixture was rejected.');
strictEqual(valid.policies.length, 3);
const invalid = resilience.validate([policy[1]!], { safety: 'unsafe' });
if (invalid.valid || !invalid.issues.some((issue) => issue.code === 'unsafe-retry')) {
	throw new Error('Resilience fixture failed to distinguish unsafe unprotected retry.');
}

/** A request validates policy, admits the feature, announces its result and records usage. */
async function request(): Promise<string> {
	if (!await permission.check(permissions, Read, { id: 'public' })) throw new Error('Request unexpectedly denied.');
	await requirement.apply(requirements, [NeedsExport]);
	const saved = await effect.emit(effects, Saved, { id: 'asset-1' }, { key: 'save:asset-1' });
	const receipt = await effect.decode(await effect.encode(saved), [Saved]);
	await meter.record(effects, Bytes, 2048, { key: 'download:asset-1' });
	if (!resilience.validate(policy, { safety: 'unsafe' }).valid) throw new Error('Policy became invalid.');
	return receipt.value.id;
}
strictEqual(await request(), 'asset-1');
group('authorized asset request: feature admission, accepted effect and usage reading', () => {
	bench(
		'complete local admission and durable-envelope round trip, no provider I/O',
		async () => do_not_optimize(await request()),
	);
});
await run();

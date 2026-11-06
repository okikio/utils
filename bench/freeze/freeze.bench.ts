// @benchmark runner=freeze
/**
 * Measure targeted freeze costs while preserving each source function's other work.
 *
 * Each sample retains the last 1,024 produced values and reads a checksum. The
 * objects therefore escape their factory. A read-only case constructs its input
 * before timing. Plain variants intentionally weaken mutation guarantees; equal
 * successful output does not make those variants safe replacements.
 *
 * From the repository root, prepare with `mise run prepare -- --kind freeze`.
 * Collect Node samples with `mise run bench -- --operation freeze -- --seed 101`.
 * See this folder's README for Deno/Bun commands and explicit output filenames.
 * Use --validate-only to check existing oracles without warmups or timed batches.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { arch, cpus, platform, release } from 'node:os';
import { resolve } from 'node:path';

// Generated modules are ignored; a fresh checkout must prepare an explicit source checkpoint.
if (!existsSync(new URL('../../.tmp/artifacts/bench/freeze/inventory.json', import.meta.url))) {
	throw new Error('No prepared freeze checkpoint. Run mise run prepare -- --kind freeze.');
}

const frozenResult: typeof import('@okikio/result') = await import(
	new URL('../../.tmp/artifacts/bench/freeze/generated/result-frozen.mjs', import.meta.url).href
);
const plainResult: typeof import('@okikio/result') = await import(
	new URL('../../.tmp/artifacts/bench/freeze/generated/result-plain.mjs', import.meta.url).href
);
const frozenRecord: typeof import('@okikio/collection/record') = await import(
	new URL('../../.tmp/artifacts/bench/freeze/generated/record-frozen.mjs', import.meta.url).href
);
const plainRecord: typeof import('@okikio/collection/record') = await import(
	new URL('../../.tmp/artifacts/bench/freeze/generated/record-plain.mjs', import.meta.url).href
);
const frozenCatalog: typeof import('@okikio/collection/catalog') = await import(
	new URL('../../.tmp/artifacts/bench/freeze/generated/catalog-frozen.mjs', import.meta.url).href
);
const plainCatalog: typeof import('@okikio/collection/catalog') = await import(
	new URL('../../.tmp/artifacts/bench/freeze/generated/catalog-plain.mjs', import.meta.url).href
);
const frozenProgress: Pick<typeof import('@okikio/task'), 'ProgressSchema'> = await import(
	new URL('../../.tmp/artifacts/bench/freeze/generated/progress-frozen.mjs', import.meta.url).href
);
const plainProgress: Pick<typeof import('@okikio/task'), 'ProgressSchema'> = await import(
	new URL('../../.tmp/artifacts/bench/freeze/generated/progress-plain.mjs', import.meta.url).href
);

/** Check the prepared runtime dependency closure before and after measurement. */
const inventoryBytes = readFileSync(new URL('../../.tmp/artifacts/bench/freeze/inventory.json', import.meta.url));
const inventory = JSON.parse(inventoryBytes.toString('utf8')) as {
	readonly schemaVersion: number;
	readonly provenance: { readonly inputs: Readonly<Record<string, string>> };
};
if (inventory.schemaVersion !== 2) {
	throw new Error('Run mise run prepare -- --kind freeze for this source checkpoint first.');
}
const provenance = {
	inventorySha256: createHash('sha256').update(inventoryBytes).digest('hex'),
	inputs: inventory.provenance.inputs,
};
/** Reject a changed inventory or source checkpoint before its timings can be attributed to the saved inputs. */
function verifyInputs(): void {
	if (
		createHash('sha256').update(
			readFileSync(new URL('../../.tmp/artifacts/bench/freeze/inventory.json', import.meta.url)),
		)
			.digest('hex') !==
			provenance.inventorySha256
	) {
		throw new Error('Freeze inventory changed during measurement. Discard this run.');
	}
	for (const [path, expected] of Object.entries(provenance.inputs)) {
		const bytes = readFileSync(new URL(`../../${path}`, import.meta.url));
		if (createHash('sha256').update(bytes).digest('hex') !== expected) {
			throw new Error(`Freeze benchmark input changed: ${path}. Prepare a new checkpoint.`);
		}
	}
}
verifyInputs();

/** Treatment labels are stored on every sample, rather than inferred from order. */
type Variant = 'frozen' | 'plain';
/** One preconfigured synchronous workload; its returned checksum is consumed. */
interface Workload {
	/** Stable descriptive name used in raw output and summary tables. */
	readonly name: string;
	/** Concrete work counted as one operation. */
	readonly operation: string;
	/** True for an inspected source function; false for a deliberately scoped model. */
	readonly actualSource: boolean;
	/** The returned function owns its retained values, outside the source baseline. */
	readonly build: (variant: Variant) => (iterations: number) => number;
}
/** One elapsed sample is a batch average, not a service-request tail latency. */
interface Sample {
	readonly workload: string;
	readonly variant: Variant;
	readonly pair: number;
	readonly order: number;
	readonly iterations: number;
	readonly milliseconds: number;
	readonly nanosecondsPerOperation: number;
	readonly operationsPerSecond: number;
	readonly checksum: number;
}
/** Produced values remain observable through these module-level slots. */
const retained: unknown[][] = [];
/** Sum across measured calls prevents silently dropping the returned checksums. */
let consumed = 0;
/** A power-of-two ring bounds retained memory while making factory results escape. */
const ringSize = 1024;
/** Test fields are identical for both variants and use ordinary own data properties. */
const recordValue = { id: 'asset-1', visits: 19, active: true, group: 'crawl' };
/** Definition objects are shared inputs; the catalog wrappers alone are under test. */
const definitions = Object.fromEntries(
	Array.from(
		{ length: 16 },
		(_, index) => [`asset${index}`, { id: `asset.${index}`, kind: 'asset' }],
	),
);

/** Keep each workload's allocations reachable after the timer ends. */
function ring(): unknown[] {
	const values = new Array<unknown>(ringSize);
	retained.push(values);
	return values;
}
/** Fail early if a successful output differs; this is independent of immutability. */
function equal(actual: unknown, expected: unknown, label: string): void {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(`${label}: successful values differ.`);
	}
}
/** Confirm that unsupported input still rejects in both A/B modules. */
function rejects(action: () => unknown, label: string): void {
	let failed = false;
	try {
		action();
	} catch {
		failed = true;
	}
	if (!failed) throw new Error(`${label}: invalid input was accepted.`);
}
/** Validate semantic equality and explicitly record the weakened mutation contract. */
function validate(): Record<string, unknown> {
	equal(frozenResult.ok(9), plainResult.ok(9), 'Result');
	equal(
		frozenRecord.entries(recordValue),
		plainRecord.entries(recordValue),
		'Record entries',
	);
	equal(
		frozenRecord.snapshot(recordValue),
		plainRecord.snapshot(recordValue),
		'Record snapshot',
	);
	equal(
		frozenProgress.ProgressSchema.parse({ completed: 2, total: 3 }),
		plainProgress.ProgressSchema.parse({ completed: 2, total: 3 }),
		'Progress',
	);
	rejects(() =>
		frozenRecord.snapshot({
			get unsafe() {
				throw new Error('getter called');
			},
		}), 'frozen record');
	rejects(() =>
		plainRecord.snapshot({
			get unsafe() {
				throw new Error('getter called');
			},
		}), 'plain record');
	rejects(
		() => frozenProgress.ProgressSchema.parse({ completed: 4, total: 3 }),
		'frozen progress',
	);
	rejects(
		() => plainProgress.ProgressSchema.parse({ completed: 4, total: 3 }),
		'plain progress',
	);
	const frozen = frozenResult.ok({ count: 1 }),
		plain = plainResult.ok({ count: 1 });
	const frozenCatalogValue = frozenCatalog.create('bench', definitions),
		plainCatalogValue = plainCatalog.create('bench', definitions);
	equal(
		Object.keys(frozenCatalogValue),
		Object.keys(plainCatalogValue),
		'Catalog keys',
	);
	equal(
		frozenCatalog.ids(frozenCatalogValue),
		plainCatalog.ids(plainCatalogValue),
		'Catalog identifiers',
	);
	if (
		frozenCatalog.get(frozenCatalogValue, 'asset.0') !== definitions.asset0 ||
		plainCatalog.get(plainCatalogValue, 'asset.0') !== definitions.asset0
	) throw new Error('Catalog lost exact definition identity.');
	const target = { id: 'new', kind: 'asset' };
	const frozenRecords = frozenRecord.entries(recordValue),
		plainRecords = plainRecord.entries(recordValue);
	const frozenProgressValue = frozenProgress.ProgressSchema.parse({
			completed: 2,
			total: 3,
		}),
		plainProgressValue = plainProgress.ProgressSchema.parse({
			completed: 2,
			total: 3,
		});
	const checks = {
		successfulOutputsEqual: true,
		invalidInputsRejected: true,
		frozenResultTagWritable: Reflect.set(frozen, 'ok', false),
		plainResultTagWritable: Reflect.set(plain, 'ok', false),
		frozenNestedPayloadStillMutable: Reflect.set(frozen.value, 'count', 2),
		frozenCatalogExtensible: Object.isExtensible(frozenCatalogValue),
		plainCatalogExtensible: Object.isExtensible(plainCatalogValue),
		plainCatalogAddedEntryAcceptedByObject: Reflect.set(
			plainCatalogValue,
			'added',
			target,
		),
		plainCatalogAddedEntryKnownToMetadata: plainCatalog.get(plainCatalogValue, 'new') !== undefined,
		frozenRecordEntriesExtensible: Object.isExtensible(frozenRecords),
		plainRecordEntriesExtensible: Object.isExtensible(plainRecords),
		frozenProgressCompletedWritable: Reflect.set(
			frozenProgressValue,
			'completed',
			4,
		),
		plainProgressCompletedWritable: Reflect.set(
			plainProgressValue,
			'completed',
			4,
		),
	};
	if (
		checks.frozenResultTagWritable || !checks.plainResultTagWritable ||
		checks.frozenCatalogExtensible || !checks.plainCatalogExtensible ||
		checks.plainCatalogAddedEntryKnownToMetadata
	) {
		throw new Error(
			'Mutation-contract experiment did not produce the expected distinction.',
		);
	}
	return checks;
}

/** Workloads retain source validation and serialization around the selected freeze calls. */
const workloads: readonly Workload[] = [
	{
		name: 'result-create',
		operation: 'one actual result.ok wrapper with a numeric value',
		actualSource: true,
		build(variant) {
			const factory = variant === 'frozen' ? frozenResult.ok : plainResult.ok,
				values = ring();
			return (count) => {
				for (let i = 0; i < count; i++) values[i & (ringSize - 1)] = factory(i);
				let sum = 0;
				for (const v of values) if (v) sum += (v as { value: number }).value;
				return sum;
			};
		},
	},
	{
		name: 'result-read',
		operation: 'one read of an already-created Result value',
		actualSource: true,
		build(variant) {
			const factory = variant === 'frozen' ? frozenResult.ok : plainResult.ok;
			const values = Array.from({ length: 4096 }, (_, i) => factory(i));
			retained.push(values);
			return (count) => {
				let sum = 0;
				for (let i = 0; i < count; i++) {
					const value = values[i & 4095]!;
					sum += value.ok ? value.value : 0;
				}
				return sum;
			};
		},
	},
	{
		name: 'effect-envelope',
		operation:
			'modeled already-validated effect occurrence allocation plus WeakSet registration; excludes schema parsing and async delivery',
		actualSource: false,
		build(variant) {
			const values = ring(),
				occurrences = new WeakSet<object>(),
				definition = { kind: 'effect', id: 'asset.saved' };
			const factory = variant === 'frozen'
				? (value: number) => {
					const occurrence = {
						kind: 'effect-occurrence',
						definition,
						key: 'asset:1',
						value,
					};
					occurrences.add(occurrence);
					return Object.freeze(occurrence);
				}
				: (value: number) => {
					const occurrence = {
						kind: 'effect-occurrence',
						definition,
						key: 'asset:1',
						value,
					};
					occurrences.add(occurrence);
					return occurrence;
				};
			return (count) => {
				for (let i = 0; i < count; i++) values[i & (ringSize - 1)] = factory(i);
				let sum = 0;
				for (const v of values) if (v) sum += (v as { value: number }).value;
				return sum;
			};
		},
	},
	{
		name: 'record-entries',
		operation: 'one actual record.entries call for four fields',
		actualSource: true,
		build(variant) {
			const factory = variant === 'frozen' ? frozenRecord.entries : plainRecord.entries,
				values = ring();
			return (count) => {
				for (let i = 0; i < count; i++) {
					values[i & (ringSize - 1)] = factory(
						recordValue,
					);
				}
				let sum = 0;
				for (const v of values) if (v) sum += (v as unknown[]).length;
				return sum;
			};
		},
	},
	{
		name: 'record-snapshot',
		operation: 'one actual record.snapshot call for four fields',
		actualSource: true,
		build(variant) {
			const factory = variant === 'frozen' ? frozenRecord.snapshot : plainRecord.snapshot,
				values = ring();
			return (count) => {
				for (let i = 0; i < count; i++) {
					values[i & (ringSize - 1)] = factory(
						recordValue,
					);
				}
				let sum = 0;
				for (const v of values) if (v) sum += (v as { visits: number }).visits;
				return sum;
			};
		},
	},
	{
		name: 'progress-validate',
		operation: 'one actual ProgressSchema parse including JSON checking/copying',
		actualSource: true,
		build(variant) {
			const factory = variant === 'frozen' ? frozenProgress.ProgressSchema.parse : plainProgress.ProgressSchema.parse,
				values = ring();
			const input = {
				completed: 0,
				total: 1024,
				unit: 'pages',
				message: 'crawling',
				data: { queued: 3 },
			};
			return (count) => {
				for (let i = 0; i < count; i++) {
					input.completed = i & 1023;
					values[i & (ringSize - 1)] = factory(input);
				}
				let sum = 0;
				for (const v of values) {
					if (v) {
						sum += (v as { completed: number }).completed;
					}
				}
				return sum;
			};
		},
	},
	{
		name: 'catalog-create',
		operation: 'one actual catalog.create for 16 shared definitions',
		actualSource: true,
		build(variant) {
			const factory = variant === 'frozen' ? frozenCatalog.create : plainCatalog.create,
				values = ring();
			return (count) => {
				for (let i = 0; i < count; i++) {
					values[i & (ringSize - 1)] = factory(
						'bench.assets',
						definitions,
					);
				}
				let sum = 0;
				for (const v of values) if (v) sum += Object.keys(v).length;
				return sum;
			};
		},
	},
	{
		name: 'progress-result-json',
		operation: 'validate progress, wrap it in Result, serialize/parse the result',
		actualSource: false,
		build(variant) {
			const parse = variant === 'frozen' ? frozenProgress.ProgressSchema.parse : plainProgress.ProgressSchema.parse;
			const ok = variant === 'frozen' ? frozenResult.ok : plainResult.ok,
				values = ring();
			const input = {
				completed: 0,
				total: 1024,
				unit: 'pages',
				message: 'crawling',
				data: { queued: 3 },
			};
			return (count) => {
				for (let i = 0; i < count; i++) {
					input.completed = i & 1023;
					values[i & (ringSize - 1)] = JSON.parse(
						JSON.stringify(ok(parse(input))),
					);
				}
				let sum = 0;
				for (const v of values) {
					if (v) {
						sum += (v as { value: { completed: number } }).value.completed;
					}
				}
				return sum;
			};
		},
	},
];

/** Read simple CLI flags without runtime-specific argument parsing dependencies. */
function option(name: string, fallback: string): string {
	const index = process.argv.indexOf(name);
	return index < 0 ? fallback : process.argv[index + 1] ?? fallback;
}
/** Reproducible order avoids always giving the second variant a warmed-up process. */
function random(seed: number): () => number {
	let value = seed >>> 0;
	return () => {
		value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
		return value / 4294967296;
	};
}
/** Time only workload execution, consuming the checksum after the interval ends. */
function measure(
	work: (iterations: number) => number,
	iterations: number,
): { milliseconds: number; checksum: number } {
	const start = performance.now(),
		checksum = work(iterations),
		milliseconds = performance.now() - start;
	consumed = (consumed + checksum) % Number.MAX_SAFE_INTEGER;
	if (!Number.isFinite(checksum)) {
		throw new Error('Non-finite correctness checksum.');
	}
	return { milliseconds, checksum };
}
/** Choose one shared count for each pair, targeting at least 25 ms in the faster variant. */
function calibrate(
	frozen: (n: number) => number,
	plain: (n: number) => number,
): number {
	let count = 1024;
	for (let i = 0; i < 24; i++) {
		const a = measure(frozen, count).milliseconds,
			b = measure(plain, count).milliseconds;
		if (Math.min(a, b) >= 25 || count >= 16_777_216) return count;
		count *= 2;
	}
	return count;
}

/** Every output file contains raw paired samples plus enough environment data to interpret them. */
const seed = Number(option('--seed', '101')),
	pairs = Number(option('--pairs', '12'));
if (
	!Number.isSafeInteger(seed) || !Number.isSafeInteger(pairs) || pairs < 6 ||
	pairs > 100
) {
	throw new Error(
		'Seed and pairs must be finite integers; pairs must be 6 through 100.',
	);
}
const rng = random(seed), samples: Sample[] = [], validation = validate();
// A relocated checkpoint can verify imports and mutation contracts without rerunning performance measurements.
if (process.argv.includes('--validate-only')) {
	console.log(
		JSON.stringify({ mode: 'validate-only', passed: true, timedSamples: samples.length, provenance, validation }),
	);
	process.exit(0);
}
const startTime = new Date().toISOString();
for (const workload of workloads) {
	const frozen = workload.build('frozen'), plain = workload.build('plain');
	const iterations = calibrate(frozen, plain);
	// Separate warmup from retained samples and warm both variants equally.
	for (let i = 0; i < 4; i++) {
		measure(i % 2 ? plain : frozen, iterations);
		measure(i % 2 ? frozen : plain, iterations);
	}
	for (let pair = 0; pair < pairs; pair++) {
		const order: readonly Variant[] = rng() < 0.5 ? ['frozen', 'plain'] : ['plain', 'frozen'];
		let pairedChecksum: number | undefined;
		for (let index = 0; index < order.length; index++) {
			const variant = order[index]!,
				measurement = measure(
					variant === 'frozen' ? frozen : plain,
					iterations,
				);
			if (
				pairedChecksum !== undefined && pairedChecksum !== measurement.checksum
			) throw new Error(`Paired checksum mismatch in ${workload.name}.`);
			pairedChecksum = measurement.checksum;
			samples.push({
				workload: workload.name,
				variant,
				pair,
				order: index,
				iterations,
				...measurement,
				nanosecondsPerOperation: measurement.milliseconds * 1e6 / iterations,
				operationsPerSecond: iterations / measurement.milliseconds * 1000,
			});
		}
	}
}
const output = resolve(
	option('--output', resolve(import.meta.dirname, '../../.tmp/artifacts/bench/freeze/freeze-samples.json')),
);
const runtimeGlobals = globalThis as typeof globalThis & {
	Deno?: { version: { deno: string; v8: string; typescript: string } };
	Bun?: { version: string };
};
const report = {
	schemaVersion: 2,
	provenance,
	question: 'What changes when only the inspected module Object.freeze calls are removed?',
	startTime,
	endTime: new Date().toISOString(),
	seed,
	pairs,
	environment: {
		processId: process.pid,
		arguments: process.argv.slice(2),
		node: process.version,
		versions: process.versions,
		deno: runtimeGlobals.Deno?.version,
		bun: runtimeGlobals.Bun?.version,
		platform: platform(),
		architecture: arch(),
		kernel: release(),
		cpuModel: cpus()[0]?.model,
		logicalCpus: cpus().length,
		execArgv: process.execArgv,
	},
	treatment:
		'AST-generated source copies: Object.freeze(expression) becomes expression in the plain variant; original source stays unchanged. ProgressEffect is omitted from both progress copies to avoid unused effect initialization.',
	scope:
		'Warm synchronous batches; read-only source variants; no I/O, scheduler, durable storage, memory-byte accounting, or production service tail-latency claims.',
	workloads: workloads.map(({ build: _, ...description }) => description),
	validation,
	samples,
	consumed,
	retainedCollections: retained.length,
};
verifyInputs();
writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(
	JSON.stringify({
		output,
		runtime: runtimeGlobals.Deno?.version.deno ?? runtimeGlobals.Bun?.version ??
			process.version,
		samples: samples.length,
		workloads: workloads.length,
		consumed,
	}),
);

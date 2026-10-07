import { expect } from '@std/expect';
import { describe, it } from 'node:test';

import { qualify, qualifyBenchmarks } from './check-qualification.ts';

/** Independent tiny matrix exercises validation without reproducing the repository inventory. */
function fixture() {
	const files = new Set(['packages/example/mod.test.ts', 'tools/consumer.mjs', 'bench/example.bench.ts']);
	const manifests = [{ name: '@example/value', file: 'packages/example/deno.jsonc' }];
	const evidence = {
		files: ['packages/example/mod.test.ts'],
		properties: ['Returned values preserve caller identity.'],
	};
	const document = {
		schemaVersion: 1,
		packages: [{
			name: '@example/value',
			manifest: 'packages/example/deno.jsonc',
			model: 'Return one explicitly owned value.',
			behavior: evidence,
			invariants: { files: [...evidence.files], properties: [...evidence.properties] },
			scenarios: {
				ids: [],
				reason: 'This declaration has no larger runtime flow; its identity contract is directly exercised.',
			},
			runtime: {
				sourceDeno: { command: 'deno task test', files: ['packages/example/mod.test.ts'] },
				sourceNode: { files: [], reason: 'This source selector is not part of the Node gate.' },
				emittedNode: {
					command: 'mise run npm-verify',
					checker: 'tools/consumer.mjs',
					proves: 'Install the packed export and compare its semantic value.',
				},
			},
			benchmark: { programs: ['bench/example.bench.ts'], question: 'What is the allocation cost per admitted value?' },
		}],
		scenarios: [],
		testReview: [{
			file: 'packages/example/mod.test.ts',
			disposition: 'retain',
			protects: 'Caller identity survives independent storage and retrieval.',
		}],
	};
	return { document, manifests, files };
}

/** One valid independent performance record lets each fault alter only its own contract. */
function performanceFixture() {
	const values = fixture();
	const registry = {
		schemaVersion: 1,
		packages: {
			'@example/value': [{
				program: 'bench/example.bench.ts',
				question: 'What does owned admission cost?',
				comparison: 'A plain value omits ownership.',
				limits: 'Only successful admitted values are compared.',
			}],
		},
	};
	return { ...values, registry };
}

describe('qualification matrix', () => {
	it('accepts concrete evidence and explicit runtime applicability without claiming execution', () => {
		const { document, manifests, files } = fixture();
		expect(qualify(document, manifests, files)).toEqual([]);
	});

	it('rejects an absent benchmark program independently of valid comparison metadata', () => {
		const { registry, manifests, files } = performanceFixture();
		expect(qualifyBenchmarks(registry, manifests, files)).toEqual([]);
		files.delete('bench/example.bench.ts');
		expect(qualifyBenchmarks(registry, manifests, files).length).toBeGreaterThan(0);
	});

	it('rejects a manifested package without a performance selection', () => {
		const { registry, manifests, files } = performanceFixture();
		expect(qualifyBenchmarks(registry, manifests, files)).toEqual([]);
		expect(
			qualifyBenchmarks(registry, [...manifests, { name: '@example/new', file: 'packages/new/deno.jsonc' }], files)
				.length,
		).toBeGreaterThan(0);
	});

	it('rejects an empty benchmark comparison while its program still exists', () => {
		const { registry, manifests, files } = performanceFixture();
		expect(qualifyBenchmarks(registry, manifests, files)).toEqual([]);
		registry.packages['@example/value'][0]!.comparison = '';
		expect(qualifyBenchmarks(registry, manifests, files).length).toBeGreaterThan(0);
	});

	it('rejects absent emitted semantic evidence separately from valid export imports', () => {
		const { document, manifests, files } = fixture();
		const original = document.packages[0]!;
		const selected = {
			...document,
			packages: [{
				...original,
				runtime: {
					...original.runtime,
					emittedNode: {
						...original.runtime.emittedNode,
						semantic: { files: ['packages/example/mod.test.ts'], proves: 'Owned cleanup survives packed imports.' },
					},
				},
			}],
		};
		expect(qualify(selected, manifests, files)).toEqual([]);
		selected.packages[0]!.runtime.emittedNode.semantic.files = ['tests/absent.test.ts'];
		expect(qualify(selected, manifests, files).length).toBeGreaterThan(0);
	});

	it('rejects a newly discovered package without a qualification owner', () => {
		const { document, manifests, files } = fixture();
		expect(qualify(document, manifests, files)).toEqual([]);
		expect(qualify(document, [...manifests, { name: '@example/new', file: 'packages/new/deno.jsonc' }], files).length)
			.toBeGreaterThan(0);
	});

	it('rejects a new test without a review, then accepts its explicit review', () => {
		const { document, manifests, files } = fixture();
		expect(qualify(document, manifests, files)).toEqual([]);
		const file = 'packages/example/new.test.ts';
		files.add(file);
		expect(qualify(document, manifests, files).length).toBeGreaterThan(0);
		document.testReview.push({
			file,
			disposition: 'retain',
			protects: 'An independent new consumer protects owned release.',
		});
		expect(qualify(document, manifests, files)).toEqual([]);
	});

	it('rejects escaping evidence even when the claimed file is present and focused evidence remains', () => {
		const { document, manifests, files } = fixture();
		expect(qualify(document, manifests, files)).toEqual([]);
		const escaped = 'packages/example/../outside.ts';
		files.add(escaped);
		document.packages[0]!.behavior.files.push(escaped);
		expect(qualify(document, manifests, files).length).toBeGreaterThan(0);
	});

	it('rejects unrelated behavior evidence even when the selected file exists', () => {
		const { document, manifests, files } = fixture();
		expect(qualify(document, manifests, files)).toEqual([]);
		const unrelated = 'packages/other/check.ts';
		files.add(unrelated);
		document.packages[0]!.behavior.files = [unrelated];
		expect(qualify(document, manifests, files).length).toBeGreaterThan(0);
	});

	it('rejects a removed evidence file while its inventory still has an owner', () => {
		const { document, manifests, files } = fixture();
		expect(qualify(document, manifests, files)).toEqual([]);
		files.delete('packages/example/mod.test.ts');
		expect(qualify(document, manifests, files).length).toBeGreaterThan(0);
	});

	it('rejects a missing emitted checker independently of valid source behavior', () => {
		const { document, manifests, files } = fixture();
		expect(qualify(document, manifests, files)).toEqual([]);
		files.delete('tools/consumer.mjs');
		expect(qualify(document, manifests, files).length).toBeGreaterThan(0);
	});

	it('rejects a vague property while the invariant and runtime selections remain valid', () => {
		const { document, manifests, files } = fixture();
		expect(qualify(document, manifests, files)).toEqual([]);
		document.packages[0]!.behavior.properties = ['tested'];
		expect(qualify(document, manifests, files).length).toBeGreaterThan(0);
	});

	it('rejects absent performance selection while package identity and behavioral evidence remain valid', () => {
		const { document, manifests, files } = fixture();
		expect(qualify(document, manifests, files)).toEqual([]);
		document.packages[0]!.benchmark.programs = [];
		expect(qualify(document, manifests, files).length).toBeGreaterThan(0);
	});

	it('rejects duplicated package ownership independently of all record contents', () => {
		const { document, manifests, files } = fixture();
		expect(qualify(document, manifests, files)).toEqual([]);
		document.packages.push(document.packages[0]!);
		expect(qualify(document, manifests, files).length).toBeGreaterThan(0);
	});
});

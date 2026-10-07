/** Profile validated HTTP operations with setup and warmup outside the external inspector gate. @module */
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import { deepStrictEqual } from 'node:assert';
import process, { cpuUsage } from 'node:process';
import { Readable } from 'node:stream';
import { do_not_optimize } from 'mitata';
import { cases, gatewayCases, observe, request, routingCases } from '../tests/fixtures/http-parity/corpus.ts';
import type { CaseType, ParityApiType } from '../tests/fixtures/http-parity/corpus.ts';
import { createHonoApi, createHonoGateway, createHonoRouting } from '../tests/fixtures/http-parity/hono.ts';
import { createUtilsApi, createUtilsGateway, createUtilsRouting } from '../tests/fixtures/http-parity/utils.ts';
import { vectors } from '../tests/fixtures/hono-proxy/corpus.ts';
import type { ProxyExpectation } from '../tests/fixtures/hono-proxy/corpus.ts';
import { createHonoProxy, createUtilsProxy } from '../tests/fixtures/hono-proxy/implementations.ts';
import { createUpstream } from '../tests/fixtures/hono-proxy/upstream.ts';
import { routerCases } from '../tests/fixtures/hono-contracts/routes.ts';
import { requestCases } from '../tests/fixtures/hono-contracts/requests.ts';
import { responseCases } from '../tests/fixtures/hono-contracts/responses.ts';
import { applicationCases } from '../tests/fixtures/hono-contracts/applications.ts';
import * as upstream from '../tests/fixtures/hono-contracts/hono.ts';
import * as direct from '../tests/fixtures/hono-contracts/utils.ts';
import { observe as observeContract } from '../tests/fixtures/hono-contracts/types.ts';
import { profileServiceCases } from './fixtures/service-profile.ts';
import { httpProfileCases } from './fixtures/http-profile.ts';
import { challengerCandidates, httpChallengerCases } from './fixtures/http-challengers.ts';

/** Only the diagnostic IO changes by host; both runtimes load the same utility and Hono fixture implementations. */
const args = typeof Deno === 'undefined' ? process.argv.slice(2) : Deno.args;
const bun = (globalThis as { readonly Bun?: { readonly version: string } }).Bun;
const runtime = typeof Deno !== 'undefined'
	? Deno.version
	: bun !== undefined
	? { bun: bun.version }
	: { node: process.versions.node, v8: process.versions.v8 };
/**
 * Keep optional memory telemetry from aborting a native CPU capture.
 * Bun's Linux memoryUsage syscall can receive EINTR from the profiler signal.
 * Record that specific interruption explicitly; other telemetry errors still fail.
 */
const memory = () => {
	try {
		return typeof Deno === 'undefined' ? process.memoryUsage() : Deno.memoryUsage();
	} catch (error) {
		if (bun !== undefined && error instanceof Error && 'errno' in error && error.errno === 4) {
			return { unavailable: 'Bun memoryUsage interrupted by profiler signal (EINTR).' };
		}
		throw error;
	}
};

/** Native Node stdin emits byte Buffers unless an encoding is set; this adapter keeps the existing Web-stream gate. */
function input(): ReadableStream<BufferSource> {
	return typeof Deno === 'undefined'
		? Readable.toWeb(process.stdin) as ReadableStream<BufferSource>
		: Deno.stdin.readable;
}

interface Operation {
	readonly run: () => Promise<unknown>;
	readonly close: () => Promise<void>;
	readonly expected: unknown;
	readonly units: number;
}
interface Workload {
	readonly id: string;
	readonly scope: string;
	readonly candidates?: readonly ('utils' | 'hono')[];
	readonly open: (candidate: 'utils' | 'hono') => Operation;
}
const workloads: Workload[] = [];
const challengers = httpChallengerCases();
/** The same literal projection and fully consumed body qualify both sides before sampling. */
function api(
	id: string,
	values: readonly CaseType[],
	factory: (candidate: 'utils' | 'hono') => ParityApiType,
	origin?: string,
): void {
	workloads.push({
		id,
		scope: 'Warm dispatch, fresh requests, complete response observations; construction and close excluded.',
		open(candidate) {
			const app = factory(candidate);
			return {
				async run() {
					const output: unknown[] = [];
					for (const value of values) output.push(await observe(await app.fetch(request(value, origin)), value));
					return output;
				},
				close: () => app.close(),
				expected: values.map((value) => value.expected),
				units: values.length,
			};
		},
	});
}
api('api', cases, (candidate) => candidate === 'utils' ? createUtilsApi() : createHonoApi());
for (const value of cases) {
	api(`api-${value.id}`, [value], (candidate) => candidate === 'utils' ? createUtilsApi() : createHonoApi());
}
api(
	'gateway',
	gatewayCases,
	(candidate) => candidate === 'utils' ? createUtilsGateway() : createHonoGateway(),
	'https://gateway.invalid',
);
for (const count of [16, 256, 4096]) {
	const values = routingCases(count);
	const factory = (candidate: 'utils' | 'hono') =>
		candidate === 'utils' ? createUtilsRouting(count) : createHonoRouting(count);
	api(`routes-${count}`, values, factory);
	for (const value of values) api(`routes-${count}-${value.id}`, [value], factory);
}
for (const vector of vectors) {
	workloads.push({
		id: `proxy-${vector.id}`,
		scope: `Pinned Hono proxy observation; candidate-specific policy expectations. ${
			vector.difference ?? 'Shared projection.'
		}`,
		open(candidate) {
			const transport = createUpstream();
			const app = candidate === 'hono'
				? createHonoProxy(vector.mode, transport.fetch)
				: createUtilsProxy(vector.mode, transport.fetch);
			const expected = vector[candidate];
			return {
				async run() {
					transport.requests.length = 0;
					const result = await app.fetch(
						new Request(`https://gateway.invalid${vector.path}`, {
							method: vector.method ?? 'GET',
							headers: vector.headers,
							body: vector.body,
						}),
					);
					const body = await result.text();
					const received = transport.requests[0];
					const observation: ProxyExpectation = {
						status: result.status,
						...(expected.body === undefined ? {} : { body }),
						...(expected.headers === undefined ? {} : {
							headers: Object.fromEntries(
								Object.keys(expected.headers).map((name) => [name, result.headers.get(name)]),
							),
						}),
						request: expected.request === null ? null : {
							url: received?.url ?? '',
							...(expected.request.headers === undefined ? {} : {
								headers: Object.fromEntries(
									Object.keys(expected.request.headers).map((name) => [name, received?.headers.get(name) ?? null]),
								),
							}),
						},
					};
					return { observation, calls: transport.requests.length };
				},
				close: async () => {
					transport.requests.length = 0;
				},
				expected: { observation: expected, calls: expected.request === null ? 0 : 1 },
				units: 1,
			};
		},
	});
}
// These families retain every translated upstream vector. Router construction
// and response Context creation belong to these contract operations, unlike warm dispatch.
workloads.push({
	id: 'upstream-router',
	scope: 'All router contract vectors, including registration and explicit owner differences.',
	open(candidate) {
		return {
			run: async () =>
				routerCases.map((value) => candidate === 'hono' ? upstream.matchHono(value) : direct.matchUtils(value)),
			expected: routerCases.map((value) =>
				candidate === 'hono' ? value.expected : value.utilsExpected ?? value.expected
			),
			units: routerCases.length,
			close: async () => {},
		};
	},
}, {
	id: 'upstream-request',
	scope: 'All request contract vectors; cache/clone/form differences retained.',
	open(candidate) {
		return {
			async run() {
				const values: unknown[] = [];
				for (const value of requestCases) {
					values.push(await (candidate === 'hono' ? upstream.readHono(value) : direct.readUtils(value)));
				}
				return values;
			},
			expected: requestCases.map((value) =>
				candidate === 'hono' ? value.expected : value.utilsExpected ?? value.expected
			),
			units: requestCases.length,
			close: async () => {},
		};
	},
}, {
	id: 'upstream-response',
	scope: 'All response contract vectors with consumed bodies and cookie observations.',
	open(candidate) {
		return {
			async run() {
				const values: unknown[] = [];
				for (const value of responseCases) {
					values.push(
						await observeContract(
							await (candidate === 'hono' ? upstream.respondHono(value) : direct.respondUtils(value)),
							value.expected,
						),
					);
				}
				return values;
			},
			expected: responseCases.map((value) => value.expected),
			units: responseCases.length,
			close: async () => {},
		};
	},
});

for (const value of httpProfileCases()) workloads.push(value);
for (const value of profileServiceCases()) {
	workloads.push({
		id: value.id,
		scope: value.scope,
		candidates: ['utils'],
		open() {
			return { ...value.open(), expected: value.expected, units: 1 };
		},
	});
}
workloads.push({
	id: 'upstream-application',
	scope: 'All application vectors, warm apps; declared response/capability differences retained.',
	open(candidate) {
		const apps = applicationCases.map((value) =>
			candidate === 'hono' ? upstream.createHono(value.application) : direct.createUtils(value.application)
		);
		return {
			async run() {
				const values: unknown[] = [];
				for (const [index, value] of applicationCases.entries()) {
					const expected = candidate === 'hono' ? value.expected : value.utilsExpected ?? value.expected;
					values.push(
						await observeContract(
							await apps[index]!.fetch(
								new Request(new URL(value.path, 'http://localhost'), { method: value.method, headers: value.headers }),
							),
							expected,
						),
					);
				}
				return values;
			},
			expected: applicationCases.map((value) =>
				candidate === 'hono' ? value.expected : value.utilsExpected ?? value.expected
			),
			units: applicationCases.length,
			close: async () => {},
		};
	},
});

if (args.includes('--list')) {
	console.log(
		JSON.stringify(
			[
				...workloads.map(({ id, scope, candidates }) => ({ id, scope, candidates: candidates ?? ['utils', 'hono'] })),
				...challengers.map(({ id, scope, candidates }) => ({ id, scope, candidates })),
			],
		),
	);
} else {
	const [id, candidate] = args;
	if (!challengerCandidates.some((value) => value === candidate)) {
		throw new TypeError('Select a registered HTTP candidate.');
	}
	const workload = workloads.find((value) => value.id === id);
	const challenger = challengers.find((value) => value.id === id);
	if (!workload && !challenger) throw new TypeError('Unknown HTTP profile workload.');
	let operation: Operation;
	if (challenger !== undefined) {
		if (candidate !== 'utils' && candidate !== 'hono' && candidate !== 'elysia' && candidate !== 'vixeny') {
			throw new TypeError('Unknown challenger.');
		}
		operation = await challenger.open(candidate);
	} else {
		if (candidate !== 'utils' && candidate !== 'hono') {
			throw new TypeError('This HTTP profile workload does not support the selected candidate.');
		}
		if (workload!.candidates !== undefined && !workload!.candidates.includes(candidate)) {
			throw new TypeError('This HTTP profile workload does not support the selected candidate.');
		}
		operation = workload!.open(candidate);
	}
	const reader = input().pipeThrough(new TextDecoderStream()).getReader();
	/** Controller writes one complete newline-terminated gate at a time. Reject partial or unexpected commands. */
	const gate = async (expected: string): Promise<void> => {
		let input = '';
		while (!input.endsWith('\n')) {
			const next = await reader.read();
			if (next.done) throw new Error('Profile controller disconnected.');
			input += next.value;
		}
		if (input.trim() !== expected) throw new Error('Unexpected profile gate.');
	};
	try {
		deepStrictEqual(await operation.run(), operation.expected);
		for (let n = 0; n < Math.max(10, Math.ceil(1000 / operation.units)); n++) do_not_optimize(await operation.run());
		console.log(
			JSON.stringify({
				phase: 'ready',
				id,
				candidate,
				scope: challenger?.scope ?? workload!.scope,
				units: operation.units,
				runtime,
			}),
		);
		await gate('start');
		const start = performance.now(), cpu = cpuUsage(), before = memory();
		let batches = 0;
		const milliseconds = Number(args[2] ?? 400);
		if (!Number.isFinite(milliseconds) || milliseconds < 1) throw new TypeError('Invalid profile duration.');
		do {
			do_not_optimize(await operation.run());
			batches++;
		} while (performance.now() - start < milliseconds);
		console.log(
			JSON.stringify({
				phase: 'done',
				batches,
				units: batches * operation.units,
				elapsedMs: performance.now() - start,
				cpu: cpuUsage(cpu),
				before,
				after: memory(),
			}),
		);
		await gate('stop');
	} finally {
		try {
			await reader.cancel();
		} finally {
			// Closing the application is unconditional even if diagnostic stdin cleanup rejects.
			await operation.close();
		}
	}
}

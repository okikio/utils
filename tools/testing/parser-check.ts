/** Reproducible isolated checks of a pinned local STD checkout. No production dependency is changed. @module */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [checkoutArgument, outputArgument] = Deno.args;
if (checkoutArgument === undefined || outputArgument === undefined) {
	throw new TypeError('Usage: parser-check.ts <STD checkout> <new evidence directory>');
}
const checkout = resolve(checkoutArgument);
const output = resolve(outputArgument);
await Deno.mkdir(output, { recursive: false });
const decoder = new TextDecoder();
const revision = await new Deno.Command('git', { args: ['-C', checkout, 'rev-parse', 'HEAD'], stdout: 'piped' })
	.output();
if (!revision.success) throw new Error('Cannot identify STD checkout.');
const sourcePaths = [
	'dotenv/parse.ts',
	'dotenv/deno.json',
	'http/unstable_formdata_decoder_stream.ts',
	'http/deno.json',
	'streams/unstable_capped_delimiter_stream.ts',
	'streams/unstable_to_byte_stream.ts',
	'streams/_types.ts',
];
const hashes: Record<string, string> = {};
for (const path of sourcePaths) {
	hashes[path] = Array.from(
		new Uint8Array(await crypto.subtle.digest('SHA-256', await Deno.readFile(checkout + '/' + path))),
		(byte) => byte.toString(16).padStart(2, '0'),
	).join('');
}
const mapPath = output + '/imports.json';
await Deno.writeTextFile(
	mapPath,
	JSON.stringify({
		imports: {
			'@std/streams/unstable-capped-delimiter-stream':
				pathToFileURL(checkout + '/streams/unstable_capped_delimiter_stream.ts').href,
		},
	}),
);
const probe = new URL('./fixtures/parser-probe.ts', import.meta.url).href;
const scenarios = [
	'dotenv-basic',
	'dotenv-missing',
	'dotenv-ambient',
	'dotenv-cycle',
	'dotenv-large',
	'multipart-splits',
	'multipart-lowercase',
	'multipart-quoted',
	'multipart-prefix',
	'multipart-truncated',
	'multipart-large',
	'multipart-abandon',
	'multipart-cancel',
];
const runs: {
	runtime: string;
	scenario: string;
	timedOut: boolean;
	exitCode: number;
	observation: unknown;
	stderrBytes: number;
}[] = [];

/** A bounded watchdog kills and joins synchronous parser loops as well as blocked stream protocols. */
async function trial(runtime: 'deno' | 'node' | 'bun', scenario: string, candidate: string): Promise<void> {
	const permission = [
		'--allow-read=' + checkout,
		...(scenario === 'dotenv-ambient' ? ['--allow-env=UTILS_TEST_SECRET'] : []),
	];
	const args = runtime === 'deno'
		? [
			'run',
			'--no-check',
			'--no-config',
			'--no-prompt',
			'--no-lock',
			'--import-map=' + mapPath,
			...permission,
			probe,
			candidate,
			scenario,
		]
		: [new URL('./fixtures/parser-probe.ts', import.meta.url).pathname, candidate, scenario];
	const executable = runtime === 'deno' ? Deno.execPath() : runtime;
	const child = new Deno.Command(executable, {
		args,
		clearEnv: true,
		env: { PATH: Deno.env.get('PATH') ?? '', UTILS_TEST_SECRET: 'host-secret' },
		stdout: 'piped',
		stderr: 'piped',
	}).spawn();
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		try {
			child.kill('SIGKILL');
		} catch { /* Completion won the watchdog race. */ }
	}, 4000);
	let result: Deno.CommandOutput;
	try {
		result = await child.output();
	} finally {
		clearTimeout(timer);
	}
	const stdout = decoder.decode(result.stdout).trim();
	let observation: unknown;
	try {
		observation = stdout === '' ? null : JSON.parse(stdout);
	} catch {
		observation = { status: 'invalid-probe-output' };
	}
	// Do not copy third-party stack traces or parsed secret values into durable reports.
	runs.push({ runtime, scenario, timedOut, exitCode: result.code, observation, stderrBytes: result.stderr.byteLength });
}
for (const scenario of scenarios) {
	const path = scenario.startsWith('dotenv') ? '/dotenv/parse.ts' : '/http/unstable_formdata_decoder_stream.ts';
	await trial('deno', scenario, pathToFileURL(checkout + path).href);
}
for (const runtime of ['node', 'bun'] as const) {
	for (const scenario of ['dotenv-basic', 'dotenv-missing']) {
		await trial(runtime, scenario, pathToFileURL(checkout + '/dotenv/parse.ts').href);
	}
}
const report = {
	revision: decoder.decode(revision.stdout).trim(),
	sources: hashes,
	runtime: Deno.version,
	watchdogMilliseconds: 4000,
	interpretation:
		'Observed parser results, not a conformance certification or performance comparison. Missing limits cannot be established by a finite successful fixture alone; inspect the pinned public constructor and source.',
	runs,
};
await Deno.writeTextFile(output + '/test.json', JSON.stringify(report, null, 2) + '\n');
for (const scenario of ['dotenv-basic', 'multipart-splits']) {
	const run = runs.find((run) => run.runtime === 'deno' && run.scenario === scenario);
	if (
		run === undefined || run.exitCode !== 0 || run.observation === null || typeof run.observation !== 'object' ||
		!('status' in run.observation) || run.observation.status !== 'returned'
	) {
		throw new Error(
			'Candidate baseline did not execute; inspect the parser test setup before drawing conclusions.',
		);
	}
}
console.log(`Recorded ${runs.length} isolated parser observations in ${output}.`);

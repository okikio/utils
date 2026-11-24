/**
 * Run every case through every client against every server, pooler and proxy, and compare each outcome with the known
 * limits in `expectations.ts`.
 *
 * Targets start one at a time in Docker and stop before the next starts. `INTEROP_TARGETS` and `INTEROP_CLIENTS` select
 * a comma-separated subset by name. The report goes to `.tmp/tests/interop/`.
 *
 * @module
 */
import { after, describe, it } from 'node:test';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { type OutcomeType, runCases } from './cases/mod.ts';
import { reaches } from './cells.ts';
import { clients, type ClientType } from './clients/mod.ts';
import { limitFor } from './expectations.ts';
import { type StartedType, targets, type TargetType } from './targets/mod.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));

/** Select by a comma-separated list of names, rejecting unknown names so a typo cannot skip coverage. */
function pick<T extends { readonly name: string }>(
	all: readonly T[],
	selection: string | undefined,
): readonly T[] {
	if (!selection?.trim()) return all;
	const names = selection.split(',').map((name) => name.trim()).filter(Boolean);
	const unknown = names.filter((name) => !all.some((item) => item.name === name));
	if (unknown.length) {
		throw new TypeError(`Unknown interop selection: ${unknown.join(', ')}.`);
	}
	return all.filter((item) => names.includes(item.name));
}

const selectedTargets = pick(targets, process.env.INTEROP_TARGETS);
/**
 * How many clients run against one target at once. Each client has its own schema; timing cases such as cancellation
 * measure their own statement, so running clients side by side changes no outcome, only how busy the server is.
 */
const concurrency = Math.max(1, Number(process.env.INTEROP_CONCURRENCY ?? 1));
const selectedClients = pick(clients, process.env.INTEROP_CLIENTS);

/** Every result, for the report. */
interface RecordType {
	readonly target: string;
	readonly version: string;
	readonly client: string;
	readonly outcomes: readonly (OutcomeType & {
		readonly limit?: string;
		readonly mismatch?: string;
	})[];
}
const records: RecordType[] = [];

/** Run the cases in a Bun or Deno child process and read its outcomes. */
function child(
	client: ClientType,
	url: string,
	schema: string,
	flavor: string,
): Promise<OutcomeType[]> {
	const command = client.runtime === 'bun' ? [process.env.UTILS_BUN ?? 'bun', 'tests/interop/runtime.ts'] : [
		process.env.DENO_BIN ?? 'deno',
		'run',
		'-A',
		'--no-lock',
		'tests/interop/runtime.ts',
	];
	return new Promise((resolve, reject) => {
		const process_ = spawn(command[0]!, [
			...command.slice(1),
			client.name,
			url,
			schema,
			flavor,
		], { cwd: root });
		let output = '';
		let errors = '';
		process_.stdout.on('data', (chunk: Buffer) => output += chunk);
		process_.stderr.on('data', (chunk: Buffer) => errors += chunk);
		process_.once('error', reject);
		process_.once('close', (code) => {
			const line = output.split('\n').find((item) => item.startsWith('interop-outcomes '));
			if (line) {
				resolve(
					JSON.parse(line.slice('interop-outcomes '.length)) as OutcomeType[],
				);
			} else {reject(
					new Error(
						`${client.runtime} exited with ${code}: ${errors.trim().split('\n').slice(-5).join(' | ')}`,
					),
				);}
		});
	});
}

/** Run every case through one client. A client that stops before reporting becomes one `client run` failure. */
async function outcomes(
	client: ClientType,
	target: TargetType,
	started: StartedType,
	schema: string,
): Promise<OutcomeType[]> {
	const flavor = target.flavor ?? 'postgres';
	try {
		if (client.runtime !== 'node') {
			return await child(client, started.url!, schema, flavor);
		}
		const opened = await client.open!({ ...started, flavor: target.flavor });
		try {
			return await runCases(opened.db, schema, { flavor });
		} finally {
			await opened.close();
		}
	} catch (error) {
		const detail = String((error as Error).message).split('\n')[0]!.slice(
			0,
			400,
		);
		return [{ case: 'client run', status: 'fail', detail, ms: 0 }];
	}
}

for (const target of selectedTargets) {
	const users = selectedClients.filter((client) => reaches(client, target));
	if (users.length === 0) continue;
	describe(target.name, { concurrency, timeout: 3_600_000 }, () => {
		let started: Promise<StartedType> | undefined;
		const start = () => started ??= target.start();
		after(async () => {
			if (started) await (await started).stop();
		});
		for (const client of users) {
			it(client.name, { timeout: 900_000 }, async () => {
				const server = await start();
				const schema = `interop_${client.name.replaceAll('-', '_')}`;
				const found: OutcomeType[] = await outcomes(
					client,
					target,
					server,
					schema,
				);
				const mismatches: string[] = [];
				const checked = found.map((outcome) => {
					if (outcome.status === 'blocked') return outcome;
					const limit = limitFor(target.name, client.name, outcome.case);
					if (outcome.status === 'fail' && !limit) {
						const mismatch = `fails: ${outcome.case}: ${outcome.detail}`;
						mismatches.push(mismatch);
						return { ...outcome, mismatch };
					}
					if (outcome.status === 'pass' && limit && limit.cases !== 'any' && !limit.sometimes) {
						const mismatch = `passes despite a known limit, so remove it: ${outcome.case} (${limit.reason})`;
						mismatches.push(mismatch);
						return { ...outcome, limit: limit.reason, mismatch };
					}
					return limit ? { ...outcome, limit: limit.reason } : outcome;
				});
				records.push({
					target: target.name,
					version: server.version,
					client: client.name,
					outcomes: checked,
				});
				if (mismatches.length) {
					throw new Error(
						`${target.name} × ${client.name}\n${mismatches.join('\n')}`,
					);
				}
			});
		}
	});
}

/** A Markdown table per target: each client's passes, known limits, blocked cases and mismatches. */
function report(): string {
	const lines = ['# PostgreSQL interoperability', ''];
	for (const target of selectedTargets) {
		const rows = records.filter((record) => record.target === target.name);
		if (!rows.length) continue;
		lines.push(
			`## ${target.name}`,
			'',
			`${target.about} Version: ${rows[0]!.version}.`,
			'',
		);
		lines.push(
			'| Client | Pass | Known limits | Blocked | Mismatches |',
			'| --- | --- | --- | --- | --- |',
		);
		for (const row of rows) {
			const count = (test: (item: RecordType['outcomes'][number]) => boolean) => row.outcomes.filter(test).length;
			lines.push(
				`| ${row.client} | ${count((o) => o.status === 'pass' && !o.mismatch)} | ${
					count((o) => o.status === 'fail' && !!o.limit)
				} | ${count((o) => o.status === 'blocked')} | ${count((o) => !!o.mismatch)} |`,
			);
		}
		const notes = new Map<string, Set<string>>();
		for (const row of rows) {
			for (const outcome of row.outcomes) {
				const note = outcome.mismatch ??
					(outcome.limit && `${outcome.case}: ${outcome.limit}`);
				if (note) {
					notes.set(note, (notes.get(note) ?? new Set()).add(row.client));
				}
			}
		}
		if (notes.size) {
			lines.push('');
			for (const [note, who] of notes) {
				lines.push(`- ${note} (${[...who].join(', ')})`);
			}
		}
		lines.push('');
	}
	return lines.join('\n');
}

after(async () => {
	const directory = new URL('../../.tmp/tests/interop/', import.meta.url);
	await mkdir(directory, { recursive: true });
	await writeFile(
		new URL('results.json', directory),
		`${JSON.stringify(records, null, '\t')}\n`,
	);
	await writeFile(new URL('report.md', directory), report());
});

/** Retain subprocess evidence for npm builds and installed consumers. @module */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { SourceType } from './source.ts';

/** Run one bounded checks command and preserve complete subprocess diagnostics on failure. */
export function command(
	workspace: Pick<SourceType, 'root' | 'output'>,
	binary: string,
	args: string[],
	cwd = workspace.root,
	capture = false,
): string {
	const { output } = workspace;

	const result = spawnSync(binary, args, {
		cwd,
		encoding: 'utf8',
		stdio: 'pipe',
		timeout: 300_000,
		maxBuffer: 32 * 1024 * 1024,
	});
	// Keep complete native diagnostics even when a compiler or install fails before
	// its normal report exists. Commands own no credentials in argv or environment logs.
	const commands = resolve(output, 'commands');
	mkdirSync(commands, { recursive: true });
	const evidence = mkdtempSync(resolve(commands, `${Date.now()}-`));
	writeFileSync(resolve(evidence, 'stdout.log'), result.stdout ?? '');
	writeFileSync(resolve(evidence, 'stderr.log'), result.stderr ?? '');
	writeFileSync(
		resolve(evidence, 'result.json'),
		JSON.stringify(
			{
				binary,
				args,
				cwd,
				status: result.status,
				signal: result.signal,
				error: result.error?.message,
			},
			null,
			2,
		) + '\n',
	);
	if (!capture) {
		process.stdout.write(result.stdout ?? '');
		process.stderr.write(result.stderr ?? '');
	}
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error(
			`${binary} ${args.join(' ')} failed (${result.status}).\n${result.stdout ?? ''}\n${result.stderr ?? ''}`,
		);
	}
	return result.stdout ?? '';
}

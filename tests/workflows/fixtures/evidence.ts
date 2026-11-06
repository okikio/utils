/** Retain fresh receipts for each fault-injection run; never replace earlier local evidence. @module */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';

/** Allocate repository-local build scratch. The owning test must remove it after joining its containers. */
export async function scratch(prefix: string): Promise<string> {
	const root = new URL('../../../.tmp/tests/containers/', import.meta.url);
	await mkdir(root, { recursive: true });
	return await mkdtemp(fileURLToPath(new URL(prefix, root)));
}

/** A unique run directory is also the ownership record for logs and measurements. */
export async function evidence(name: string) {
	const directory = resolve('.tmp/tests/recovery', `${name}-${Date.now()}-${crypto.randomUUID()}`);
	await mkdir(directory, { recursive: true });
	console.log(`Test evidence: ${directory}`);
	return {
		directory,
		async save(name: string, value: unknown): Promise<void> {
			await writeFile(
				resolve(directory, name),
				typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n',
			);
		},
	};
}

/** Bound each observation and retain the last error rather than silently retrying forever. */
export async function until(read: () => Promise<boolean>, condition: string, milliseconds = 15000): Promise<void> {
	const deadline = Date.now() + milliseconds;
	let last: unknown;
	while (Date.now() < deadline) {
		try {
			if (await read()) return;
		} catch (error) {
			last = error;
		}
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error(`Test observation timed out: ${condition}`, { cause: last });
}

/** Own one Deno host. Teardown joins process death and keeps diagnostics even when the test fails. */
export async function host(receipt: Awaited<ReturnType<typeof evidence>>, bind = '127.0.0.1') {
	const started = performance.now();
	const child: ChildProcess = spawn(process.env.DENO_BIN ?? 'deno', [
		'run',
		'--frozen',
		'--allow-read',
		'--allow-env',
		'--allow-net',
		'tests/workflows/scenarios/streaming-load.ts',
	], { env: { ...process.env, STREAM_BIND: bind }, stdio: ['ignore', 'pipe', 'pipe'] });
	let diagnostics = '', output = '';
	child.stderr!.on('data', (chunk) => {
		diagnostics = (diagnostics + String(chunk)).slice(-65536);
	});
	try {
		const port = await new Promise<number>((resolve, reject) => {
			// Include Deno graph loading under host contention; this bounds fixture assembly, not HTTP service latency.
			const timer = setTimeout(() => reject(new Error(`Load host startup timed out: ${diagnostics}`)), 30000);
			child.once('error', (error) => {
				clearTimeout(timer);
				reject(error);
			});
			child.once('exit', () => {
				clearTimeout(timer);
				reject(new Error(`Load host exited: ${diagnostics}`));
			});
			child.stdout!.on('data', (chunk) => {
				output += String(chunk);
				if (!output.includes('\n')) return;
				try {
					const value = JSON.parse(output.split('\n')[0]!);
					clearTimeout(timer);
					resolve(value.port);
				} catch (error) {
					clearTimeout(timer);
					reject(error);
				}
			});
		});
		await receipt.save('startup.json', { elapsedMs: performance.now() - started, port });
		return { port, origin: `http://127.0.0.1:${port}`, [Symbol.asyncDispose]: stop };
	} catch (error) {
		await stop();
		throw error;
	}
	async function stop(): Promise<void> {
		if (child.exitCode === null && child.signalCode === null) {
			const ended = once(child, 'exit');
			child.kill('SIGKILL');
			await ended;
		}
		await receipt.save('host.log', diagnostics);
	}
}

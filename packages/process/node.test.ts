import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import nodeProcess from 'node:process';

import type { Context } from '@okikio/context';
import * as process from './mod.ts';
import * as node from './node.ts';

const decoder = new TextDecoder();
const adapter = node.create();
const isNode = !('Deno' in globalThis) && nodeProcess.release.name === 'node';

function ctx(signal = new AbortController().signal): Context {
	return { signal, deadline: undefined } as unknown as Context;
}

describe('Node process adapter', { skip: !isNode }, () => {
	it('captures stdout and stderr from a real Node child', async () => {
		const exit = await process.exec(ctx(), adapter, {
			command: nodeProcess.execPath,
			arguments: ['-e', 'console.log("output"); console.error("diagnostic")'],
			stdout: { type: 'capture', maximumBytes: 1024 },
			stderr: { type: 'capture', maximumBytes: 1024 },
		});
		expect(exit.success).toBe(true);
		expect(decoder.decode(exit.stdout)).toBe('output\n');
		expect(decoder.decode(exit.stderr)).toBe('diagnostic\n');
	});

	it('exposes piped stdout as Uint8Array Web Stream chunks', async () => {
		const child = await process.start(ctx(), adapter, {
			command: nodeProcess.execPath,
			arguments: ['-e', 'process.stdout.write(Buffer.from([1, 2, 3, 255]))'],
			stdout: { type: 'stream' },
			stderr: { type: 'discard' },
		});
		const reader = child.stdout!.getReader();
		try {
			const first = await reader.read();
			expect(first.done).toBe(false);
			expect(first.value).toBeInstanceOf(Uint8Array);
			expect([...first.value!]).toEqual([1, 2, 3, 255]);
		} finally {
			reader.releaseLock();
		}
		expect((await child.wait()).success).toBe(true);
	});

	it('streams input into a real Node child', async () => {
		const exit = await process.exec(ctx(), adapter, {
			command: nodeProcess.execPath,
			arguments: ['-e', 'process.stdin.on("data", x => process.stdout.write(x.toString().toUpperCase()))'],
			stdin: 'piped',
			input: 'hello',
			stdout: { type: 'capture', maximumBytes: 1024 },
			stderr: { type: 'discard' },
		});
		expect(decoder.decode(exit.stdout)).toBe('HELLO');
	});

	it('stops a real child and keeps repeated stop calls idempotent', async () => {
		const child = await process.start(ctx(), adapter, {
			command: nodeProcess.execPath,
			arguments: ['-e', 'setInterval(() => {}, 1000)'],
			stdout: { type: 'discard' },
			stderr: { type: 'discard' },
			shutdown: { graceMs: 100, forceMs: 1_000 },
		});
		await Promise.all([child.stop('test'), child.stop('test')]);
		expect((await child.wait()).success).toBe(false);
	});

	it('owns a detached POSIX process group instead of leaving descendants behind', async () => {
		if (nodeProcess.platform === 'win32') return;
		const child = await process.start(ctx(), adapter, {
			command: nodeProcess.execPath,
			arguments: [
				'-e',
				`const { spawn } = require('node:child_process');
const nested = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
process.stdout.write(String(nested.pid) + '\\n');
setInterval(() => {}, 1000);`,
			],
			tree: 'posix-process-group',
			stdout: { type: 'stream' },
			stderr: { type: 'discard' },
			shutdown: { graceMs: 500, forceMs: 1_000 },
		});
		expect(child.tree).toBe('posix-process-group');
		const descendant = Number(await firstLine(child.stdout!));
		expect(Number.isSafeInteger(descendant)).toBe(true);
		await child.stop('tree test');
		await child.wait();
		await expectGone(descendant);
	});

	it('reports spawn failure without returning a partially owned handle', async () => {
		await expect(process.start(ctx(), adapter, { command: '__utility_command_that_does_not_exist__' })).rejects.toThrow();
	});
});


/** Read one UTF-8 line from a process stream without collecting later output. */
async function firstLine(stream: ReadableStream<Uint8Array>): Promise<string> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let text = '';
	try {
		while (!text.includes('\n')) {
			const next = await reader.read();
			if (next.done) break;
			text += decoder.decode(next.value, { stream: true });
		}
		return text.split('\n', 1)[0]!.trim();
	} finally {
		reader.releaseLock();
	}
}

/** Wait briefly for the operating system to reap a process killed through its group. */
async function expectGone(pid: number): Promise<void> {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		try {
			nodeProcess.kill(pid, 0);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ESRCH') return;
			throw error;
		}
		// qualification-allow-timing: the descendant is not a Node ChildProcess handle, so the OS process table is the observable boundary.
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error(`Descendant process ${pid} remained alive after process-group shutdown.`);
}

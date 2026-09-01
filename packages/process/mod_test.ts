import { expect } from '@std/expect';
import { describe, it } from 'node:test';

import * as context from '@okikio/context';
import * as deno from './deno.ts';
import * as process from './mod.ts';

const decoder = new TextDecoder();
const adapter = deno.create();

describe('Deno process adapter', () => {
	it('captures bounded stdout and stderr for finite execution', async () => {
		await using ctx = context.create({ id: 'process-capture' });
		const exit = await process.exec(ctx, adapter, {
			command: Deno.execPath(),
			arguments: ['eval', 'console.log("output"); console.error("diagnostic");'],
			stdout: { type: 'capture', maximumBytes: 1024 },
			stderr: { type: 'capture', maximumBytes: 1024 },
		});
		expect(exit.success).toBe(true);
		expect(decoder.decode(exit.stdout)).toBe('output\n');
		expect(decoder.decode(exit.stderr)).toBe('diagnostic\n');
	});

	it('writes piped input before waiting for completion', async () => {
		await using ctx = context.create({ id: 'process-input' });
		const exit = await process.exec(ctx, adapter, {
			command: Deno.execPath(),
			arguments: ['eval', 'const text = await new Response(Deno.stdin.readable).text(); console.log(text.toUpperCase());'],
			stdin: 'piped',
			input: 'hello',
			stdout: { type: 'capture', maximumBytes: 1024 },
			stderr: { type: 'capture', maximumBytes: 1024 },
		});
		expect(decoder.decode(exit.stdout)).toBe('HELLO\n');
	});

	it('does not access Deno stream getters for discarded stdio', async () => {
		await using ctx = context.create({ id: 'process-discarded-stdio' });
		const exit = await process.exec(ctx, adapter, {
			command: Deno.execPath(),
			arguments: ['eval', 'console.log("discarded"); console.error("discarded");'],
			stdin: 'null',
			stdout: { type: 'discard' },
			stderr: { type: 'discard' },
		});
		expect(exit.success).toBe(true);
	});

	it('fails bounded capture when output exceeds its limit', async () => {
		await using ctx = context.create({ id: 'process-limit' });
		await expect(process.exec(ctx, adapter, {
			command: Deno.execPath(),
			arguments: ['eval', 'console.log("x".repeat(2048));'],
			stdout: { type: 'capture', maximumBytes: 64 },
			stderr: { type: 'discard' },
			shutdown: { graceMs: 10, forceMs: 1_000 },
		})).rejects.toThrow(process.OutputLimitError);
	});

	it('stops on parent cancellation and makes repeated stop calls harmless', async () => {
		const controller = new AbortController();
		await using ctx = context.create({ id: 'process-cancel', signal: controller.signal });
		const child = await process.start(ctx, adapter, {
			command: Deno.execPath(),
			arguments: ['eval', 'await new Promise(() => {});'],
			stdout: { type: 'discard' },
			stderr: { type: 'discard' },
			shutdown: { graceMs: 10, forceMs: 1_000 },
		});
		controller.abort('cancel process');
		await Promise.all([child.stop(), child.stop(), child[Symbol.asyncDispose]()]);
		const exit = await child.wait();
		expect(exit.success).toBe(false);
	});

	it('advertises POSIX process-group ownership only where Deno can provide it', async () => {
		await using ctx = context.create({ id: 'process-tree' });
		if (Deno.build.os === 'windows') {
			await expect(process.start(ctx, adapter, {
				command: Deno.execPath(),
				tree: 'posix-process-group',
			})).rejects.toThrow(process.UnsupportedTreeModeError);
			return;
		}

		const child = await process.start(ctx, adapter, {
			command: Deno.execPath(),
			arguments: ['eval', 'await new Promise(() => {});'],
			tree: 'posix-process-group',
			stdout: { type: 'discard' },
			stderr: { type: 'discard' },
			shutdown: { graceMs: 100, forceMs: 1_000 },
		});
		expect(child.tree).toBe('posix-process-group');
		await child.stop('process-group test');
		expect((await child.wait()).success).toBe(false);
	});
});

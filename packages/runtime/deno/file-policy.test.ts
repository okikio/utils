import { directory as temporaryDirectory } from './fixtures/directory.ts';
import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as file from './file.ts';
import { AsyncDisposableStack } from '@okikio/dispose';

describe('explicit file publication policy', () => {
	it('preserves host permission denial rather than falling back to a different write path', async () => {
		const child = await new Deno.Command(Deno.execPath(), {
			args: [
				'run',
				'--frozen',
				'--no-prompt',
				'--allow-read',
				'--deny-write',
				new URL('./fixtures/file-crash.ts', import.meta.url).href,
				new URL('../../../.tmp/tests/runtime/denied-publication', import.meta.url).pathname,
				'denied',
			],
			stdout: 'piped',
			stderr: 'piped',
		}).output();
		expect(child.success).toBe(false);
		expect(new TextDecoder().decode(child.stderr)).toContain('NotCapable');
	});
	it('retains complete old/new content across process death at sync/publication boundaries', async () => {
		for (const phase of ['before-sync', 'before-publish', 'after-publish']) {
			const directory = await temporaryDirectory();
			await using cleanup = new AsyncDisposableStack();
			// Register directory removal before starting a child or asserting its checkpoint.
			cleanup.defer(() => Deno.remove(directory, { recursive: true }));
			const path = directory + '/value';
			await Deno.writeTextFile(path, 'old-complete');
			const child = new Deno.Command(Deno.execPath(), {
				args: [
					'run',
					'--frozen',
					'--allow-read',
					'--allow-write',
					new URL('./fixtures/file-crash.ts', import.meta.url).href,
					path,
					phase,
				],
				stdout: 'piped',
				stderr: 'piped',
			}).spawn();
			const reader = child.stdout.getReader();
			let timer: ReturnType<typeof setTimeout> | undefined;
			try {
				const checkpoint = await Promise.race([
					reader.read(),
					new Promise<never>((_resolve, reject) => {
						timer = setTimeout(() => reject(new Error('Crash fixture did not reach checkpoint.')), 10000);
					}),
				]);
				expect(new TextDecoder().decode(checkpoint.value)).toBe('ready\n');
			} finally {
				clearTimeout(timer);
				try {
					child.kill('SIGKILL');
				} catch { /* Already exited; status below remains authoritative. */ }
				await child.status;
				await reader.cancel();
				reader.releaseLock();
				await child.stderr.cancel();
			}
			expect(await Deno.readTextFile(path)).toBe(phase === 'after-publish' ? 'new-complete' : 'old-complete');
			// Process death bypasses finally. The case owner also removes any unpublished entry.
		}
	});
	it('atomically allows one create winner and never overwrites an existing entry', async () => {
		const directory = await temporaryDirectory();
		try {
			const path = directory + '/value';
			const outcomes = await Promise.allSettled(
				['first', 'second'].map((value) => file.write(path, value, { overwrite: 'create', durability: 'file' })),
			);
			expect(outcomes.filter((value) => value.status === 'fulfilled')).toHaveLength(1);
			expect(['first', 'second']).toContain(await Deno.readTextFile(path));
			expect((await Array.fromAsync(Deno.readDir(directory))).map((entry) => entry.name)).toEqual(['value']);
		} finally {
			await Deno.remove(directory, { recursive: true });
		}
	});
	it('replaces a symlink entry without writing through it; trusted parents remain caller policy', async () => {
		const directory = await temporaryDirectory();
		try {
			await Deno.writeTextFile(directory + '/original', 'unchanged');
			await Deno.symlink(directory + '/original', directory + '/link', { type: 'file' });
			await file.write(directory + '/link', 'replacement', { durability: 'directory' });
			expect((await Deno.lstat(directory + '/link')).isSymlink).toBe(false);
			expect(await Deno.readTextFile(directory + '/original')).toBe('unchanged');
			expect(await Deno.readTextFile(directory + '/link')).toBe('replacement');
		} finally {
			await Deno.remove(directory, { recursive: true });
		}
	});
	it('distinguishes a post-publication sync failure from failure before publication', async () => {
		const directory = await temporaryDirectory();
		const original = Deno.open;
		try {
			await Deno.writeTextFile(directory + '/value', 'old');
			Deno.open = ((path: string | URL, options?: Deno.OpenOptions) => {
				if (path === directory) throw new Error('injected directory open failure');
				return original(path, options);
			}) as typeof Deno.open;
			await expect(file.write(directory + '/value', 'new', { durability: 'directory' })).rejects.toBeInstanceOf(
				file.FilePublicationError,
			);
			expect(await Deno.readTextFile(directory + '/value')).toBe('new');
			expect((await Array.fromAsync(Deno.readDir(directory))).map((entry) => entry.name)).toEqual(['value']);
		} finally {
			Deno.open = original;
			await Deno.remove(directory, { recursive: true });
		}
	});
	it('retains both publication and cleanup failures without losing either cause', async () => {
		const directory = await temporaryDirectory();
		const rename = Deno.rename;
		const remove = Deno.remove;
		const publication = new Error('injected rename failure');
		const cleanup = new Error('injected cleanup failure');
		try {
			Deno.rename = () => Promise.reject(publication);
			Deno.remove = () => Promise.reject(cleanup);
			let failure: unknown;
			try {
				await file.write(directory + '/value', 'bytes');
			} catch (error) {
				failure = error;
			}
			expect(failure).toBeInstanceOf(AggregateError);
			expect((failure as AggregateError).errors).toEqual([publication, cleanup]);
		} finally {
			Deno.rename = rename;
			Deno.remove = remove;
			await Deno.remove(directory, { recursive: true });
		}
	});
	it('removes only its exclusively created temporary entry after a rename failure', async () => {
		const directory = await temporaryDirectory();
		try {
			await Deno.mkdir(directory + '/destination');
			await Deno.writeTextFile(directory + '/unrelated.tmp', 'keep');
			await expect(file.write(directory + '/destination', 'bytes')).rejects.toThrow();
			expect((await Array.fromAsync(Deno.readDir(directory))).map((entry) => entry.name).sort()).toEqual([
				'destination',
				'unrelated.tmp',
			]);
			expect(await Deno.readTextFile(directory + '/unrelated.tmp')).toBe('keep');
		} finally {
			await Deno.remove(directory, { recursive: true });
		}
	});
});

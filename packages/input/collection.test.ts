import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as schema from '@okikio/schema';
import { clipboard, commands, files, forms, text } from './mod.ts';
import { Surface } from './fixtures/target.ts';

describe('collecting values independently of a browser runtime', () => {
	it('emits one committed IME value and then ordinary replacement edits', () => {
		const target = Object.assign(new Surface(), { value: '' });
		const changes: text.Change[] = [];
		using _stop = text.listen(target, (change) => changes.push(change));
		target.emit('compositionstart');
		target.value = 'あ';
		target.emit('input', { isComposing: true });
		expect(changes).toHaveLength(0);
		target.emit('compositionend', { data: 'あ' });
		target.emit('input', { isComposing: false });
		expect(changes.map(({ value }) => value)).toEqual(['あ']);
		target.value = 'word';
		target.emit('input', { inputType: 'insertReplacementText' });
		expect(changes[1]).toMatchObject({
			value: 'word',
			previous: 'あ',
			composing: false,
			inputType: 'insertReplacementText',
		});
		target.value = 'assigned';
		expect(changes).toHaveLength(2);
		expect(text.read(target)).toBe('assigned');
	});

	it('offers composition changes explicitly and cleans a failed initial reader', () => {
		const target = Object.assign(new Surface(), { value: '' });
		const values: boolean[] = [];
		using stop = text.listen(target, (change) => values.push(change.composing), { composition: 'include' });
		target.emit('compositionstart');
		target.value = 'a';
		target.emit('input', { isComposing: true });
		expect(values).toEqual([true]);
		stop();
		expect(target.size).toBe(0);
		expect(() =>
			text.listen(target, () => {}, {
				read: () => {
					throw new Error('editor failed');
				},
			})
		).toThrow('editor failed');
		expect(target.size).toBe(0);
	});

	it('closes a later failed text reader before reporting its exact failure', () => {
		for (const failure of [new Error('editor disconnected'), undefined]) {
			const target = new Surface();
			const reports: unknown[] = [];
			let reads = 0;
			using stop = text.listen(target, () => {
				throw new Error('A failed read must not publish a value.');
			}, {
				read: () => {
					if (reads++ === 0) return 'initial';
					throw failure;
				},
				onError: (error) => {
					expect(target.size).toBe(0);
					reports.push(error);
				},
			});
			target.emit('input');
			expect(reports).toEqual([failure]);
			expect(stop.closed).toBe(true);
			target.emit('input');
			expect(reads).toBe(2);
		}
	});

	it('terminates text observation on reader failure and preserves an undefined failure', () => {
		const target = new Surface();
		const failures: unknown[] = [];
		let reads = 0;
		using subscription = text.observe(target, {
			read: () => {
				if (reads++ === 0) return 'initial';
				throw undefined;
			},
		}).subscribe({
			error: (error) => {
				expect(target.size).toBe(0);
				failures.push(error);
			},
		});
		target.emit('input');
		expect(failures).toEqual([undefined]);
		expect(subscription.closed).toBe(true);
		expect(target.size).toBe(0);
	});

	it('shares the owned Observable contract and completes each cold subscription on abort', () => {
		const target = Object.assign(new Surface(), { value: '' });
		const screen = new AbortController();
		const values: string[] = [];
		let completed = 0;
		const source = text.observe(target, { signal: screen.signal });
		expect(target.size).toBe(0);
		using first = source.subscribe({
			next: ({ value }) => values.push(value),
			complete: () => {
				completed++;
			},
		});
		using second = source.subscribe({
			complete: () => {
				completed++;
			},
		});
		expect(target.size).toBe(6);
		target.value = 'Ada';
		target.emit('input');
		screen.abort();
		expect(values).toEqual(['Ada']);
		expect(completed).toBe(2);
		expect(target.size).toBe(0);
		void first;
		void second;
	});

	it('preserves ordered repeated form entries and files before owned schema validation', async () => {
		const source = new FormData();
		const file = new File(['abc'], 'report.txt', { type: 'text/plain' });
		source.append('name', 'Ada');
		source.append('age', '37');
		source.append('tags', 'writer');
		source.append('tags', 'engineer');
		source.append('attachment', file);
		const entries = forms.read(source);
		expect(entries.map(([name]) => name)).toEqual(['name', 'age', 'tags', 'tags', 'attachment']);
		const attachment = entries.at(-1)?.[1];
		if (attachment === undefined || typeof attachment === 'string') throw new Error('Expected a native file value.');
		expect(attachment.name).toBe('report.txt');
		expect(await attachment.text()).toBe('abc');
		expect(await new Response(attachment.stream()).text()).toBe('abc');
		// Hosts may return a fresh File wrapper each time FormData is read. The
		// utility preserves the exact borrowed value yielded by one entry source.
		const captured = [...source];
		expect(forms.read(captured).at(-1)?.[1]).toBe(captured.at(-1)?.[1]);
		const ProfileSchema = schema.object({
			name: schema.string(),
			age: schema.coerce.number({ integer: true }),
			tags: schema.array(schema.string()),
		}, { unknownKeys: 'strip' });
		const checked = await forms.validate(ProfileSchema, source, { multiple: ['tags'] });
		expect(checked).toEqual({ value: { name: 'Ada', age: 37, tags: ['writer', 'engineer'] } });
		expect(forms.object([['tags', 'one']], { multiple: ['tags', 'missing'] })).toEqual({ tags: ['one'], missing: [] });
	});

	it('retains duplicate scalars explicitly and treats special field names as ordinary data', () => {
		const value = forms.object([['__proto__', 'safe'], ['name', 'a'], ['name', 'b']]);
		expect(Object.getPrototypeOf(value)).toBeNull();
		expect(value['__proto__']).toBe('safe');
		expect(value.name).toEqual(['a', 'b']);
		expect(() => forms.object([['x', '1'], ['x', '2']], { duplicates: 'reject' })).toThrow('more than once');
		expect(() => forms.read([['a', '1'], ['b', '2']], { maxEntries: 1 })).toThrow(RangeError);
	});

	it('snapshots a submitter and bounds asynchronous submission without swallowing failure', async () => {
		const gate = Promise.withResolvers<void>();
		const failures: unknown[] = [];
		const seen: unknown[] = [];
		const target = Object.assign(new Surface(), {
			read: (submitter?: unknown) => {
				seen.push(submitter);
				return [['name', 'Ada']] as const;
			},
		});
		let calls = 0;
		using stop = forms.listen(target, async ({ entries }) => {
			calls++;
			expect(entries).toEqual([['name', 'Ada']]);
			await gate.promise;
		}, { preventDefault: true, onError: (error) => failures.push(error) });
		const button = { name: 'save' };
		expect(target.emit('submit', { submitter: button }).defaultPrevented).toBe(true);
		expect(target.emit('submit', { submitter: button }).defaultPrevented).toBe(true);
		expect(calls).toBe(1);
		expect(seen).toEqual([button]);
		const failure = new Error('save failed');
		gate.reject(failure);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(failures).toEqual([failure]);
		stop();
		expect(target.size).toBe(0);
	});

	it('checks file metadata and closes a too-large iterable before reading a body', () => {
		const file = { name: 'table.CSV', size: 10, type: '' };
		let closed = false;
		function* source() {
			try {
				yield file;
				yield file;
			} finally {
				closed = true;
			}
		}
		expect(files.from([file], { accept: ['.csv'] })[0]).toBe(file);
		expect(() => files.from(source(), { maxCount: 1 })).toThrow(files.SelectionError);
		expect(closed).toBe(true);
		expect(() => files.from([file], { maxBytes: 9 })).toThrow(files.SelectionError);
		expect(() => files.from([file], { accept: ['image/*'] })).toThrow(files.SelectionError);
	});

	it('cancels picker delivery without pretending to dismiss its dialog', async () => {
		const picked = Promise.withResolvers<readonly files.FileHandle[]>();
		const controller = new AbortController();
		let reads = 0;
		const selection = files.pick({ showOpenFilePicker: () => picked.promise }, { signal: controller.signal });
		const stopped = selection.catch((error: unknown) => error);
		controller.abort('left-screen');
		expect(await stopped).toBe('left-screen');
		picked.resolve([{
			getFile() {
				reads++;
				return Promise.resolve({ name: 'a', size: 1, type: '' });
			},
		}]);
		await Promise.resolve();
		expect(reads).toBe(0);
	});

	it('preserves picker error identity and does not call a host after pre-abort', async () => {
		const denial = new Error('denied');
		await expect(files.pick({ showOpenFilePicker: () => Promise.reject(denial) })).rejects.toBe(denial);
		let called = false;
		await expect(files.pick({
			showOpenFilePicker: () => {
				called = true;
				return Promise.resolve([]);
			},
		}, { signal: AbortSignal.abort('cancelled') })).rejects.toBe('cancelled');
		expect(called).toBe(false);
		await expect(files.pick({
			showOpenFilePicker: () => {
				called = true;
				return Promise.resolve([]);
			},
		}, { maxCount: 0 })).rejects.toBeInstanceOf(RangeError);
		expect(called).toBe(false);
	});

	it('validates selection policy before reporting a borrowed host without an optional picker', async () => {
		const host: files.Picker & { readonly location: { readonly href: string } } = {
			location: { href: 'https://example.invalid/' },
		};
		await expect(files.pick(host)).rejects.toBeInstanceOf(TypeError);
		await expect(files.pick(host, { maxCount: 0 })).rejects.toBeInstanceOf(RangeError);
		await expect(files.pick(host, { signal: AbortSignal.abort(null) })).rejects.toBeNull();
		expect(Object.keys(host)).toEqual(['location']);
	});

	it('snapshots a file drop while its data store is readable and releases hover once', async () => {
		const target = new Surface();
		const file = { name: 'a.txt', type: 'text/plain', size: 1 };
		const hover: boolean[] = [];
		const transfer = { types: ['Files'], files: [file] };
		let selection: readonly files.FileValue[] = [];
		using stop = files.drop(target, async ({ files }) => {
			await Promise.resolve();
			selection = files;
		}, { hover: (active) => hover.push(active) });
		target.emit('dragenter', { dataTransfer: transfer });
		target.emit('dragenter', { dataTransfer: transfer });
		target.emit('dragleave');
		expect(target.emit('dragover', { dataTransfer: transfer }).defaultPrevented).toBe(true);
		expect(target.emit('drop', { dataTransfer: transfer }).defaultPrevented).toBe(true);
		transfer.files = [];
		await Promise.resolve();
		expect(selection).toEqual([file]);
		expect(hover).toEqual([true, false]);
		stop();
		expect(target.size).toBe(0);
	});

	it('reads and writes clipboard text through the supplied host and retains native denial', async () => {
		const host = {
			value: 'before',
			readText() {
				return Promise.resolve(this.value);
			},
			writeText(value: string) {
				this.value = value;
				return Promise.resolve();
			},
		};
		expect(await clipboard.read(host)).toBe('before');
		await clipboard.write(host, 'after');
		expect(host.value).toBe('after');
		const denial = new Error('clipboard denied');
		await expect(clipboard.read({ readText: () => Promise.reject(denial) })).rejects.toBe(denial);
		await expect(clipboard.read({}, { signal: AbortSignal.abort(null) })).rejects.toBeNull();
	});

	it('copies paste strings during dispatch and leaves native insertion enabled by default', async () => {
		const target = new Surface();
		let readable = true;
		let text = '';
		using stop = clipboard.listen(target, async (paste) => {
			await Promise.resolve();
			text = paste.text;
		});
		const event = target.emit('paste', {
			clipboardData: {
				getData(type: string) {
					if (!readable) throw new Error('expired');
					return type === 'text/plain' ? 'copied' : '<b>copied</b>';
				},
				files: [],
			},
		});
		readable = false;
		await Promise.resolve();
		expect(text).toBe('copied');
		expect(event.defaultPrevented).toBe(false);
		stop();
		expect(target.size).toBe(0);
	});

	it('reuses typed commands with ordinary values and preserves their asynchronous output', async () => {
		const publish = commands.define({
			id: 'publish',
			label: 'Publish',
			enabled: (value: number) => value > 0,
			invoke: async (value: number) => value * 2,
		});
		expect(commands.enabled(publish, 0)).toBe(false);
		expect(() => commands.run(publish, 0)).toThrow(commands.CommandDisabledError);
		const output: Promise<number> = commands.run(publish, 3);
		expect(await output).toBe(6);
		expect(commands.catalog('actions', { publish }).publish).toBe(publish);
	});
});

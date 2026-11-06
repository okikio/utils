/** Public call sites shared by browser, Worker and Node type environments. */
import * as catalog from '@okikio/collection/catalog';
import * as context from '@okikio/context';
import * as events from '@okikio/context/events';
import * as state from '@okikio/context/state';
import * as duration from '@okikio/duration';
import { keys, pointer } from '@okikio/input';
import * as queue from '@okikio/scheduler/queue';
import * as schema from '@okikio/schema';
import type { Queue } from '@okikio/storage/queue';
import * as stores from '@okikio/storage/state';

/** A server-side mock and a browser adapter use the same core types without fabricated DOM objects. */
export function contracts(): void {
	const target = { addEventListener() {}, removeEventListener() {} };
	using shortcuts = keys.listen(target, [{
		key: 'j',
		run(event) {
			const key: string = event.key;
			void key;
			// @ts-expect-error The mock contract does not invent native keyboard metadata.
			void event.location;
		},
	}]);
	using gesture = pointer.listen(target, {
		move({ event }) {
			const pointer: number = event.pointerId;
			void pointer;
			// @ts-expect-error The mock contract does not invent native pointer metadata.
			void event.pressure;
		},
	});
	using progress = state.create({ completed: 0 });
	using subscription = progress.reader.changes.subscribe(({ value }) => {
		const count: number = value.completed;
		void count;
	});
	// @ts-expect-error A read-only observation never grants write authority.
	progress.reader.changes.emit({ completed: 2 });
	const ctx = context.create({ id: 'portable-types' });
	const updates = events.from(ctx, new EventTarget(), 'update');
	updates.subscribe((event) => {
		const type: string = event.type;
		void type;
	});
	const milliseconds: number = duration.convert(1.5, 'seconds', 'milliseconds');
	void milliseconds;
	// @ts-expect-error Unknown time units must not silently become milliseconds.
	duration.convert(2, 'ticks', 'seconds');
	const Payload = schema.extend(schema.object({ id: schema.string() }, { unknownKeys: 'preserve' }), {
		attempt: schema.number({ integer: true }),
	});
	const data = Payload.parse({ id: 'page', attempt: 1, providerField: 'retained' });
	const id: string = data.id;
	const extra: unknown = data.providerField;
	void id;
	void extra;
	const Fetch = { id: 'page.fetch', kind: 'command' } as const;
	const Commands = catalog.create('crawl', { Fetch });
	const exact: typeof Fetch = Commands.Fetch;
	void exact;
	const jobs: Queue<string, number> = queue.memory<string, number>();
	void jobs;
	void shortcuts;
	void gesture;
	void subscription;
}

/** A saved progress reader keeps its ordinary observable types in every runtime profile. */
export async function storedProgress(signal: AbortSignal): Promise<void> {
	const Progress = schema.object({ completed: schema.number({ integer: true, minimum: 0 }) });
	await using progress = await state.open({
		store: stores.memory(),
		contract: 'crawl.progress.v1',
		value: Progress,
		initial: () => ({ completed: 0 }),
		signal,
	});
	using subscription = progress.reader.changes.subscribe(({ value }) => {
		const count: number = value.completed;
		void count;
	});
	await progress.update((value) => ({ completed: value.completed + 1 }));
	const version: string = progress.version;
	void version;
	void subscription;
	// @ts-expect-error Persistence does not widen a schema's application output.
	await progress.set({ completed: '1' });
	// @ts-expect-error A read-only state view cannot perform a storage write.
	progress.reader.set({ completed: 2 });
}

/** Focused event and stream leaves retain native values without inventing DOM-only globals in Node. */
export async function byteStreamTypes(
	ctx: import('@okikio/context').Context,
	port: import('@okikio/worker/stream').Port,
): Promise<void> {
	const stream = await import('@okikio/worker/stream');
	await using receiver = stream.open(ctx, port, {
		id: 'typed',
		maximumChunkBytes: 64,
		maximumChunks: 8,
		maximumBytes: 256,
		timeout: 1000,
	});
	const source: ReadableStream<Uint8Array> = receiver.readable;
	const target: EventTarget = receiver.target;
	const terminal: Promise<import('@okikio/worker/stream').OutcomeType> = receiver.closed;
	// @ts-expect-error A stream producer yields bytes, not arbitrary object notices.
	stream.serve(ctx, port, async function* () {
		yield { value: 1 };
	}, { maximumChunkBytes: 64, maximumChunks: 1, maximumBytes: 64 });
	void [source, target, terminal];
}

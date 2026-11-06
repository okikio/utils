// @installed-consumer: Run this public-import scenario against packed artifacts too.
/** One bounded import flow must work unchanged from source and physically installed ESM packages. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as schema from '@okikio/schema';
import * as context from '@okikio/context';
import * as state from '@okikio/context/state';
import * as storage from '@okikio/storage/state';
import * as csv from '@okikio/format/csv';
import { rows } from '@okikio/format/csv/validate';
import { map } from '@okikio/scheduler/concurrency';
import { create, withLease } from '@okikio/pool';
import { preconditions } from '@okikio/http/response/http';
import { planRetryAfter } from '@okikio/http/retry';
import * as json from '@okikio/collection/record/json';

test('bounded import validates once, borrows reset sessions and persists progress before publication', async () => {
	await using ctx = context.create({ id: 'capability-import' });
	const slot = storage.memory();
	await using _legacy = await state.open({
		store: slot,
		contract: 'import.v1',
		value: schema.number(),
		initial: () => 0,
	});
	await using progress = await state.open({
		store: slot,
		contract: 'import.v2',
		value: schema.object({ completed: schema.number() }),
		migrations: [state.migration('import.v1', schema.number(), (completed) => ({ completed }))],
	});
	using visible = state.select(progress.reader, ({ completed }) => completed);
	let resets = 0;
	await using sessions = await create({
		ctx,
		maximum: 2,
		maximumWaiting: 2,
		maximumUses: 10,
		create: () => ({ selected: '' }),
		reset(session) {
			session.selected = '';
			resets++;
		},
		close() {},
	});
	const source = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(new TextEncoder().encode('Name,Name\nignored,Ada\nignored,Lin\n'));
			controller.close();
		},
	});
	await using document = await csv.parseStream(source, { delimiter: ',', encoding: 'utf-8', headerRow: 1 });
	const parsed = rows(schema.object({ name: schema.string() }), document.rows, {
		columns: { name: 1 },
		maximumColumns: 1,
		maximumRows: 2,
		maximumIssues: 2,
		maximumPathLength: 4,
		onInvalid: 'throw',
		signal: ctx.signal,
	});
	const names = await Array.fromAsync(map(parsed, async (row) => {
		assert.equal(row.kind, 'value');
		if (row.kind !== 'value') throw new Error('Invalid import row.');
		return await withLease(sessions, ctx, async (session) => {
			session.selected = row.value.name;
			await progress.update(({ completed }) => ({ completed: completed + 1 }));
			return session.selected;
		});
	}, { concurrency: 2, maximumBuffered: 2, ordering: 'input', signal: ctx.signal }));
	assert.deepEqual(names, ['Ada', 'Lin']);
	assert.equal(visible.get(), 2);
	assert.equal(resets, 2);
	assert.equal(sessions.stats().leased, 0);
	assert.equal((await slot.load())?.contract, 'import.v2');
	assert.equal(json.stringify(progress.reader.get(), { maximumBytes: 128 }), '{"completed":2}');
	assert.equal(
		preconditions(new Request('https://test.invalid', { headers: { 'if-none-match': 'W/"import,2"' } }), {
			exists: true,
			etag: '"import,2"',
			now: 0,
		}).kind,
		'not-modified',
	);
	assert.deepEqual(planRetryAfter('2', { now: 0, maximumDelay: 1000, maximumCodeUnits: 64 }), {
		kind: 'delay',
		source: 'seconds',
		capped: true,
		milliseconds: 1000,
	});
	assert.equal(source.locked, false);
});

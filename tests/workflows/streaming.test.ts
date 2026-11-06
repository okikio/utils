/** Real TCP/SSE replay after host death, backed by a commit-ordered PostgreSQL feed. @module */
import '@okikio/dispose/polyfill';
import { after, before, describe, it } from 'node:test';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { expect } from '@std/expect';
import * as events from '@okikio/http/events';
import { ownSchema } from './fixtures/database.ts';

const url = process.env.UTILS_WORKFLOW_TEST_DATABASE_URL;
const limits = { maximumBytes: 16384, maximumChunkBytes: 8192, maximumEventBytes: 512, maximumEvents: 32 };
type Fixture = Awaited<ReturnType<typeof ownSchema>>;
let fixture: Fixture;
const feed = crypto.randomUUID();
const children = new Set<ChildProcess>();

/** Bound observations by a deadline and preserve the unmet recovery condition. */
async function until(read: () => Promise<boolean>, condition: string): Promise<void> {
	const deadline = Date.now() + 10_000;
	while (!await read()) {
		if (Date.now() >= deadline) throw new Error(`Streaming recovery timed out: ${condition}`);
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

/** A restarted host gets only the database URL and feed identity, never an in-memory cursor. */
async function start(): Promise<{ child: ChildProcess; origin: string }> {
	const child = spawn(process.env.DENO_BIN ?? 'deno', ['run', '-A', 'tests/workflows/scenarios/streaming.ts'], {
		cwd: new URL('../../', import.meta.url),
		stdio: ['ignore', 'pipe', 'pipe'],
		env: { ...process.env, DATABASE_URL: fixture.url, STREAM_FEED: feed },
	});
	children.add(child);
	let output = '', diagnostics = '';
	child.stderr!.on('data', (value) => {
		diagnostics = (diagnostics + String(value)).slice(-65536);
	});
	const origin = await new Promise<string>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`Streaming host did not start: ${diagnostics}`)), 10_000);
		child.once('error', (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.once('exit', () => {
			clearTimeout(timer);
			reject(new Error(`Streaming host exited: ${diagnostics}`));
		});
		child.stdout!.on('data', (value) => {
			output += String(value);
			const end = output.indexOf('\n');
			if (end < 0) return;
			try {
				const message = JSON.parse(output.slice(0, end)) as { port: number };
				clearTimeout(timer);
				resolve(`http://127.0.0.1:${message.port}`);
			} catch (error) {
				clearTimeout(timer);
				reject(error);
			}
		});
	});
	return { child, origin };
}

/** Join actual process death; merely sending SIGKILL is not proof that its resources ended. */
async function kill(child: ChildProcess): Promise<void> {
	if (child.exitCode === null && child.signalCode === null) {
		const ended = once(child, 'exit');
		child.kill('SIGKILL');
		await ended;
	}
	children.delete(child);
}

/**
 * Allocate the sequence under the same row lock and transaction as the event.
 * This prevents a slower transaction with a lower sequence from committing
 * after readers have already advanced past a higher sequence.
 */
async function append(name: string, fail = false): Promise<number> {
	return await fixture.database.begin(async (transaction) => {
		const row =
			(await transaction<{ tail: number }[]>`update stream_feeds set tail=tail+1 where id=${feed} returning tail`)[0]!;
		await transaction`insert into stream_events (feed,sequence,payload) values (${feed},${row.tail},${
			transaction.json({ message: `Hello, ${name}!` })
		})`;
		if (fail) throw new Error('Before commit.');
		return row.tail;
	});
}

/** The caller owns cancellation; the stream parser owns its response reader. */
async function connect(origin: string, after: number) {
	const abort = new AbortController();
	const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(15_000)]);
	const response = await fetch(`${origin}/events`, {
		headers: { 'last-event-id': `${feed}:${after}` },
		signal,
	});
	expect(response.status).toBe(200);
	return { abort, response, reader: events.read(response.body!, { ...limits, signal }) };
}

/** This suite borrows only an explicitly supplied disposable database, never application data. */
describe('PostgreSQL-backed HTTP stream recovery', { skip: url === undefined, concurrency: false }, () => {
	before(async () => {
		fixture = await ownSchema(url!, 5);
		await fixture
			.database`create table stream_feeds (id text primary key,tail integer not null default 0,floor integer not null default 0)`;
		await fixture
			.database`create table stream_events (feed text,sequence integer,payload jsonb,primary key(feed,sequence))`;
		await fixture.database`insert into stream_feeds (id) values (${feed})`;
	});
	after(async () => {
		await Promise.all([...children].map(kill));
		await fixture?.[Symbol.asyncDispose]();
	});

	it('recovers committed events after real host SIGKILL and admits events at the replay/live boundary', async () => {
		await expect(append('Rolled back', true)).rejects.toThrow('Before commit.');
		expect(await append('Sam')).toBe(1);
		let host = await start();
		const connection = await connect(host.origin, 0);
		try {
			expect((await connection.reader.next()).value?.id).toBe(`${feed}:1`);
			await until(
				async () => (await (await fetch(`${host.origin}/state`)).json()).emptyPolls > 0,
				'reader reached the live tail',
			);
			expect(await append('Jo')).toBe(2);
			expect((await connection.reader.next()).value?.id).toBe(`${feed}:2`);
			// Kill while this connection still owns an active source. A fresh host
			// must recover from the client's cursor, not from graceful teardown.
			await until(
				async () => (await (await fetch(`${host.origin}/state`)).json()).active === 1,
				'live connection retains its source before host death',
			);
			await kill(host.child);
			await expect(connection.reader.next()).rejects.toThrow();
		} finally {
			connection.abort.abort();
			await connection.reader.return(undefined);
		}
		expect(await append('Lee')).toBe(3); // The only HTTP host is dead at this commit.
		host = await start();
		const resumed = await connect(host.origin, 2);
		try {
			const next = (await resumed.reader.next()).value!;
			expect(next.id).toBe(`${feed}:3`);
			expect(JSON.parse(next.data!)).toEqual({ message: 'Hello, Lee!' });
		} finally {
			resumed.abort.abort();
			await resumed.reader.return(undefined);
		}

		await until(
			async () => (await (await fetch(`${host.origin}/state`)).json()).active === 0,
			'resumed disconnect released the source',
		);
		await fixture.database.begin(async (transaction) => {
			await transaction`delete from stream_events where feed=${feed} and sequence<=1`;
			await transaction`update stream_feeds set floor=1 where id=${feed}`;
		});
		for (
			const [cursor, status] of [[`${feed}:0`, 410], [`${feed}:999`, 400], ['foreign:2', 400], [
				`${feed}:NaN`,
				400,
			]] as const
		) {
			const response = await fetch(`${host.origin}/events`, { headers: { 'last-event-id': cursor } });
			expect(response.status).toBe(status);
			await response.body?.cancel();
		}
		await kill(host.child);
	});

	it('bounds database batches and connection output, then resumes from the client cursor after a late body failure', async () => {
		expect(await append('First')).toBe(4);
		const host = await start();
		const connection = await connect(host.origin, 3);
		let received = 0;
		try {
			expect((await connection.reader.next()).value?.id).toBe(`${feed}:4`);
			received += 1;
			for (let index = 0; index < 20; index++) await append(`More ${index}`);
			// Headers already succeeded. A serialization budget failure must interrupt
			// the body rather than invent a replacement HTTP status after transmission.
			let failed = false;
			try {
				for await (const event of connection.reader) {
					expect(event.id?.startsWith(feed + ':')).toBe(true);
					received += 1;
				}
			} catch {
				failed = true;
			}
			expect(failed).toBe(true);
			expect(received).toBeLessThanOrEqual(16);
		} finally {
			connection.abort.abort();
			await connection.reader.return(undefined);
		}
		await until(
			async () => (await (await fetch(`${host.origin}/state`)).json()).active === 0,
			'output refusal released the source',
		);
		const state = await (await fetch(`${host.origin}/state`)).json();
		expect(state.maximumBatch).toBeLessThanOrEqual(2);
		// A server-side read is not an acknowledgement. Reusing the last applied
		// cursor intentionally redelivers First, even if it was previously buffered.
		const resumed = await connect(host.origin, 3);
		try {
			expect((await resumed.reader.next()).value?.id).toBe(`${feed}:4`);
		} finally {
			resumed.abort.abort();
			await resumed.reader.return(undefined);
		}
		await kill(host.child);
	});
});

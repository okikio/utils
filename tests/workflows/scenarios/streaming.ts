/** Local checks host: PostgreSQL owns the feed; HTTP connections only read it. @module */
import postgres from 'postgres';
import * as http from '@okikio/server/http';
import * as events from '@okikio/http/events';
import { readable } from '@okikio/streams';

const url = Deno.env.get('DATABASE_URL');
const feed = Deno.env.get('STREAM_FEED') ?? '';
if (!url || !feed) throw new Error('The streaming fixture needs its own database and feed.');
const database = postgres(url, { max: 3, onnotice() {} });
let active = 0, emptyPolls = 0, maximumBatch = 0;

/** Stop a poll delay when its connection ends, without retaining an abort listener. */
function pause(signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const cancel = () => {
			clearTimeout(timer);
			signal.removeEventListener('abort', cancel);
			reject(signal.reason);
		};
		const timer = setTimeout(() => {
			signal.removeEventListener('abort', cancel);
			resolve();
		}, 20);
		signal.addEventListener('abort', cancel, { once: true });
		if (signal.aborted) cancel();
	});
}

/**
 * Read committed rows strictly after the last emitted sequence, two rows at a time.
 * Polling the same durable log for both replay and new events leaves no separate
 * pub/sub subscription gap. The fixture writer serializes sequence allocation
 * with each append transaction; an earlier sequence cannot commit after a later one.
 */
async function* messages(after: number, signal: AbortSignal): AsyncGenerator<events.MessageType> {
	active += 1;
	try {
		while (!signal.aborted) {
			const rows = await database<{ sequence: number; payload: { message: string } }[]>`
    select sequence, payload from stream_events where feed=${feed} and sequence>${after} order by sequence limit 2`;
			maximumBatch = Math.max(maximumBatch, rows.length);
			if (rows.length === 0) {
				emptyPolls += 1;
				await pause(signal);
				continue;
			}
			for (const row of rows) {
				signal.throwIfAborted();
				yield { id: `${feed}:${row.sequence}`, event: 'greeting', data: JSON.stringify(row.payload) };
				after = row.sequence;
			}
		}
	} finally {
		active -= 1;
	}
}

const app = http.create({
	routes: [
		http.route('GET', '/state', () => Response.json({ active, emptyPolls, maximumBatch })),
		http.route('GET', '/events', async (request) => {
			const state =
				(await database<{ tail: number; floor: number }[]>`select tail, floor from stream_feeds where id=${feed}`)[0]!;
			const cursor = request.headers.get('last-event-id');
			const prefix = `${feed}:`;
			const suffix = cursor?.startsWith(prefix) ? cursor.slice(prefix.length) : undefined;
			if (cursor !== null && (suffix === undefined || !/^(0|[1-9][0-9]*)$/.test(suffix))) {
				return Response.json({ error: 'Wrong feed or malformed cursor.' }, { status: 400 });
			}
			const after = suffix === undefined ? state.floor : Number(suffix);
			if (!Number.isSafeInteger(after) || after > state.tail) return new Response('Future cursor.', { status: 400 });
			if (after < state.floor) return new Response('History expired; obtain a snapshot.', { status: 410 });
			// This is a finite connection budget, not a limit on the durable feed.
			// A slow/disconnected client resumes from its own last applied event ID.
			const body = readable(events.write(readable(messages(after, request.signal)), {
				maximumBytes: 8192,
				maximumEventBytes: 512,
				maximumEvents: 16,
				signal: request.signal,
			}));
			return new Response(body, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' } });
		}),
	],
});

const listener = Deno.serve({
	hostname: '127.0.0.1',
	port: 0,
	onListen({ port }) {
		console.log(JSON.stringify({ port }));
	},
}, (request) => app.fetch(request));
const stop = () => {
	void listener.shutdown();
};
Deno.addSignalListener('SIGTERM', stop);
try {
	await listener.finished;
} finally {
	Deno.removeSignalListener('SIGTERM', stop);
	await database.end({ timeout: 2 });
}

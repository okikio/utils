/** An actual Node Fetch caller; its private CA is selected only at process startup. @module */
import process from 'node:process';
import * as context from '@okikio/context';
import * as duplex from '@okikio/activity/http/duplex';
import { attempt, Engine, Work } from './contracts.ts';
import type { InputType } from './contracts.ts';

const options = JSON.parse(process.env.DUPLEX_CALLER ?? '{}') as {
	url: string;
	token: string;
	input: InputType;
	scenario?: 'controls' | 'disconnect';
	timeoutMs?: number;
};
/** Emit one machine-readable receipt per line for the owning parent process. */
const send = (value: unknown) => console.log(JSON.stringify(value));
/** Keep a short causal chain so certificate rejection cannot be confused with a routing or auth failure. */
function diagnostic(value: unknown, depth = 0): string {
	if (depth > 3 || value === undefined) return '';
	if (!(value instanceof Error)) return String(value);
	return [value.name, value.message, 'code' in value ? String(value.code) : '', diagnostic(value.cause, depth + 1)]
		.filter(Boolean).join(': ');
}
await using ctx = context.create({ id: options.input.id });
// Only this original caller owns its cancellation. Parent commands do not invent a remote terminal receipt.
process.stdin.on('data', () => context.cancel(ctx, 'TLS caller cancelled'));
try {
	if (options.scenario) {
		const headers = {
			authorization: `Bearer ${options.token}`,
			'content-type': 'application/json',
			'x-okikio-activity-version': '2',
			'x-okikio-activity-operation': 'start',
		};
		const response = await fetch(options.url, {
			method: 'POST',
			headers,
			body: JSON.stringify(attempt(ctx, options.input)),
			signal: AbortSignal.timeout(10000),
		});
		if (!response.ok || !response.body) throw new Error(`Raw start failed: ${response.status}`);
		const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
		try {
			let buffer = '';
			let received = false;
			while (!received) {
				const chunk = await reader.read();
				if (chunk.done) throw new Error('The edge closed before the first authority request.');
				buffer += chunk.value;
				let end: number;
				while ((end = buffer.indexOf('\n')) >= 0) {
					const frame = JSON.parse(buffer.slice(0, end));
					buffer = buffer.slice(end + 1);
					if (frame.type !== 'call') continue;
					received = true;
					if (options.scenario === 'controls') {
						const fence = { session: frame.session, claimId: frame.claimId, generation: frame.generation };
						const statuses: number[] = [];
						for (const operation of ['reply', 'cancel'] as const) {
							const rejected = await fetch(options.url, {
								method: 'POST',
								headers: { ...headers, authorization: 'Bearer invalid', 'x-okikio-activity-operation': operation },
								body: JSON.stringify({
									...fence,
									type: operation,
									...(operation === 'reply'
										? { callId: frame.callId, reply: { type: 'heartbeat', accepted: true } }
										: {}),
								}),
								signal: AbortSignal.timeout(5000),
							});
							statuses.push(rejected.status);
							await rejected.body?.cancel();
						}
						send({ type: 'controls', statuses });
					}
				}
			}
		} finally {
			await reader.cancel();
		}
		send({ type: 'disconnected' });
	} else {
		const receipts = { heartbeats: [] as unknown[], permissions: [] as unknown[], effects: [] as unknown[] };
		const client = duplex.create({
			engine: Engine,
			activities: [Work],
			url: options.url,
			headers: () => ({ authorization: `Bearer ${options.token}` }),
			timeoutMs: options.timeoutMs ?? 12000,
			cleanupMs: 5000,
		});
		const result = await client.run(ctx, attempt(ctx, options.input), {
			async heartbeat(value) {
				receipts.heartbeats.push(value);
				send({ type: 'heartbeat' });
			},
			permission: {
				maximumChecks: 8,
				async check(_ctx, requests) {
					receipts.permissions.push(...requests.map((value) => value.target));
					return requests.map(() => ({ allowed: true }));
				},
			},
			effect: {
				async emit(_ctx, value) {
					receipts.effects.push(value.value);
				},
			},
		});
		send({
			type: 'result',
			result,
			receipts,
			...(result.type === 'lost' ? { diagnostic: diagnostic(result.reason) } : {}),
		});
	}
} finally {
	process.stdin.destroy();
}

/** Own a separate native Fetch process so test CA trust never alters the runner's global environment. @module */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import type { InputType } from './contracts.ts';

/** Retained caller receipts are plain checked-at-assertion values, not authority for container ownership. */
export interface Message {
	readonly type: string;
	readonly diagnostic?: string;
	readonly result?: { readonly type: string; readonly value?: unknown };
	readonly receipts?: { readonly heartbeats: unknown[]; readonly permissions: unknown[]; readonly effects: unknown[] };
	readonly statuses?: readonly number[];
}
/** Start one client; cancellation and response disconnect are exercised over actual TLS sockets. */
export function call(options: {
	readonly url: string;
	readonly token: string;
	readonly ca?: string;
	readonly input: InputType;
	readonly scenario?: 'controls' | 'disconnect';
	readonly timeoutMs?: number;
}) {
	const { ca, ...request } = options;
	const environment: NodeJS.ProcessEnv = {
		...process.env,
		NODE_TLS_REJECT_UNAUTHORIZED: '1',
		DUPLEX_CALLER: JSON.stringify(request),
	};
	// An untrusted control must not inherit trust from the surrounding shell.
	delete environment.NODE_EXTRA_CA_CERTS;
	const child = spawn(process.execPath, [fileURLToPath(new URL('./tls-caller.ts', import.meta.url))], {
		stdio: ['pipe', 'pipe', 'pipe'],
		env: { ...environment, ...(ca ? { NODE_EXTRA_CA_CERTS: ca } : {}) },
	});
	// A closed child can reject a cancellation write. The write callback owns that
	// rejection; observing the stream event prevents an unrelated uncaught EPIPE.
	child.stdin.on('error', () => undefined);
	const messages: Message[] = [];
	let output = '', errors = '', settled = false;
	child.stdout.setEncoding('utf8');
	child.stdout.on('data', (chunk: string) => {
		output += chunk;
		let end: number;
		while ((end = output.indexOf('\n')) >= 0) {
			messages.push(JSON.parse(output.slice(0, end)) as Message);
			output = output.slice(end + 1);
		}
	});
	child.stderr.on('data', (chunk) => {
		errors = (errors + String(chunk)).slice(-32768);
	});
	const timer = setTimeout(() => child.kill('SIGKILL'), 20000);
	const done = new Promise<Message[]>((resolve, reject) => {
		child.once('error', reject);
		child.once('close', (code, signal) => {
			clearTimeout(timer);
			settled = true;
			if (code !== 0 || signal) reject(new Error(`TLS caller stopped (${code ?? signal}): ${errors}`));
			else resolve(messages);
		});
	});
	void done.catch(() => undefined);
	return {
		messages,
		done,
		get settled() {
			return settled;
		},
		async cancel(): Promise<void> {
			await new Promise<void>((resolve, reject) => {
				child.stdin.write('cancel\n', (error) => error ? reject(error) : resolve());
			});
		},
		async [Symbol.asyncDispose]() {
			if (!settled) {
				const closed = once(child, 'close');
				child.kill('SIGKILL');
				await closed;
			}
			clearTimeout(timer);
		},
	};
}

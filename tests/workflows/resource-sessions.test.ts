/** Real persistent authority and actual native threads/child processes; no protocol or storage mocks. */
import { after, before, it } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import process from 'node:process';
import { expect } from '@std/expect';
import postgresjs from 'postgres';
import * as sessions from '@okikio/capability/resource/session';
import * as postgres from '@okikio/storage/session/postgres';
import * as workflows from '@okikio/storage/workflow/postgres';
import { checkHosts, checkSession, prepare, until } from '../fixtures/session-scenario.ts';

const url = process.env.UTILS_WORKFLOW_TEST_DATABASE_URL;
if (!url) throw new Error('Resource session checks requires an explicit disposable PostgreSQL database.');
const database = postgresjs(url, { max: 12, onnotice() {} });
before(async () => {
	await postgres.migrate({ database });
	await workflows.migrate({ database });
	await prepare(database);
});
after(async () => {
	await database.end({ timeout: 2 });
});

/** Own the process group; graceful stop proves finalization, failure cleanup kills only this fixture's group. */
async function start(namespace: string, kind: string, selection = false, delayed = false) {
	const child = spawn(process.execPath, [new URL('../fixtures/session-coordinator.ts', import.meta.url).pathname], {
		cwd: new URL('../../', import.meta.url),
		detached: true,
		stdio: ['ignore', 'pipe', 'pipe'],
		env: {
			...process.env,
			DATABASE_URL: url,
			SESSION_NAMESPACE: namespace,
			POOL_SELECTION: selection ? '1' : '0',
			SESSION_DELAY_PUBLICATION: delayed ? '1' : '0',
			SESSION_KIND: kind,
		},
	});
	// Keep only recent startup and failure text; a noisy child must not grow the
	// coordinator's retained output without bound during a recovery drill.
	let output = '';
	let diagnostic = '';
	child.stdout!.on('data', (value) => {
		output = (output + String(value)).slice(-8192);
	});
	child.stderr!.on('data', (value) => {
		diagnostic = (diagnostic + String(value)).slice(-32768);
	});
	/** Every caller joins the same shutdown, including scope disposal after a failed assertion. */
	let stopping: Promise<void> | undefined;
	const stop = () =>
		stopping ??= (async () => {
			if (child.exitCode !== null || child.signalCode !== null) return;
			const exited = once(child, 'exit');
			child.kill('SIGTERM');
			const force = setTimeout(() => {
				try {
					process.kill(-child.pid!, 'SIGKILL');
				} catch { /* The owned group already exited. */ }
			}, 10000);
			try {
				await exited;
			} finally {
				clearTimeout(force);
			}
		})();
	try {
		await until(async () => {
			if (child.exitCode !== null || child.signalCode !== null) throw new Error(diagnostic);
			return /session-ready:\d+/u.test(output);
		});
	} catch (error) {
		await stop();
		throw new Error(`Session coordinator failed: ${diagnostic}`, { cause: error });
	}
	return { origin: `http://127.0.0.1:${/session-ready:(\d+)/u.exec(output)![1]}`, stop, [Symbol.asyncDispose]: stop };
}

it('serializes independent SQL session authorities and rejects late expired renewal', async () => {
	const namespace = crypto.randomUUID();
	const a = sessions.registry(postgres.open({ database, namespace }));
	const b = sessions.registry(postgres.open({ database, namespace }));
	const reference = {
		id: crypto.randomUUID(),
		resource: 'counter',
		owner: { id: 'process:one', generation: 1 },
		incarnation: crypto.randomUUID(),
	};
	await a.create(reference, { leaseMs: 1000, borrowMs: 90, idleMs: 1000, maximumBorrows: 1 });
	const outcomes = await Promise.allSettled([a.borrow(reference), b.borrow(reference)]);
	expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
	await until(async () => (await b.inspect(reference.id))!.state === 'lost');
	await expect(a.renew(reference)).rejects.toMatchObject({ code: 'lost' });
	await expect(b.borrow(reference)).rejects.toMatchObject({ code: 'lost' });
	await a.remove(reference.id);
	expect(await b.inspect(reference.id)).toBeUndefined();
});

for (const kind of ['thread', 'process']) {
	it(`recovers an actual ${kind} after a crash when initial session publication crosses renewal ticks`, {
		timeout: 60000,
		skip: process.platform === 'win32',
	}, async () => {
		const namespace = crypto.randomUUID();
		await using host = await start(namespace, kind, false, true);
		await checkSession({
			...host,
			namespace,
			kind,
			database,
			registry: sessions.registry(postgres.open({ database, namespace })),
		});
	});
	it(`tests leased resource sessions through memory and durable nested work on an actual ${kind}`, {
		timeout: 60000,
		skip: process.platform === 'win32',
	}, async () => {
		const namespace = crypto.randomUUID();
		await using host = await start(namespace, kind);
		await checkSession({
			...host,
			namespace,
			kind,
			database,
			registry: sessions.registry(postgres.open({ database, namespace })),
		});
	});
}

for (const kind of ['thread', 'process']) {
	it(`selects and retires one physical ${kind} in a multi-host provider through nested memory and durable work`, {
		skip: process.platform === 'win32',
	}, async () => {
		const namespace = crypto.randomUUID();
		await using host = await start(namespace, kind, true);
		await checkHosts({
			...host,
			kind,
			database,
			namespace,
			registry: sessions.registry(postgres.open({ database, namespace })),
		});
	});
}

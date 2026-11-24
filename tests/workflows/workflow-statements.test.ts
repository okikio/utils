/**
 * Every statement of the workflow store matches its committed SQL, and PostgreSQL describes each one against the
 * installed schema. Set `UPDATE_SQL=1` to rewrite `workflow/postgres/statements.sql` after an intended change, then
 * review the diff.
 */
import { after, before, describe, it } from 'node:test';
import { expect } from '@std/expect';
import { readFileSync, writeFileSync } from 'node:fs';
import postgres from 'postgres';
import * as sql from '@okikio/sql/postgres';
import { temporal } from '@okikio/duration/temporal';
import * as store from '@okikio/storage/workflow/postgres';
import * as tables from '../../packages/storage/workflow/postgres/schema/mod.ts';
import * as groups from '../../packages/storage/workflow/postgres/statements/mod.ts';

const url = process.env.UTILS_WORKFLOW_TEST_DATABASE_URL;
if (!url) throw new Error('Statement checks require a disposable PostgreSQL database.');
const client = postgres(url, { max: 2, onnotice() {} });
before(async () => {
	await store.migrate({ database: client });
});
after(async () => {
	await client.end({ timeout: 2 });
});

const { chain, cleanups, history, hosts, inspect, jobs, maintenance, runs, shared } = groups;
const committed = new URL('../../packages/storage/workflow/postgres/statements.sql', import.meta.url);

/** Sample values; `describe` never sends them. */
const ns = 'n';
const id = '00000000-0000-0000-0000-000000000001';
const other = '00000000-0000-0000-0000-000000000002';
const at = temporal.Instant.fromEpochMilliseconds(0);
const definition = { kind: 'workflow' as const, id: 'd', version: '1' };
const host = { id: 'h', generation: 1 };
const claim = { generation: 1, host: 'h', hostGeneration: 1 };
const run = {
	namespace: ns,
	id,
	scope: 's',
	key: 'k',
	kind: 'workflow' as const,
	definition: 'd',
	version: '1',
	input: {},
	fingerprint: 'f',
	policy: {},
	policyhash: 'p',
	state: 'ready' as const,
	family: id,
	parent: null,
	cancellation: 'independent',
	reservation: {},
	trace: null,
	location: null,
};

/** Helpers that build expressions or hold constants rather than statements. */
const helpers = new Set([
	'shared.live',
	'shared.clock',
	'shared.after',
	'shared.keys',
	'runs.row',
	'jobs.row',
	'maintenance.order',
]);

const catalog: sql.CatalogType = {
	'migration.lock': tables.migrationLock,
	'migration.registration': tables.registrationLock,
	'migration.present': tables.present,
	'migration.stored': tables.stored,
	'migration.activeHost': tables.activeHost,
	'migration.lockTimeout': tables.lockTimeout,
	'migration.installed': tables.installed,
	...Object.fromEntries(tables.prepare.map((item, index) => [`migration.prepare.${index}`, item])),
	...Object.fromEntries(tables.install.map((item, index) => [`migration.install.${index}`, item])),
	'shared.named': shared.named(ns, shared.keys.admission),
	'shared.history': shared.history(ns, id),
	'shared.due': shared.due(at),
	'shared.later': shared.later(1000),
	...Object.fromEntries(shared.limits().map((item, index) => [`shared.limits.${index}`, item])),
	'runs.run': runs.run(ns, id),
	'runs.run.locked': runs.run(ns, id, true),
	'runs.keyed': runs.keyed(ns, { scope: 's', kind: 'workflow', definition: 'd', key: 'k' }),
	'runs.usage': runs.usage(ns, { id: 'p', version: '1' }),
	'runs.addSuccessor': runs.addSuccessor(ns, id),
	'runs.addChild': runs.addChild(ns, id),
	'runs.children': runs.children(ns, id, definition),
	'runs.admit': runs.admit(run),
	'runs.activations': runs.activations(ns, 'h'),
	'runs.ready': runs.ready(ns, [definition]),
	'runs.advance': runs.advance(ns, id, { ...claim, lease: 1000 }),
	'runs.activation': runs.activation(ns, id, claim),
	'runs.extend': runs.extend(ns, id, 1000),
	'runs.rest': runs.rest(ns, id, 'waiting'),
	'runs.wake': runs.wake(ns, id),
	'runs.wake.state': runs.wake(ns, id, false),
	'runs.block': runs.block(ns, id, 'r'),
	'runs.block.release': runs.block(ns, id, 'r', true),
	'runs.note': runs.note(ns, id, 'r'),
	'runs.settle': runs.settle(ns, id, {}),
	'runs.close': runs.close(ns, id, 'completed'),
	'runs.control': runs.control(ns, id, true, 1),
	'runs.repair': runs.repair(ns, id, 'waiting'),
	'jobs.add': jobs.add({
		namespace: ns,
		id,
		run: id,
		path: 'p',
		definition: {},
		input: {},
		rules: {},
		state: 'ready',
		budget: 1,
		finalizer: false,
		location: null,
		affinity: null,
	}),
	'jobs.slots': jobs.slots(ns, 'h'),
	'jobs.occupied': jobs.occupied(ns, { id: 'c', generation: 1 }),
	'jobs.candidates': jobs.candidates(ns, { definitions: [definition], lineage: [], affinity: {} }),
	'jobs.candidates.finalizer': jobs.candidates(ns, { definitions: [], lineage: [], affinity: {}, finalizer: true }),
	'jobs.due': jobs.due(ns, id),
	'jobs.claim': jobs.claim(ns, id, { sequence: 1, ...claim, lease: 1000, deadline: 2000 }),
	'jobs.start': jobs.start(ns, id, 1, 1),
	'jobs.guard': jobs.guard(ns, { job: id, run: other, ...claim }),
	'jobs.extend': jobs.extend(ns, id, 1000),
	'jobs.at': jobs.at(ns, id, 'finalizer'),
	'jobs.revokeAttempts': jobs.revokeAttempts(ns, id, { prefix: 'p/' }),
	'jobs.revokeAttempts.ordinary': jobs.revokeAttempts(ns, id, { ordinary: true }),
	'jobs.revoke': jobs.revoke(ns, id, { prefix: 'p/' }, {}),
	'jobs.cancelAttempts': jobs.cancelAttempts(ns, id, {}),
	'jobs.cancel': jobs.cancel(ns, id, {}),
	'jobs.settle': jobs.settle(ns, id, 1, 'success', {}),
	'jobs.abandon': jobs.abandon(ns, id, 1),
	'jobs.block': jobs.block(ns, id, {}),
	'jobs.retry': jobs.retry(ns, id, {}, 1000),
	'jobs.finish': jobs.finish(ns, id, 'completed', {}),
	'jobs.lostClaims': jobs.lostClaims(ns, 10),
	'jobs.lostClaim': jobs.lostClaim(ns, id),
	'jobs.repairable': jobs.repairable(ns, id),
	'jobs.restart': jobs.restart(ns, id, 1),
	'hosts.node': hosts.node(ns, 'c'),
	'hosts.saveNode': hosts.saveNode(ns, { id: 'c', generation: 1, value: {} }),
	'hosts.nodeShare': hosts.nodeShare(ns, 'c'),
	'hosts.register': hosts.register({
		namespace: ns,
		id: 'h',
		definitions: [],
		engine: 'e',
		activations: 1,
		activities: 1,
		lease: 1000,
		compute: [],
		affinity: {},
	}),
	'hosts.lineage': hosts.lineage(ns, host),
	'hosts.placement': hosts.placement(ns, 'h'),
	'hosts.guard': hosts.guard(ns, host, 'share'),
	'hosts.guard.update': hosts.guard(ns, host, 'update'),
	'hosts.renew': hosts.renew(ns, host, 1000),
	'hosts.drain': hosts.drain(ns, host),
	'history.instruction': history.instruction(ns, id, 'p'),
	'history.race': history.race(ns, id, 'p'),
	'history.count': history.count(ns, id),
	'history.count.roots': history.count(ns, id, null),
	'history.count.nested': history.count(ns, id, 'p'),
	'history.add': history.add({
		namespace: ns,
		run: id,
		path: 'p',
		fingerprint: 'f',
		type: 'sleep',
		job: null,
		child: null,
		due: at,
		discard: false,
		outcome: null,
		bytes: 1,
		event: null,
		event_key: null,
		parent: null,
		branches: null,
	}),
	'history.record': history.record(ns, id, 'p', {}, 1),
	'history.outcomes': history.outcomes(ns, id, ['p']),
	'history.waiting': history.waiting(ns, id, 'e', 'k'),
	'history.abandoned': history.abandoned(ns, id, 'p/'),
	'history.pending': history.pending(ns, id, 'p'),
	'history.wakeable': history.wakeable(ns, 10),
	'history.event': history.event(ns, id, 'e', 'k'),
	'history.deliver': history.deliver({
		namespace: ns,
		run: id,
		event: 'e',
		key: 'k',
		value: {},
		fingerprint: 'f',
		bytes: 1,
	}),
	'history.received': history.received(ns, id, 'e', 'k'),
	'history.received.before': history.received(ns, id, 'e', 'k', at),
	'history.report': history.report(ns, id, other, 'e'),
	'history.saveReport': history.saveReport({
		namespace: ns,
		run: id,
		job: other,
		effect: 'e',
		generation: 1,
		sequence: 1,
		attempt: 1,
		revision: id,
		occurrence: {},
		bytes: 1,
	}),
	'history.reports': history.reports(ns, { id, scope: 's' }, false),
	'history.reports.children': history.reports(ns, { id, scope: 's' }, true),
	'cleanups.defer': cleanups.defer({ namespace: ns, run: id, path: 'p', scope: null, request: {} }),
	'cleanups.unfinished': cleanups.unfinished(ns, id),
	'cleanups.unfinished.scope': cleanups.unfinished(ns, id, 's'),
	'cleanups.queue': cleanups.queue(ns, id),
	'cleanups.queue.scope': cleanups.queue(ns, id, 's'),
	'cleanups.start': cleanups.start(ns, id, 'p', { job: other, child: null }),
	'cleanups.end': cleanups.end(ns, id, 'p', 'completed', {}),
	'cleanups.of': cleanups.of(ns, id, other),
	'cleanups.failedChild': cleanups.failedChild(ns, id),
	'cleanups.state': cleanups.state(ns, id, 'p'),
	'cleanups.finished': cleanups.finished(ns, 10),
	'cleanups.receipt': cleanups.receipt(ns, id, 'k'),
	'cleanups.save': cleanups.save({ namespace: ns, job: id, key: 'k', contract: 'c', fingerprint: 'f', value: {} }),
	'cleanups.decide': cleanups.decide({
		namespace: ns,
		id,
		run: other,
		epoch: 1,
		actor: 'a',
		reason: 'r',
		action: 'pause',
	}),
	'chain.busy': chain.busy(ns, { id, family: other }),
	'chain.request': chain.request(ns, id, {}),
	'chain.next': chain.next(ns, id, { id: other, input: {}, fingerprint: 'f' }),
	'chain.link': chain.link(ns, id, other),
	'maintenance.next': maintenance.next(ns),
	'maintenance.next.filtered': maintenance.next(ns, {
		workflows: [definition],
		activities: [],
		finalizers: [definition],
	}),
	'maintenance.expired': maintenance.expired(ns, 10),
	'maintenance.orphans': maintenance.orphans(ns, 10),
	'maintenance.family': maintenance.family(ns),
	'maintenance.more': maintenance.more(ns),
	...Object.fromEntries(
		maintenance.order.map((table) => [`maintenance.purge.${table.name}`, maintenance.purge(table, ns, id, 10)]),
	),
	'maintenance.prune': maintenance.prune(ns, id, 10),
	'inspect.timeout': inspect.timeout,
	'inspect.observed': inspect.observed,
	'inspect.owner': inspect.owner(ns, { id, scope: 's', definition }),
	'inspect.jobPage': inspect.jobPage(ns, id, null, 11),
	'inspect.jobPage.after': inspect.jobPage(ns, id, other, 11),
	'inspect.totals': inspect.totals(ns, id),
	'inspect.job': inspect.job(ns, id, other),
	'inspect.attemptPage': inspect.attemptPage(ns, id, { job: other, after: { job: other, generation: 1 }, limit: 11 }),
	'inspect.waitPage': inspect.waitPage(ns, id, 'p', 11),
	'inspect.progressPage': inspect.progressPage(ns, id, { job: other, effect: 'e' }, 11),
	'inspect.historyRange': inspect.historyRange(ns, id),
	'inspect.historyPage': inspect.historyPage(ns, id, 1, 11),
	'inspect.queuePage': inspect.queuePage(ns, 's', ['ready'], { created: at, id }, 11),
	'inspect.queueTotals': inspect.queueTotals(ns, 's', ['ready']),
	'inspect.queueDue': inspect.queueDue(ns, 's', ['ready']),
	'inspect.hostPage': inspect.hostPage(ns, 'h', 11),
};

describe('workflow statements', () => {
	it('covers every statement the modules export', () => {
		const covered = new Set(Object.keys(catalog).map((key) => key.split('.').slice(0, 2).join('.')));
		const exported = Object.entries(groups).flatMap(([group, module]) =>
			Object.keys(module).map((name) => `${group}.${name}`)
		);
		expect(exported.filter((key) => !covered.has(key) && !helpers.has(key))).toEqual([]);
	});

	it('match the committed SQL', () => {
		const text = sql.render(catalog);
		if (process.env.UPDATE_SQL === '1') writeFileSync(committed, text);
		expect(text).toBe(readFileSync(committed, 'utf8'));
	});

	it('parse, plan and return their declared columns against the installed schema', async () => {
		const problems = await sql.describe(catalog, async (text) => {
			const found = await client.unsafe(text).describe();
			return { parameters: found.types.length, columns: found.columns.map((column) => column.name) };
		});
		expect(problems).toEqual([]);
	});
});

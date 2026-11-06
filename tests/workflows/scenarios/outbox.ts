/** Real dispatcher failpoint: the parent kills this process after a committed claim or sink transaction. @module */
import process from 'node:process';
import postgres from 'postgres';
import * as outbox from '@okikio/storage/outbox/postgres';

const url = process.env.OUTBOX_DATABASE_URL;
const namespace = process.env.OUTBOX_NAMESPACE;
const phase = process.env.OUTBOX_PHASE;
if (!url || !namespace || !['staged', 'claimed', 'accepted'].includes(phase ?? '')) {
	throw new TypeError('Missing outbox crash fixture settings.');
}
const database = postgres(url, { max: 1, onnotice() {} });
const box = outbox.open({ database, namespace });
if (!process.send) throw new Error('Parent IPC channel is required.');
process.on('message', () => {});

if (phase === 'staged') {
	await database.begin(async (tx) => {
		await box.append(tx, { id: 'crash', key: 'one', value: 'one' });
		await tx`insert into outbox_fixture values (${namespace},'uncommitted')`;
		process.send!({ phase });
		// Deliberately leave the transaction open. Losing this physical process
		// must roll back both writes; the parent owns killing and joining it.
		await new Promise<never>(() => {});
	});
}
const claim = (await box.claim({ leaseMs: 150 }))[0];
if (!claim) throw new Error('Dispatcher did not receive the fixture message.');

if (phase === 'accepted') {
	// The sink owns this separate transaction. Its receipt and business write
	// commit together, while the outbox remains leased in the killed process.
	await database.begin(async (tx) => {
		const inserted =
			await tx`insert into outbox_inbox values (${namespace},${claim.id},${claim.key}) on conflict do nothing returning key`;
		if (inserted.length) await tx`insert into outbox_fixture values (${namespace},'one')`;
	});
}
// Keep the process reachable until the parent deliberately kills it. No finally
// can acknowledge a claim or compensate a sink after SIGKILL.
process.send({ phase });

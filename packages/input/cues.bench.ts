/** Playback coordination cost for 1/100 optional cues, plus rapid supersession; no physical-device latency is measured. @module */
import { deepStrictEqual, strictEqual } from 'node:assert';
import { bench, do_not_optimize, group } from 'mitata';
import * as feedback from './feedback.ts';
import { run } from './fixtures/bench.ts';

const cue = feedback.define({ message: 'Saved', tone: {}, rumble: {}, brightness: {} });

/** Each player represents a separate interaction scope. No device allocation is allowed by the disabled policy. */
async function independent(count: number, enabled: boolean): Promise<readonly feedback.CueResult[]> {
	const players = Array.from({ length: count }, () => feedback.create({ status: { announce() {} } }));
	try {
		return await Promise.all(players.map((player) => player.play(cue, { enabled })));
	} finally {
		await Promise.all(players.map((player) => player.disposeAsync()));
	}
}

/** A burst on one scope must admit only the newest playback, even when all requests arrive in one turn. */
async function burst(count: number): Promise<readonly PromiseSettledResult<feedback.CueResult>[]> {
	await using player = feedback.create({});
	return await Promise.allSettled(Array.from({ length: count }, () => player.play(cue, { enabled: false })));
}

for (const count of [1, 100]) {
	const disabled = await independent(count, false);
	strictEqual(disabled.length, count);
	for (const result of disabled) {
		deepStrictEqual(result, {
			announced: true,
			rumble: { status: 'unavailable', reason: 'disabled' },
			tone: { status: 'unavailable', reason: 'disabled' },
			brightness: { status: 'unavailable', reason: 'disabled' },
		});
	}
	const enabled = await independent(count, true);
	for (const result of enabled) {
		strictEqual(result.announced, true);
		for (const outcome of [result.rumble, result.tone, result.brightness]) {
			deepStrictEqual(outcome, { status: 'unavailable', reason: 'unsupported' });
		}
	}
	const superseded = await burst(count);
	strictEqual(superseded.filter((result) => result.status === 'fulfilled').length, 1);
	strictEqual(superseded.filter((result) => result.status === 'rejected').length, count - 1);
	group(`${count} interaction scopes; warm frozen cue, player construction and disposal included`, () => {
		bench('disabled optional effects with retained text', async () => do_not_optimize(await independent(count, false)));
		bench(
			'enabled optional effects without available devices',
			async () => do_not_optimize(await independent(count, true)),
		);
		bench('direct primitive absence checks; no status, player or supersession policy', async () => {
			for (let index = 0; index < count; index++) {
				do_not_optimize(
					await Promise.all([feedback.tone(undefined), feedback.rumble(undefined), feedback.brightness(undefined)]),
				);
			}
		});
		bench('one scope supersession burst', async () => do_not_optimize(await burst(count)));
	});
}

await run();

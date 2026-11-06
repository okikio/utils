/** Native MessagePort round trips; compare validation/cleanup policy with raw stop-and-wait transport. @module */
import { deepStrictEqual, strictEqual } from 'node:assert';
import { bench, do_not_optimize, group } from 'mitata';
import * as context from '@okikio/context';
import * as stream from './stream/mod.ts';
import { run } from './fixtures/bench.ts';

for (const count of [16, 128]) {
	const policy = { maximumChunkBytes: 1024, maximumChunks: count, maximumBytes: count * 1024 };
	const consume = async function (verify = false): Promise<number> {
		await using owner = context.create({ id: 'stream-bench' });
		const { port1, port2 } = new MessageChannel();
		await using producer = stream.serve(owner, port1, async function* () {
			for (let index = 0; index < count; index++) yield new Uint8Array(1024).fill(index % 251);
		}, policy);
		await using receiver = stream.open(owner, port2, { ...policy, id: 'bytes', timeout: 10000 });
		let total = 0;
		let index = 0;
		for await (const bytes of receiver.readable) {
			if (verify) deepStrictEqual(bytes, new Uint8Array(1024).fill(index % 251));
			index++;
			total += bytes.byteLength;
		}
		strictEqual((await receiver.closed).status, 'complete');
		await producer.closed;
		return total;
	};
	/** Fixture baseline preserves one-credit pacing but deliberately lacks policy validation and joined source cleanup. */
	const native = async function (verify = false): Promise<number> {
		const { port1, port2 } = new MessageChannel();
		let index = 0;
		port1.addEventListener('message', () => {
			if (index === count) {
				port1.postMessage(null);
				port1.close();
			} else {
				const bytes = new Uint8Array(1024).fill(index++ % 251);
				port1.postMessage(bytes, [bytes.buffer]);
			}
		});
		port1.start();
		port2.start();
		let total = 0;
		let received = 0;
		try {
			while (true) {
				const next = new Promise<Uint8Array | null>((resolve) =>
					port2.addEventListener('message', (event) => resolve(event.data), { once: true })
				);
				port2.postMessage('pull');
				const bytes = await next;
				if (bytes === null) return total;
				if (verify) deepStrictEqual(bytes, new Uint8Array(1024).fill(received % 251));
				received++;
				total += bytes.byteLength;
			}
		} finally {
			port1.close();
			port2.close();
		}
	};
	strictEqual(await consume(true), count * 1024);
	strictEqual(await native(true), count * 1024);
	group(`dedicated MessagePort ${count} x 1 KiB; one receive credit`, () => {
		bench('validated versioned budgets and joined cleanup', async () => do_not_optimize(await consume()));
		bench('raw credit transport; no validation or cleanup receipt', async () => do_not_optimize(await native()));
	});
}
await run();

import {
	Channel as StdChannel,
	ChannelClosedError,
	type ChannelOptions,
	type ChannelReceiveOptions,
	type ChannelSendOptions,
} from '@std/async';

/**
 * Bounded asynchronous channel with explicit iteration and disposal contracts.
 *
 * `@std/async` owns buffering, FIFO delivery, and backpressure. This adapter
 * owns the lifecycle surface the application's generic pipelines require across Deno and
 * Node type-checking: async iteration drains until a normal close, while a
 * close reason remains observable as a consumer failure.
 */
export class Channel<T> implements AsyncIterable<T>, AsyncDisposable {
	readonly #channel: StdChannel<T>;
	/** Only an argument-free close means successful iterator completion. */
	#normalClose = false;

	/** Create a channel with the upstream buffer and waiter limits selected by the caller. */
	constructor(options?: ChannelOptions) {
		this.#channel = new StdChannel<T>(options);
	}

	/** Send one value, waiting while the bounded buffer is full. */
	send(value: T, options?: ChannelSendOptions): Promise<void> {
		return this.#channel.send(value, options);
	}

	/** Receive one value from the channel. */
	receive(options?: ChannelReceiveOptions): Promise<T> {
		return this.#channel.receive(options);
	}

	/** Attempt to send without waiting for buffer capacity. */
	trySend(value: T): boolean {
		return this.#channel.trySend(value);
	}

	/** Close normally, or retain the exact supplied failure reason, including undefined. The first close wins. */
	close(...args: [] | [reason: unknown]): void {
		if (this.#channel.closed) return;
		this.#normalClose = args.length === 0;
		if (args.length === 0) this.#channel.close();
		else this.#channel.close(args[0]);
	}

	/** Read values in channel order until closure; iteration borrows the channel lifetime. */
	async *[Symbol.asyncIterator](): AsyncIterableIterator<T> {
		while (true) {
			let value: T;
			try {
				value = await this.#channel.receive();
			} catch (error) {
				if (this.#normalClose && error instanceof ChannelClosedError) return;
				throw error;
			}
			yield value;
		}
	}

	/** Close the channel normally, releasing blocked senders and receivers. */
	async [Symbol.asyncDispose](): Promise<void> {
		this.close();
	}
}

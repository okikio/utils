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

	/** Close the channel. A supplied reason is propagated to consumers. */
	close(reason?: unknown): void {
		if (reason === undefined) this.#channel.close();
		else this.#channel.close(reason);
	}

	async *[Symbol.asyncIterator](): AsyncIterableIterator<T> {
		while (true) {
			try {
				yield await this.#channel.receive();
			} catch (error) {
				if (error instanceof ChannelClosedError) return;
				throw error;
			}
		}
	}

	async [Symbol.asyncDispose](): Promise<void> {
		this.#channel.close();
	}
}

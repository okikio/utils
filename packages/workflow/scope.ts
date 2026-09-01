import '@okikio/dispose/polyfill';
import type { Cause } from './kernel.ts';

/** Maximum live child branches one scope may own concurrently. @internal */
export const MAX_ACTIVE_CHILDREN = 64;

/** Child lifecycle owned by one workflow execution scope. */
export interface ScopeChild {
	cancel(reason: unknown): Promise<void>;
	settled(): Promise<void>;
}

/**
 * Owns child branches and asynchronous resources for one live branch.
 *
 * Children stop before resources are disposed. Resource cleanup uses the
 * ECMAScript `AsyncDisposableStack` contract, so `use`, `adopt`, and `defer`
 * share one last-in, first-out lifetime.
 */
export class Scope {
	readonly #children = new Set<ScopeChild>();
	readonly #resources = new AsyncDisposableStack();
	#closing?: Promise<readonly Cause[]>;
	#closed = false;

	/** Add an owned child that must become terminal before this scope closes. */
	addChild(child: ScopeChild): void {
		if (this.#closed || this.#closing !== undefined) throw new Error('Cannot add a child after scope closure starts.');
		if (this.#children.size >= MAX_ACTIVE_CHILDREN) {
			throw new RangeError(`Workflow scope cannot own more than ${MAX_ACTIVE_CHILDREN} active children.`);
		}
		this.#children.add(child);
		void child.settled().then(
			() => this.#children.delete(child),
			() => this.#children.delete(child),
		);
	}

	/** Register asynchronous cleanup in this scope. */
	defer(dispose: () => void | PromiseLike<void>): void {
		if (this.#closed || this.#closing !== undefined) throw new Error('Cannot defer cleanup after scope closure starts.');
		this.#resources.defer(dispose);
	}

	/** Transfer ownership of one disposable value into this scope. */
	use<Value extends Disposable | AsyncDisposable | null | undefined>(value: Value): Value {
		if (this.#closed || this.#closing !== undefined) throw new Error('Cannot add a resource after scope closure starts.');
		return this.#resources.use(value);
	}

	/** Transfer ownership of an arbitrary value with explicit cleanup. */
	adopt<Value>(value: Value, dispose: (value: Value) => void | PromiseLike<void>): Value {
		if (this.#closed || this.#closing !== undefined) throw new Error('Cannot adopt a resource after scope closure starts.');
		return this.#resources.adopt(value, dispose);
	}

	/** Cancel all children, await them, then dispose owned resources. */
	close(reason: unknown): Promise<readonly Cause[]> {
		if (this.#closing !== undefined) return this.#closing;
		this.#closing = this.#close(reason);
		return this.#closing;
	}

	async #close(reason: unknown): Promise<readonly Cause[]> {
		const causes: Cause[] = [];
		const children = [...this.#children];
		await Promise.all(children.map(async (child) => {
			try { await child.cancel(reason); }
			catch (failure) { causes.push(Object.freeze({ type: 'failure', failure })); }
		}));
		const settled = await Promise.allSettled(children.map((child) => child.settled()));
		for (const result of settled) {
			if (result.status === 'rejected') causes.push(Object.freeze({ type: 'failure', failure: result.reason }));
		}
		try {
			await this.#resources.disposeAsync();
		} catch (failure) {
			causes.push(Object.freeze({ type: 'failure', failure }));
		}
		this.#closed = true;
		return Object.freeze(causes);
	}
}

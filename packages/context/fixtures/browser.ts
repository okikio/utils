/** Native browser consumers for Context events and local progress observation. @module */
import { isObservableError, map, pipe } from '@okikio/observables';
import * as events from '../events.ts';
import * as state from '../state.ts';

/** Fail where the browser-visible observation or resource contract changes. */
function assert(value: unknown, message: string): asserts value {
	if (!value) throw new Error(message);
}

/** Exercise native event payloads, Observable composition, borrowed targets and disposal. */
export async function verify(): Promise<readonly string[]> {
	const checks: string[] = [];
	const element = document.createElement('button');
	document.body.append(element);
	const screen = new AbortController();
	const progress = state.create(0);
	const completion = Promise.withResolvers<void>();
	const values: number[] = [];
	const changes = pipe(progress.reader.changes, map(({ value }) => value * 10)).subscribe({
		next(value) {
			if (isObservableError(value)) completion.reject(value);
			else values.push(value);
		},
		error: completion.reject,
		complete: completion.resolve,
	});
	let delivered = 0;
	let completed = 0;
	let borrowed = 0;
	const borrowedListener = () => borrowed++;
	element.addEventListener('keydown', borrowedListener);
	const keys = events.from({ signal: screen.signal }, element, 'keydown').subscribe({
		next(event) {
			// Assignment exercises the actual DOM typing used by this consumer.
			const key: KeyboardEvent = event;
			assert(key.key === 'j', 'Native keyboard payload was not retained.');
			delivered++;
			progress.set(delivered);
		},
		error: completion.reject,
		complete: () => completed++,
	});
	try {
		element.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' }));
		screen.abort();
		element.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' }));
		assert(delivered === 1 && keys.closed && completed === 1, 'Context abort did not close native observation.');
		assert(borrowed === 2, 'Context observation removed a caller-owned listener.');
		checks.push('context native KeyboardEvent and borrowed EventTarget lifetime');
		progress[Symbol.dispose]();
		await completion.promise;
		assert(
			values.length === 1 && values[0] === 10 && changes.closed,
			'State operator pipeline lost changes or completion.',
		);
		assert(
			!('emit' in progress.reader.changes) && !('close' in progress.reader.changes),
			'Reader exposed mutation authority.',
		);
		checks.push('context Observable progress pipeline and read-only runtime authority');

		let once = 0;
		const onceObserver = events.from({ signal: new AbortController().signal }, element, 'click', { once: true })
			.subscribe({
				next() {
					once++;
					element.dispatchEvent(new PointerEvent('click'));
				},
			});
		try {
			element.dispatchEvent(new PointerEvent('click'));
			assert(once === 1 && onceObserver.closed, 'Reentrant native click escaped once ownership.');
			checks.push('context once listener detaches before reentrant native dispatch');
		} finally {
			onceObserver.unsubscribe();
		}
		return checks;
	} finally {
		screen.abort();
		keys.unsubscribe();
		progress[Symbol.dispose]();
		changes.unsubscribe();
		element.removeEventListener('keydown', borrowedListener);
		element.remove();
	}
}

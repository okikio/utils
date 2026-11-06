import type { Observable } from '@okikio/observables';
import * as events from './events.ts';
import * as state from './state.ts';

/** Compile real DOM overloads and minimal typed mocks without executing a browser in a type test. */
function eventTypes(
	ctx: { signal: AbortSignal },
	element: HTMLElement,
	document: Document,
	window: Window,
	worker: Worker,
	socket: WebSocket,
	file: FileReader,
): void {
	const keys: Observable<KeyboardEvent> = events.from(ctx, element, 'keydown');
	const pointer: Observable<PointerEvent> = events.from(ctx, document, 'pointerdown');
	const storage: Observable<StorageEvent> = events.from(ctx, window, 'storage');
	const windowError: Observable<ErrorEvent> = events.from(ctx, window, 'error');
	const documentError: Observable<ErrorEvent> = events.from(ctx, document, 'error');
	const elementError: Observable<ErrorEvent> = events.from(ctx, element, 'error');
	const workerError: Observable<ErrorEvent> = events.from(ctx, worker, 'error');
	const socketError: Observable<Event> = events.from(ctx, socket, 'error');
	const fileError: Observable<ProgressEvent<FileReader>> = events.from(ctx, file, 'error');
	const mock: events.Source<{ count: number }> = {
		addEventListener() {},
		removeEventListener() {},
	};
	const counts: Observable<{ count: number }> = events.from(ctx, mock, 'count');
	const mockErrors: Observable<{ count: number }> = events.from(ctx, mock, 'error');
	const legacyMock: events.Source<string | Event> & {
		onerror: (event: string | Event, source?: string, line?: number, column?: number, error?: Error) => void;
	} = { addEventListener() {}, removeEventListener() {}, onerror() {} };
	const legacyErrors: Observable<string | Event> = events.from(ctx, legacyMock, 'error');
	const plain = events.from(ctx, new EventTarget(), 'custom');
	const native: Observable<Event> = plain;
	void keys;
	void pointer;
	void storage;
	void windowError;
	void documentError;
	void elementError;
	void workerError;
	void socketError;
	void fileError;
	void counts;
	void mockErrors;
	void legacyErrors;
	// @ts-expect-error A structural mock retains its own payload even when its onerror signature looks legacy.
	const wrongMock: Observable<ErrorEvent> = events.from(ctx, legacyMock, 'error');
	void wrongMock;
	// @ts-expect-error An ordinary WebSocket error listener does not imply ErrorEvent details.
	const wrongSocket: Observable<ErrorEvent> = events.from(ctx, socket, 'error');
	void wrongSocket;
	void native;
	plain.subscribe((event) => {
		// @ts-expect-error A generic EventTarget does not imply keyboard fields.
		const key: string = event.key;
		void key;
	});
	// @ts-expect-error A keyboard event must not be widened or incorrectly inferred as PointerEvent.
	const wrong: Observable<PointerEvent> = events.from(ctx, element, 'keydown');
	void wrong;
	const cell = state.create(0);
	const changes: Observable<state.Change<number>> = cell.reader.changes;
	void changes;
	// @ts-expect-error The Observable facade exposes no cell emission authority.
	cell.reader.changes.emit({ previous: 0, value: 1, revision: 1 });
}
void eventTypes;

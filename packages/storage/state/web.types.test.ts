import type { Store } from '@okikio/context/state';
import * as web from './web.ts';

/** The native browser interfaces and small structural implementations share one checked public adapter surface. */
function browserTypes(storage: Storage, locks: LockManager): void {
	const native: Store = web.open({ storage, key: 'draft', mode: 'locked', locks });
	const single: Store = web.open({ storage, key: 'draft', mode: 'single-writer' });
	const mock: web.WebStorage = { getItem: () => null, setItem() {} };
	const mockLocks: web.Locks = { request: async (_name, _options, callback) => await callback() };
	const structural: Store = web.open({ storage: mock, key: 'draft', mode: 'locked', locks: mockLocks });
	void native;
	void single;
	void structural;
	// @ts-expect-error Web Storage never infers a cross-document concurrency guarantee.
	web.open({ storage, key: 'draft' });
	// @ts-expect-error Locked mode needs the caller-selected coordinating lock service.
	web.open({ storage, key: 'draft', mode: 'locked' });
	// @ts-expect-error A synchronous native read cannot be replaced by an asynchronous getItem mock.
	const asynchronous: web.WebStorage = { getItem: async () => null, setItem() {} };
	void asynchronous;
}
void browserTypes;

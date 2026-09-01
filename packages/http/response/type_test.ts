import * as response from './mod.ts';

/** Compile-time consumer fixture for constructible versus recognized redirect statuses. */
function redirectStatusContract(): void {
	const supported = response.redirect(308, { description: 'Permanent redirect.' });
	const status: 308 = supported.status;
	void status;

	// Historical statuses remain recognizable on the wire even when this utility
	// deliberately refuses to construct a new response with them.
	const recognized: boolean = response.redirectStatus.is(305) && response.redirectStatus.is(306);
	void recognized;

	// @ts-expect-error 305 Use Proxy is deprecated and is not constructible.
	response.redirect(305, { description: 'Deprecated redirect.' });
}

void redirectStatusContract;

/** Compile-time fixture proving custom pagination callbacks retain the page variant. */
function paginationLinkContextContract(): void {
	const page = {
		kind: 'offset' as const,
		items: ['a', 'b'],
		offset: 0,
		limit: 2,
		hasMore: true,
	};
	response.pageLinks(page, '/items', {}, ({ page: snapshot }) => {
		const offset: number = snapshot.offset;
		void offset;

		// The callback observes the normalized snapshot, not the caller-owned mutable array.
		// @ts-expect-error Normalized page items are readonly inside the callback.
		snapshot.items.push('changed');
		return undefined;
	});
}

void paginationLinkContextContract;

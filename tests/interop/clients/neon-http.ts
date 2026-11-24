/** The `neon-http` client. @module */
import { aborting, type ClientType, port } from './types.ts';
import { neonDriver } from './shared/neon.ts';

type Rows = readonly Record<string, unknown>[];

export const client: ClientType = {
	name: 'neon-http',
	about: "Neon's serverless driver over HTTP: `neon(url).query(text, values)`, with the signal on the request. HTTP " +
		'has no interactive transactions.',
	reach: 'neon',
	runtime: 'node',
	async open(started) {
		const { neon, connection } = await neonDriver(started);
		const client = neon.neon(connection);
		const db = port(
			(query, options) =>
				aborting(
					options,
					async (signal) =>
						await client.query(
							query.text,
							[...query.values],
							signal ? { fetchOptions: { signal } } : undefined,
						) as Rows,
				),
			() =>
				Promise.reject(
					new Error(
						'Neon over HTTP runs each statement alone; it has no interactive transactions.',
					),
				),
		);
		return { db, close: () => Promise.resolve() };
	},
};

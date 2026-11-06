/** One owned child process proves PostgreSQL supplies restart state rather than a retained JavaScript object. @module */
import postgresjs from 'postgres';
import * as state from '@okikio/context/state';
import * as schema from '@okikio/schema';
import * as codec from '@okikio/schema/codec';
import { DateSchema } from '@okikio/schema/time';
import * as adapter from '../postgres.ts';

const [action, namespace] = process.argv.slice(2);
const url = process.env.UTILS_TEST_DATABASE_URL;
if (url === undefined || namespace === undefined || !['write', 'read'].includes(action ?? '')) {
	throw new TypeError('State restart fixture requires write/read, namespace and its disposable database URL.');
}
const database = postgresjs(url, { max: 1, onnotice() {} });
try {
	const value = codec.object({ cursor: codec.identity(schema.string()), at: DateSchema });
	await using cell = await state.open({
		store: adapter.open({ database, namespace, key: 'cursor' }),
		contract: 'crawl.cursor.v1',
		value,
		...(action === 'write' ? { initial: () => ({ cursor: 'page-1', at: new Date('2026-11-01T00:00:00.000Z') }) } : {}),
	});
	if (action === 'write') await cell.update((value) => ({ ...value, cursor: 'page-2' }));
	console.log(
		JSON.stringify({ ...cell.reader.get(), version: cell.version, date: cell.reader.get().at instanceof Date }),
	);
} finally {
	await database.end({ timeout: 2 });
}

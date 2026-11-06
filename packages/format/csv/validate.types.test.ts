import * as schema from '@okikio/schema';
import { rows } from './validate.ts';
import type { RowResultType } from './validate.ts';
const values: AsyncIterable<RowResultType<{ name: string }>> = rows(schema.object({ name: schema.string() }), [], {
	columns: { name: 0 },
	maximumColumns: 1,
	maximumRows: 1,
	maximumIssues: 1,
	maximumPathLength: 1,
	onInvalid: 'yield',
});
void values;

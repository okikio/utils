/** Run native Node transport and portable consumer contracts with explicit application polyfills. @module */
import { fileURLToPath } from 'node:url';

// Deno-only wire and listener tests remain in the Deno suite. These files use
// real Node children plus the same portable source used by the package tests.
const files = [
	'packages/process/node.test.ts',
	'packages/process/lifecycle.test.ts',
	'packages/process/channel/mod.test.ts',
	'packages/workflow/dispatch.test.ts',
	'packages/workflow/scheduler.test.ts',
	'packages/context/mod.test.ts',
	'packages/queue/mod.test.ts',
	'tests/compatibility.test.ts',
	'tests/http-parity.test.ts',
	'tests/elysia-parity.test.ts',
	'tests/http-vixeny.test.ts',
	'tests/hono-contracts.test.ts',
	'tests/hono-proxy.test.ts',
	'tests/hono-compose.test.ts',
	'packages/server/http/mod.test.ts',
	'packages/server/http/router.test.ts',
	'packages/server/gateway/mod.test.ts',
	'packages/server/service/runtime.test.ts',
	'tests/alternatives.test.ts',
	'packages/dispose/ponyfill.test.ts',
	'packages/task/mod.test.ts',
	'packages/pool/mod.test.ts',
	'packages/query/mod.test.ts',
	'packages/query/url.test.ts',
	'packages/query/expression.test.ts',
	'packages/query/pagination.test.ts',
	'packages/csv/core.parse.test.ts',
	'packages/csv/stream.test.ts',
	'packages/csv/core.stream.test.ts',
	'packages/csv/write.test.ts',
	'packages/csv/occurrences.test.ts',
	'packages/permission/mod.test.ts',
	'packages/requirement/mod.test.ts',
	'packages/catalog/mod.test.ts',
	'packages/http/headers.test.ts',
	'packages/http/request/mod.test.ts',
	'packages/http/response/mod.test.ts',
];

const status = await new Deno.Command('node', {
	args: [
		'--import',
		'./packages/duration/polyfill.ts',
		'--import',
		'./packages/dispose/polyfill.ts',
		'--test',
		...files,
	],
	cwd: fileURLToPath(new URL('../', import.meta.url)),
	stdout: 'inherit',
	stderr: 'inherit',
}).spawn().status;
if (!status.success) Deno.exit(status.code);

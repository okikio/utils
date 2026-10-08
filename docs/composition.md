# Compose utilities around a result

Start with the smallest operation that returns the value you need. Add another utility when it owns a concrete rule:
input validation, a bounded group, cancellation, reusable resources, or independently executed work. An application
still owns the meaning of the data and chooses providers, storage, logging configuration, and deployment.

## Read the examples

A code block marked `runnable` is a complete module: its imports are public package entries, its input is supplied, and
the next `text output` block records its observable output. Copy it into a `.ts` file and run it from this workspace
with `deno run --no-check example.ts`. Registry use first requires installing the published package. The process guide
explicitly needs `--allow-run`; the Worker guide needs both listed files and module-read permission.

A block marked `support=filename.ts` is a companion file for a runnable module. Other code blocks are focused fragments
or integration sketches. Names such as a database client or application schema in those sketches are supplied by the
application; the block does not claim to be independently executable.

Read the result type and ownership explanation after each runnable block. `await` obtains a value from a Promise;
`for await` consumes values incrementally; `await using` releases the acquired owner when the enclosing block ends,
including when work throws. Returning a Promise, a stream, a resource lease, and a plain value are different contracts.
A `scope()` or `view()` usually attaches capabilities to an existing lifetime; it does not imply a new cleanup owner.

`tools/check-examples.ts` compiles and runs authored examples through their public imports and compares declared output.
It does not test heading wording, prose, or an arbitrary example count.

## Import rows with bounded work

Kaiju Platform's account-import adapter streams a CSV file, retains parsed rows for an editable draft, and applies
product-owned column roles. This smaller executable version demonstrates the same separation: CSV preserves cells; the
application validates company and website values. It then processes two rows at a time and stores a domain-indexed
result. The in-memory `Map` is an explicit example sink, so the example needs no credentials or external database.

```ts runnable=import-rows.ts
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import * as context from '@okikio/context';
import * as concurrency from '@okikio/concurrency';
import * as csv from '@okikio/csv';
import * as schema from '@okikio/schema';
import * as streams from '@okikio/streams';
import { z } from 'zod';

const CompanySchema = z.string().min(1);
const WebsiteSchema = z.url();
const input = 'Company,Website\n"Northstar, Inc.",https://northstar.example\nHarbor,https://harbor.example\n';
await using parent = context.create({ id: 'account-import' });
await using owner = context.timeout(parent, { seconds: 2 });
await using document = await csv.parseStream(new Response(input).body!, {
	headerRow: 1,
	maximumBytes: 20_000,
	maximumRows: 1_000,
});
const companies = new Map<string, string>();

for await (const rows of streams.batch(document.rows, { maximumItems: 2, signal: owner.signal })) {
	const accounts = concurrency.mapPooledOrdered({
		items: rows,
		concurrency: 2,
		signal: owner.signal,
		async map(row, { signal }) {
			signal.throwIfAborted();
			const name = await schema.parse(CompanySchema, row.values[0]);
			const website = await schema.parse(WebsiteSchema, row.values[1]);
			return { domain: new URL(website).hostname, name };
		},
	});
	for await (const account of accounts) companies.set(account.domain, account.name);
}
console.log(JSON.stringify(Object.fromEntries(companies)));
```

```text output
{"northstar.example":"Northstar, Inc.","harbor.example":"Harbor"}
```

`parseStream()` returns `Promise<CsvStreamDocument>`. The document owns its byte reader and exposes one-shot
`AsyncIterable<CsvRow>` data. `batch()` returns an async iterable of bounded row arrays. The mapper returns an async
iterable of `{ domain: string; name: string }` in input order. The final `Map<string, string>` deliberately materializes
the retained result; batching limits working groups, not that result's total size.

Fatal CSV parsing or budget violations reject with `CsvParseError`; recoverable diagnostics remain available on the
document. Invalid application data rejects with `SchemaValidationError`. Failure exits the loop and disposes the
document. No partially accepted application rows are rolled back automatically. A real import can stage changes or use a
transaction when that is its required policy.

The child context gives this small example a two-second deadline. It returns an owner immediately; the company Map comes
from the import work, not from `timeout()`. The application chooses an appropriate deadline for its real source.
Disposal clears the deadline wait and releases the child lifetime while leaving its parent independently owned.

The context signal reaches batch admission and mapping. For a network source, also pass it to `fetch()` so a blocked
source read can stop; `CsvStreamOptions` does not accept a signal. Here the input is finite local bytes. The parser owns
reader release and explicit disposal cancels unfinished parsing. Concurrency joins admitted callbacks, so callbacks must
cooperate with their signal rather than create detached work.

The originating consumer is `kaiju-platform/apps/frontend/src/routes/(product)/_app/(import)/-csv.ts`. That adapter
intentionally retains all draft rows for correction and recovery; streaming does not remove that product requirement.
See the [scenario catalogue](./scenarios.md) for qualification cases and input budgets.

## Discover allowed pages

Kaiju Crawl combines robots-declared sources with Sitemap parsing and projects records into discovery candidates. This
executable version supplies the fetched text directly. It produces the accepted page list without giving either syntax
parser responsibility for network access or crawl scheduling.

```ts runnable=discover-pages.ts
import * as robots from '@okikio/robots';
import * as sitemap from '@okikio/sitemap';

const policy = robots.parse('User-agent: *\nDisallow: /private/\nSitemap: https://example.com/sitemap.xml\n');
const sources = new Map([
	[
		'https://example.com/sitemap.xml',
		'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
		'<url><loc>https://example.com/guide</loc></url>' +
		'<url><loc>https://example.com/private/report</loc></url></urlset>',
	],
]);
const candidates: string[] = [];
for (const url of robots.getSitemapUrls(policy)) {
	const text = sources.get(url);
	if (text === undefined) throw new Error('No source was supplied for the declared sitemap.');
	for (const record of sitemap.parse({ url, text })) {
		if (record.kind === 'url' && robots.match(policy, { userAgent: 'KaijuBot', url: record.loc })) {
			candidates.push(record.loc);
		}
	}
}
console.log(JSON.stringify(candidates));
```

```text output
["https://example.com/guide"]
```

`robots.parse()` returns a `RobotsDocument`; `sitemap.parse()` returns `readonly SitemapRecord[]`; `robots.match()`
returns a boolean. `candidates` is the application's `string[]`. These calls acquire no network resource and require no
disposal. Parser problems belong to their returned document/record contracts; the explicit missing-source error belongs
to this application.

For fetched or large sources, use `sitemap.parseStream()` with a byte budget, a signal, and an awaited `onRecord()`
callback. The callback supplies backpressure. Handle HTTP status, redirects, nested source limits, and robots-fetch
failure policy in the acquiring application. The originating adapter is `kaiju-crawl/packages/discovery/src/sitemap.ts`.

## Share a resource with a finite operation

MediaD's media jobs use a task for finite work and borrow storage through a resource definition. The example below
stores a small manifest using that same ownership shape, with a pause before it commits the manifest. A local Map stands
in for the application storage provider; no generic utility chooses a cloud account, media format, or file destination.

```ts runnable=store-manifest.ts
import '@okikio/duration/polyfill';
import '@okikio/dispose/polyfill';
import * as context from '@okikio/context';
import * as resource from '@okikio/resource';
import * as task from '@okikio/task';

const ManifestStore = resource.define<{ put(id: string, value: string): void; get(id: string): string | undefined }>()({
	id: 'manifest-store',
	description: 'Store application-owned manifest text.',
});
const values = new Map<string, string>();
const live = resource.implement(ManifestStore, {
	create: () => ({
		put: (id, value) => {
			values.set(id, value);
		},
		get: (id) => values.get(id),
	}),
});
await using owner = context.create({ id: 'media-job' });
await using stores = resource.create(resource.implementations(live), { ctx: owner, host: {} });
await using work = task.start(async (ctx) => {
	const store = await ctx.get(ManifestStore);
	await ctx.checkpoint();
	store.put('asset-1', JSON.stringify({ title: 'Guide', ready: true }));
	return store.get('asset-1');
}, { ctx: owner, resources: stores, allowed: [ManifestStore] });
await work.pause();
console.log('Saved while paused:', values.has('asset-1'));
work.resume();
console.log(await work.done);
```

```text output
Saved while paused: false
{"title":"Guide","ready":true}
```

`resource.create()` returns a `ResourceCollection` that owns acquired implementations. `task.start()` returns a
`Task<string | undefined>`; `done` is its terminal `Promise<string | undefined>`, resolved after task-owned cleanup. The
task borrows `stores`, so disposing the task does not dispose the collection. Lexical cleanup runs task, collection,
then parent context. A provider implementation can register its actual disposable connection during creation.

The first line confirms that pausing has stopped admission before the manifest is stored; resuming allows the write.
`checkpoint()` is where a pause request can take effect. Cancellation reaches the task signal; pass that signal into
real provider I/O. A task cannot interrupt an indivisible synchronous mutation or undo a stored manifest. Work and
cleanup failures remain visible through the standard `SuppressedError` contract. These are process-local lifetimes, not
durable jobs. See MediaD's `packages/media/convert/convert.ts` and `packages/media/download/download.ts` for the native
media/provider operations that use this shape.

## Observe work without changing its result

Telemetry records what an owner reports. It does not settle a task, grant a permission, or accept a required business
consequence. This complete example retains bounded diagnostic history and flushes it when an application reports a
failure:

```ts runnable=diagnostics.ts
import * as fault from '@okikio/fault';
import * as telemetry from '@okikio/telemetry';

const output = telemetry.memory();
const history = telemetry.buffer(output, { capacity: 2 });
const operation = telemetry.create(history, { fields: { operation_id: 'import-1' } });
await operation.report({ name: 'import.started', level: 'debug' });
const diagnostic = fault.encode(new TypeError('Invalid provider reply.'), { includeStack: false });
await operation.report({ name: 'import.failed', level: 'error', fields: { diagnostic: JSON.stringify(diagnostic) } });
console.log(output.records.map((event) => event.name).join(','));
```

```text output
import.started,import.failed
```

`fault.encode()` creates bounded diagnostic data; it does not retain the live error. `report()` returns `Promise<void>`
and isolates reporter failure from the application operation. An executable may instead bind an already-configured
LogTape reporter. Applications still own sinks, levels, secret redaction, and tracing SDK setup.

## Add independent execution or replay when needed

Use [activity](../packages/activity/README.md) when a named provider operation needs validated input/result and an
explicit engine choice. Use [Worker](../packages/worker/README.md) or [process](../packages/process/README.md) providers
when that attempt must execute in another runtime domain. The complete Worker guide supplies both modules; the process
guide runs a real child with bounded captured output.

Use [workflow](../packages/workflow/README.md) when accepted instruction outcomes must be replayed or activity handoff
must have stable identity. History owns recorded completions; dispatch owns logical items, claims, retries, and fenced
results; executors own live attempts and capacity. The bundled memory stores remain process-local. Durable restart
requires concrete storage with equivalent atomic ownership and completion guarantees. No live JavaScript stack,
connection, cleanup stack, or thread migrates through those records.

`task` controls one local operation, `concurrency` bounds work inside it, `queue` tracks claimed logical work, and
`workflow` interprets recorded instructions. They solve different problems, so adding all of them to a small import
would add ownership that the job may not need.

## Choose a focused import

Use `@okikio/<name>` for an explicit focused dependency. Use `@okikio/utils/<name>` for the same implementation through
one suite installation. Deep public entries keep runtime adapters explicit. `@okikio/utils/all` intentionally loads the
broad namespace graph; ordinary modules should select the capability they actually use.

Read [runtime support](./runtime.md) for evidence boundaries, [packaging](./packaging.md) for distribution, and
[the source comparison](./comparison.md) for why reconciliation retained some standalone designs.

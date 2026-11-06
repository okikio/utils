/**
 * Test selective public imports by retained modules and executed consumer behavior.
 *
 * Equivalent focused and umbrella consumers must retain the same focused module
 * graph. Bundle byte counts are informational: harmless minifier or wrapper
 * changes do not constitute a failed capability contract.
 * @module
 */
import { build } from 'tsdown';
import { fileURLToPath } from 'node:url';

const rootPath = fileURLToPath(new URL('../../', import.meta.url));
const treeShakeCases = [
	{
		name: 'hash-native',
		leaf: 'packages/hash/mod.ts',
		umbrella: 'packages/utils/hash.ts',
		owner: 'packages/hash/',
		source:
			"import { sha256 } from SOURCE; if ((await sha256('abc')).slice(0,8) !== 'ba7816bf') throw new Error('Native hash changed');",
	},
	{
		name: 'hash-sync',
		leaf: 'packages/hash/sync.ts',
		umbrella: 'packages/utils/hash/sync.ts',
		owner: 'packages/hash/',
		source:
			"import { create, sha256 } from SOURCE; const state = create().update(new TextEncoder().encode('abc')); if (state.digest().length !== 32 || sha256('abc').slice(0,8) !== 'ba7816bf') throw new Error('Sync hash changed');",
	},
	{
		name: 'hash-sha3',
		leaf: 'packages/hash/sha3.ts',
		umbrella: 'packages/utils/hash/sha3.ts',
		owner: 'packages/hash/',
		source: "import { sha3_256 } from SOURCE; if (sha3_256('').length !== 32) throw new Error('SHA-3 changed');",
	},
	{
		name: 'hash-blake',
		leaf: 'packages/hash/blake.ts',
		umbrella: 'packages/utils/hash/blake.ts',
		owner: 'packages/hash/',
		source: "import { blake3 } from SOURCE; if (blake3('')[0] !== 175) throw new Error('BLAKE3 changed');",
	},
	{
		name: 'hash-uuid',
		leaf: 'packages/hash/uuid.ts',
		umbrella: 'packages/utils/hash/uuid.ts',
		owner: 'packages/hash/',
		source:
			"import { v7, timestamp, v4, version } from SOURCE; if (timestamp(v7(123)) !== 123 || version(v4()) !== 4) throw new Error('UUID changed');",
	},
	{
		name: 'hash-hmac',
		leaf: 'packages/hash/hmac/mod.ts',
		umbrella: 'packages/utils/hash/hmac.ts',
		owner: 'packages/hash/',
		source:
			"import { sign, verify } from SOURCE; const key = new Uint8Array([1]); const tag = await sign('sha256',key,'abc'); if (!await verify('sha256',key,'abc',tag)) throw new Error('HMAC changed');",
	},
	{
		name: 'hash-hmac-sync',
		leaf: 'packages/hash/hmac/sync.ts',
		umbrella: 'packages/utils/hash/hmac/sync.ts',
		owner: 'packages/hash/',
		source:
			"import { sign, verify } from SOURCE; const key = new Uint8Array([1]); const tag = sign('sha256',key,'abc'); if (!verify('sha256',key,'abc',tag)) throw new Error('Sync HMAC changed');",
	},
	{
		name: 'hash-stream',
		leaf: 'packages/hash/stream.ts',
		umbrella: 'packages/utils/hash/stream.ts',
		owner: 'packages/hash/',
		source:
			"import { read } from SOURCE; const source = new ReadableStream({start(controller){controller.close();}}); if ((await read('sha256',source,{maximumBytes:0})).length !== 32 || source.locked) throw new Error('Stream hash changed');",
	},
	{
		name: 'hash-id',
		leaf: 'packages/hash/id.ts',
		umbrella: 'packages/utils/hash/id.ts',
		owner: 'packages/hash/',
		source:
			"import { random, derive } from SOURCE; if (random().length !== 21 || !(await derive('x',[])).startsWith('x-')) throw new Error('ID changed');",
	},
	{
		name: 'hash-checksum',
		leaf: 'packages/hash/checksum.ts',
		umbrella: 'packages/utils/hash/checksum.ts',
		owner: 'packages/hash/',
		source:
			"import { crc32c } from SOURCE; if (crc32c(new TextEncoder().encode('123456789')) !== 0xe3069283) throw new Error('CRC changed');",
	},
	{
		name: 'entitlement-static',
		leaf: 'packages/authz/entitlement/definition.ts',
		umbrella: 'packages/utils/authz/entitlement/definition.ts',
		owner: 'packages/authz/',
		source:
			"import { define, require as need } from SOURCE; const feature = define({ id: 'export' }); if (need(feature).definition !== feature) throw new Error('Entitlement identity changed');",
	},
	{
		name: 'meter',
		leaf: 'packages/capability/effect/meter/mod.ts',
		umbrella: 'packages/utils/capability/effect/meter.ts',
		owner: 'packages/capability/effect/',
		source:
			"import { define, effect } from SOURCE; const bytes = define({ id: 'bytes', unit: 'byte' }); if (effect(bytes).id !== 'meter:bytes') throw new Error('Meter identity changed');",
	},
	{
		name: 'codec',
		leaf: 'packages/schema/codec/mod.ts',
		umbrella: 'packages/utils/schema/codec.ts',
		owner: 'packages/schema/',
		source: "import { define } from SOURCE; if (typeof define !== 'function') throw new Error('Codec export missing');",
	},
	{
		name: 'csv-standard',
		leaf: 'packages/format/csv/mod.ts',
		umbrella: 'packages/utils/format/csv.ts',
		owner: 'packages/format/csv/',
		source:
			`import { parse, serialize } from SOURCE; let output = ''; for await (const bytes of serialize([['A', 'B'], ['1', 'two\\r\\nlines']])) output += new TextDecoder().decode(bytes); if (parse(output, { headerRow: 1 }).rows[0].values[1] !== 'two\\r\\nlines') throw new Error('CSV writer changed'); const value = parse('A,B\\r\\n\\r\\n1,"two\\r\\nlines"\\r\\n', { headerRow: 1, preserveBlankRows: true }); if (value.rows.length !== 2 || value.rows[1].values[1] !== 'two\\r\\nlines') throw new Error('CSV source text changed');`,
	},
	{
		name: 'workflow-contracts',
		leaf: 'packages/workflow/execution.ts',
		umbrella: 'packages/utils/workflow/execution.ts',
		owner: 'packages/workflow/',
		source:
			`import { ReferenceSchema, PolicySchema } from SOURCE; const ref = ReferenceSchema.parse({ id: '00000000-0000-0000-0000-000000000000', namespace: 'imports', scope: 'customer', definition: { kind: 'activity', id: 'parse', version: '1' } }); if (ref.scope !== 'customer') throw new Error('Reference changed'); let rejected = false; try { PolicySchema.parse({}); } catch { rejected = true; } if (!rejected) throw new Error('Invalid policy accepted');`,
	},
	{
		name: 'storage-workflow',
		leaf: 'packages/storage/workflow/postgres/mod.ts',
		umbrella: 'packages/utils/storage/workflow/postgres.ts',
		owner: 'packages/storage/workflow/postgres/',
		source: `import ${JSON.stringify(`${rootPath}packages/duration/polyfill.ts`)}; import ${
			JSON.stringify(`${rootPath}packages/dispose/polyfill.ts`)
		}; import { open } from SOURCE; await using store = open({ database: {}, namespace: 'imports' }); if (store.namespace !== 'imports') throw new Error('Store changed');`,
	},
	{
		name: 'storage-root',
		leaf: 'packages/storage/mod.ts',
		umbrella: 'packages/utils/storage.ts',
		owner: 'packages/storage/',
		source:
			`import * as storage from SOURCE; if (Object.keys(storage).length !== 0) throw new Error('Storage root activated a runtime adapter');`,
	},
	{
		name: 'storage-queue',
		leaf: 'packages/storage/queue/postgres.ts',
		umbrella: 'packages/utils/storage/queue/postgres.ts',
		owner: 'packages/storage/queue/',
		source: `import * as schema from ${
			JSON.stringify(`${rootPath}packages/schema/mod.ts`)
		}; import { open } from SOURCE; const database = new Proxy({}, { get() { throw new Error('Construction touched the database'); } }); const jobs = open({ database, namespace: 'imports', contract: 'v1', input: schema.string(), output: schema.string() }); await jobs.close();`,
	},
	{
		name: 'workflow-client',
		leaf: 'packages/workflow/mod.ts',
		umbrella: 'packages/utils/workflow.ts',
		owner: 'packages/workflow/',
		source: `import ${
			JSON.stringify(`${rootPath}packages/duration/polyfill.ts`)
		}; import { client } from SOURCE; if (typeof client !== 'function') throw new Error('workflow client export changed');`,
	},
	{
		name: 'result-named',
		leaf: 'packages/result/mod.ts',
		umbrella: 'packages/utils/result.ts',
		owner: 'packages/result/',
		source:
			"import { ok } from SOURCE; const value = ok(42); if (!value.ok || value.value !== 42 || !Object.isFrozen(value)) throw new Error('success wrapper changed');",
	},
	{
		name: 'result-namespace',
		leaf: 'packages/result/mod.ts',
		umbrella: 'packages/utils/result.ts',
		owner: 'packages/result/',
		source:
			"import * as result from SOURCE; const reason = {}; const value = result.fail(reason); if (value.ok || value.failure !== reason || !Object.isFrozen(value)) throw new Error('failure wrapper changed'); if (result.getOr(value, 42) !== 42) throw new Error('fallback changed');",
	},
	{
		name: 'http-request',
		leaf: 'packages/http/request/mod.ts',
		umbrella: 'packages/utils/http/request.ts',
		owner: 'packages/http/request/',
		source:
			"import { parseQuery } from SOURCE; const value = parseQuery('?tag=a&tag=b&flag&empty=', { bareQueryParameters: 'flag' }); if (!Array.isArray(value.tag) || value.tag.length !== 2 || value.tag[0] !== 'a' || value.tag[1] !== 'b' || value.flag !== 'true' || value.empty !== '') throw new Error('wire query changed'); if (!Object.isFrozen(value) || !Object.isFrozen(value.tag)) throw new Error('query ownership changed');",
	},
	{
		name: 'server-router',
		leaf: 'packages/server/http/mod.ts',
		umbrella: 'packages/utils/server/http.ts',
		owner: 'packages/server/http/',
		source:
			"import { prepareRoutes, matchRoute } from SOURCE; const plan = prepareRoutes([{ kind: 'route', method: 'GET', path: '/items/:id' }, { kind: 'route', method: 'GET', path: '/items/new' }]); if (matchRoute(plan, 'GET', '/items/new') !== 'GET /items/new' || matchRoute(plan, 'HEAD', '/items/7') !== 'GET /items/:id' || matchRoute(plan, 'POST', '/items/7') !== undefined) throw new Error('route selection changed'); if (!Object.isFrozen(plan) || !Object.isFrozen(plan.routes)) throw new Error('route plan ownership changed');",
	},
] as const;

/** Provenance survives valid constant folding even when a module contributes no final bytes. */
export interface GraphType {
	readonly origins: readonly string[];
	readonly modules: readonly string[];
}

/** Check retained modules against the counterpart's provenance, permitting the selected bridge. */
export function graphProblems(
	focused: GraphType,
	umbrella: GraphType,
	bridge: string,
	owner: string,
): readonly string[] {
	const errors: string[] = [];
	if (!focused.origins.some((file) => file.startsWith(owner))) {
		errors.push('The focused capability has no bundle provenance.');
	}
	if (!umbrella.origins.some((file) => file.startsWith(owner))) {
		errors.push('The umbrella capability has no bundle provenance.');
	}
	const focusedOrigins = new Set(focused.origins);
	const umbrellaOrigins = new Set(umbrella.origins);
	for (const file of focused.modules) {
		if (!umbrellaOrigins.has(file)) errors.push(`Umbrella omitted focused module ${file}.`);
	}
	for (const file of umbrella.modules) {
		if (file !== bridge && !focusedOrigins.has(file)) errors.push(`Umbrella retained unrelated module ${file}.`);
	}
	return errors;
}

/** Bundle and execute one disposable consumer; return only actual retained workspace modules and informational bytes. */
async function bundle(
	name: string,
	template: string,
	entrypoint: string,
): Promise<GraphType & Readonly<{ bytes: number }>> {
	const scratch = `${rootPath}.tmp/consumers`;
	await Deno.mkdir(scratch, { recursive: true });
	const temp = await Deno.makeTempDir({ dir: scratch, prefix: `${name}-` });
	try {
		const entry = `${temp}/entry.ts`;
		const outDir = `${temp}/dist`;
		await Deno.writeTextFile(entry, template.replace('SOURCE', JSON.stringify(`${rootPath}${entrypoint}`)));
		const results = await build({
			config: false,
			cwd: rootPath,
			entry: [entry],
			outDir,
			format: ['esm'],
			platform: 'neutral',
			target: 'esnext',
			dts: false,
			minify: true,
			treeshake: true,
			clean: true,
			deps: { alwaysBundle: [/.*/] },
			publint: false,
			attw: false,
		});
		try {
			const chunks = results.flatMap((result) => result.chunks.filter((chunk) => chunk.type === 'chunk'));
			const entries = chunks.filter((chunk) => chunk.isEntry);
			if (entries.length !== 1) throw new Error(`${name}: the selective consumer has no unique executable entry.`);
			const provenance = chunks.flatMap((chunk) => Object.entries(chunk.modules));
			// Inspect dependency provenance as well as workspace modules. A dev-only package must not enter these consumers.
			if (
				['csv-standard', 'workflow-contracts', 'storage-', 'workflow-client'].some((entry) => name.startsWith(entry))
			) {
				for (const [file] of provenance) {
					if (/(?:^|[/\\])(?:csv-parse|csv-stringify|zod)(?:[/\\@]|$)/.test(file)) {
						throw new Error(`${name}: forbidden runtime dependency ${file}.`);
					}
				}
			}
			if (name.startsWith('hash-native') || name.startsWith('hash-hmac-') && !name.startsWith('hash-hmac-sync')) {
				if (provenance.some(([file]) => /(?:@noble|std__crypto|_wasm)/.test(file))) {
					throw new Error(`${name}: native hashing retained an optional hash provider.`);
				}
			}
			const select = (files: readonly string[]): readonly string[] =>
				[
					...new Set(
						files.map((file) => file.replaceAll('\\', '/'))
							.filter((file) => file.startsWith(`${rootPath}packages/`)).map((file) => file.slice(rootPath.length)),
					),
				].toSorted();
			const origins = select(provenance.map(([file]) => file));
			const modules = select(provenance.filter(([, module]) => module.renderedLength > 0).map(([file]) => file));
			const child = await new Deno.Command('node', {
				args: [`${outDir}/${entries[0]!.fileName}`],
				stdout: 'piped',
				stderr: 'piped',
			}).output();
			if (!child.success) {
				throw new Error(`${name}: bundled consumer failed.\n${new TextDecoder().decode(child.stderr)}`);
			}
			return {
				bytes: chunks.reduce((total, chunk) => total + new TextEncoder().encode(chunk.code).byteLength, 0),
				modules,
				origins,
			};
		} finally {
			for (const result of results) await result[Symbol.asyncDispose]();
		}
	} finally {
		await Deno.remove(temp, { recursive: true });
	}
}

if (import.meta.main) {
	for (const item of treeShakeCases) {
		const focused = await bundle(`${item.name}-focused`, item.source, item.leaf);
		const umbrella = await bundle(`${item.name}-umbrella`, item.source, item.umbrella);
		// A type-only root can disappear entirely through its re-export. Its contract is no runtime adapter graph.
		const errors = item.name === 'storage-root'
			? [...focused.origins, ...umbrella.origins].filter((file) => file !== item.leaf && file !== item.umbrella).map((
				file,
			) => `The type-only Storage root retained ${file}.`)
			: [...graphProblems(focused, umbrella, item.umbrella, item.owner)];
		if (
			item.name === 'workflow-client' &&
			[...focused.origins, ...umbrella.origins].some((file) => file.startsWith('packages/storage/workflow/postgres/'))
		) {
			errors.push('The portable workflow client retained the optional PostgreSQL adapter.');
		}
		if (
			item.name === 'entitlement-static' &&
			[...focused.origins, ...umbrella.origins].some((file) =>
				file === 'packages/authz/entitlement/mod.ts' || file === 'packages/capability/requirement/mod.ts'
			)
		) {
			errors.push('Static entitlement declarations retained checker execution.');
		}
		if (errors.length > 0) throw new Error(`${item.name}:\n${errors.join('\n')}`);
		console.log(JSON.stringify({ name: item.name, focused, umbrella, overheadBytes: umbrella.bytes - focused.bytes }));
	}
}
